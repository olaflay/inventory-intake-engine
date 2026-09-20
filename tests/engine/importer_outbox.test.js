import test from "node:test";
import assert from "node:assert/strict";
import { LegacyExcelImporter, OutboxWorker } from "../../packages/engine/dist/index.js";

test("LegacyExcelImporter (PRD §20.2): detects multi-sheet duplicate serials and unrecorded locations", () => {
  const importer = new LegacyExcelImporter();

  const mockRows = [
    { sheetName: "SURVEY EQUIPMENT", rowIndex: 12, itemDescription: "Meridian Gyro", serialRaw: "8709", locationMarker: "1" },
    { sheetName: "PURCHASED ITEMS", rowIndex: 45, itemDescription: "Meridian Gyro", serialRaw: "8709", locationMarker: undefined }, // Duplicate on another sheet!
    { sheetName: "IT EQUIPMENT", rowIndex: 8, itemDescription: "HP CPU", serialRaw: "6CR5420WK4", locationMarker: undefined } // Unrecorded location
  ];

  const analysis = importer.analyzeWorkbook(mockRows);

  assert.equal(analysis.totalSheets, 3);
  assert.equal(analysis.totalRowsParsed, 3);
  assert.equal(analysis.unrecordedLocationCount, 2);
  assert.equal(analysis.conflicts.length, 1);
  assert.equal(analysis.conflicts[0].kind, "duplicate_serial");
  assert.equal(analysis.conflicts[0].serialNorm, "8709");
  assert.equal(analysis.canCommit, false, "Commit must be blocked while conflicts are unresolved");

  // Resolve conflict
  const resolved = importer.resolveConflict(analysis.conflicts[0], "merge");
  assert.equal(resolved.resolution?.action, "merge");
});

test("OutboxWorker (PRD §28): handles delivery success and routes to dead-letter after max attempts", async () => {
  const worker = new OutboxWorker(3);

  const event = {
    seq: 1042,
    eventId: "evt-123",
    type: "intent.created",
    entityType: "proposal",
    entityId: "prop-456",
    audience: ["telegram:123"],
    payload: { intentId: "int-789" },
    createdAt: new Date().toISOString(),
    attempts: 0
  };

  // 1. Successful delivery
  const resSuccess = await worker.deliverEvent(event, async () => true);
  assert.equal(resSuccess.success, true);
  assert.equal(resSuccess.deadLettered, false);

  // 2. Failed delivery under threshold (retryable)
  const resRetryable = await worker.deliverEvent(event, async () => { throw new Error("Connection timeout"); });
  assert.equal(resRetryable.success, false);
  assert.equal(resRetryable.deadLettered, false);

  // 3. Exceeds max attempts (moves to dead letter)
  const exhaustedEvent = { ...event, attempts: 2 };
  const resDeadLetter = await worker.deliverEvent(exhaustedEvent, async () => { throw new Error("Persistent 500"); });
  assert.equal(resDeadLetter.success, false);
  assert.equal(resDeadLetter.deadLettered, true);
  assert.match(resDeadLetter.error, /Max attempts \(3\) reached/);
});
