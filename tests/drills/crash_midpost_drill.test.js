import test from "node:test";
import assert from "node:assert/strict";
import { PostingService } from "../../packages/engine/dist/index.js";

test("Chaos Drill: Crash mid-post rolls back completely leaving zero partial state", async () => {
  const service = new PostingService();

  // Initial state: 3 assets in the base store
  const assetStore = new Map([
    ["asset-001", { id: "asset-001", version: 1, locationId: "loc-base", movementState: "at_location", statusCode: "OPERATIONAL" }],
    ["asset-002", { id: "asset-002", version: 1, locationId: "loc-base", movementState: "at_location", statusCode: "OPERATIONAL" }],
    ["asset-003", { id: "asset-003", version: 2, locationId: "loc-base", movementState: "at_location", statusCode: "OPERATIONAL" }] // Version already bumped!
  ]);

  const ledgerStore = [];

  // Transaction attempts to dispatch 3 assets, but asset-003 expects version 1
  const result = await service.postTransaction(
    {
      proposalVersionId: "prop-crash-test",
      proposalKind: "dispatch",
      actorRef: "telegram:dispatcher",
      items: [
        { assetId: "asset-001", expectedVersion: 1, newLocationId: "loc-transit", newMovementState: "in_transit" },
        { assetId: "asset-002", expectedVersion: 1, newLocationId: "loc-transit", newMovementState: "in_transit" },
        { assetId: "asset-003", expectedVersion: 1, newLocationId: "loc-transit", newMovementState: "in_transit" }
      ]
    },
    assetStore,
    ledgerStore
  );

  // Assert atomic rollback: transaction failed
  assert.equal(result.success, false);
  assert.equal(result.staleAssetId, "asset-003");

  // Verify ZERO partial updates: asset-001 and asset-002 were NOT modified
  assert.equal(assetStore.get("asset-001").version, 1);
  assert.equal(assetStore.get("asset-001").movementState, "at_location");
  assert.equal(assetStore.get("asset-002").version, 1);
  assert.equal(assetStore.get("asset-002").movementState, "at_location");

  // Verify ZERO orphan ledger entries written
  assert.equal(ledgerStore.length, 0);
});
