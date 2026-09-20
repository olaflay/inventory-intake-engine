import test from "node:test";
import assert from "node:assert/strict";
import { PostingService } from "../../packages/engine/dist/index.js";

test("PostingService applies atomic update and increments version (LD-11)", async () => {
  const service = new PostingService();
  const assetStore = new Map();
  const ledgerStore = [];

  assetStore.set("asset-101", {
    id: "asset-101",
    version: 1,
    locationId: "loc-base",
    movementState: "at_location",
    statusCode: "OPERATIONAL"
  });

  const res = await service.postTransaction(
    {
      proposalVersionId: "prop-v1",
      proposalKind: "dispatch",
      actorRef: "telegram:dispatcher",
      items: [
        {
          assetId: "asset-101",
          expectedVersion: 1,
          newLocationId: "loc-transit",
          newMovementState: "in_transit"
        }
      ]
    },
    assetStore,
    ledgerStore
  );

  assert.equal(res.success, true);
  assert.equal(assetStore.get("asset-101").version, 2);
  assert.equal(assetStore.get("asset-101").movementState, "in_transit");
  assert.equal(ledgerStore.length, 1);
  assert.equal(ledgerStore[0].kind, "dispatch");
});

test("PostingService rejects stale proposal when version has changed concurrently (LD-11)", async () => {
  const service = new PostingService();
  const assetStore = new Map();
  const ledgerStore = [];

  assetStore.set("asset-101", {
    id: "asset-101",
    version: 2, // version was already bumped to 2 by another transaction
    locationId: "loc-transit",
    movementState: "in_transit",
    statusCode: "OPERATIONAL"
  });

  // Second proposal attempts to apply changes expecting version 1
  const res = await service.postTransaction(
    {
      proposalVersionId: "prop-v2",
      proposalKind: "dispatch",
      actorRef: "telegram:other-user",
      items: [
        {
          assetId: "asset-101",
          expectedVersion: 1, // Stale!
          newLocationId: "loc-somewhere-else",
          newMovementState: "in_transit"
        }
      ]
    },
    assetStore,
    ledgerStore
  );

  assert.equal(res.success, false);
  assert.equal(res.staleAssetId, "asset-101");
  assert.match(res.error, /Proposal is STALE/);
  // Asset state untouched
  assert.equal(assetStore.get("asset-101").version, 2);
  assert.equal(ledgerStore.length, 0);
});
