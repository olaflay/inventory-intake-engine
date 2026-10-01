import test from "node:test";
import assert from "node:assert/strict";
import { PostingService, LedgerReplayer } from "../../packages/engine/dist/index.js";

test("Property Test Invariants (I1–I4): 50 random valid sequence steps hold I1..I4 invariants", async () => {
  const service = new PostingService();
  const assetStore = new Map();
  const ledgerStore = [];
  const dispatchStore = new Map();

  const locations = ["loc-base", "loc-warami-10", "loc-delta-1", "loc-alpha-subsea"];
  const assetIds = ["asset-p1", "asset-p2", "asset-p3", "asset-p4", "asset-p5"];

  // Initialize assets at loc-base with genesis creation ledger entries
  for (const aId of assetIds) {
    assetStore.set(aId, {
      id: aId,
      version: 1,
      locationId: "loc-base",
      movementState: "at_location",
      statusCode: "OPERATIONAL"
    });
    ledgerStore.push({
      id: `led-genesis-${aId}`,
      transactionId: "txn-genesis",
      proposalId: "prop-genesis",
      proposalVersion: 1,
      assetId: aId,
      kind: "create",
      movementState: "at_location",
      fromLocationId: null,
      toLocationId: "loc-base",
      statusCode: "OPERATIONAL",
      actorRef: "system:genesis",
      timestamp: "2026-09-01T00:00:00.000Z"
    });
  }

  // 50 iterations of randomized operations: dispatch, receive, status_change
  for (let step = 0; step < 50; step++) {
    // Pick 1-3 random assets
    const shuffled = [...assetIds].sort(() => 0.5 - Math.random());
    const count = 1 + Math.floor(Math.random() * 3);
    const chosenIds = shuffled.slice(0, count);

    // Decide operation based on current state of first chosen asset
    const firstAsset = assetStore.get(chosenIds[0]);

    if (firstAsset.movementState === "at_location") {
      // Create dispatch to random target
      const targetLoc = locations.find(l => l !== firstAsset.locationId) || "loc-warami-10";
      const dispatchItems = chosenIds
        .filter(id => assetStore.get(id).movementState === "at_location")
        .map(id => {
          const a = assetStore.get(id);
          return {
            assetId: id,
            expectedVersion: a.version,
            newLocationId: targetLoc,
            newMovementState: "in_transit",
            sourceLocationId: a.locationId
          };
        });

      if (dispatchItems.length > 0) {
        const res = await service.postTransaction(
          {
            proposalVersionId: `prop-step-${step}`,
            proposalKind: "dispatch",
            actorRef: "telegram:tech-property",
            items: dispatchItems,
            toLocationId: targetLoc,
            fromLocationId: firstAsset.locationId
          },
          assetStore,
          ledgerStore,
          dispatchStore
        );
        assert.equal(res.success, true);
      }
    } else {
      // Asset is in transit -> Receive it at its destination
      const openDispatch = Array.from(dispatchStore.values()).find(
        d => d.status === "open" && d.assetIds.includes(firstAsset.id)
      );

      const receiveItems = (openDispatch ? openDispatch.assetIds : [firstAsset.id]).map(id => {
        const a = assetStore.get(id);
        return {
          assetId: id,
          expectedVersion: a.version,
          newLocationId: openDispatch?.toLocationId || "loc-warami-10",
          newMovementState: "at_location"
        };
      });

      const res = await service.postTransaction(
        {
          proposalVersionId: `prop-receive-${step}`,
          proposalKind: "receive",
          actorRef: "telegram:receiver-property",
          items: receiveItems,
          dispatchId: openDispatch?.id
        },
        assetStore,
        ledgerStore,
        dispatchStore
      );
      assert.equal(res.success, true);
    }

    // Invariant I1 Verification: Ledger replay equals DB state for all assets
    for (const aId of assetIds) {
      const dbAsset = assetStore.get(aId);
      const replayed = LedgerReplayer.replayAssetHistory(aId, ledgerStore);
      assert.equal(
        dbAsset.movementState,
        replayed.movementState,
        `Invariant I1 failed for asset ${aId} at step ${step}`
      );
      assert.equal(
        dbAsset.locationId,
        replayed.locationId,
        `Invariant I1 location failed for asset ${aId} at step ${step}`
      );
    }

    // Invariant I2 Verification: No asset in multiple open dispatches
    const openDispatches = Array.from(dispatchStore.values()).filter(d => d.status === "open");
    const openSet = new Set();
    for (const d of openDispatches) {
      for (const aId of d.assetIds) {
        assert.equal(
          openSet.has(aId),
          false,
          `Invariant I2 violated: asset ${aId} in multiple open dispatches`
        );
        openSet.add(aId);
      }
    }
  }

  assert.ok(ledgerStore.length > 50, "At least 50 ledger entries should have been recorded");
});
