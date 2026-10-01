import test from "node:test";
import assert from "node:assert/strict";
import { MediaDownloader } from "../../adapters/telegram/dist/mediaDownloader.js";
import { DeadLetterQueue, EventHub } from "../../packages/engine/dist/index.js";

test("Chaos Drill: Storage outage holds submissions in retry queue and routes to DLQ after threshold (PRD §45, §28)", async () => {
  const eventHub = new EventHub();
  const dlq = new DeadLetterQueue(eventHub);

  let storageOnline = false;
  let attemptCount = 0;

  // Mock fetcher that fails while storage is down, succeeds when restored
  const mockFetcher = async (fileId) => {
    attemptCount += 1;
    if (!storageOnline) {
      throw new Error("ObjectStorageUnavailable: 503 Service Unavailable");
    }
    return Buffer.from(`file-content-for-${fileId}`);
  };

  const downloader = new MediaDownloader("test-token", mockFetcher);

  // 1. Storage is down: attempt download, fails gracefully without unhandled crash
  let downloadErr = null;
  try {
    await downloader.downloadDocument({
      file_id: "doc-12345",
      file_name: "waybill.jpg",
      mime_type: "image/jpeg"
    });
  } catch (err) {
    downloadErr = err;
  }
  assert.ok(downloadErr);
  assert.match(downloadErr.message, /503 Service Unavailable/);

  // 2. Enqueue failed job for retry in queue
  const queueJob = {
    id: "job-storage-1",
    type: "document_ingestion",
    payload: { fileId: "doc-12345", fileName: "waybill.jpg" },
    attempts: 1,
    lastError: downloadErr.message
  };

  // 3. Storage recovers before max attempts
  storageOnline = true;
  const recoveredMedia = await downloader.downloadDocument({
    file_id: queueJob.payload.fileId,
    file_name: queueJob.payload.fileName,
    mime_type: "image/jpeg"
  });

  assert.ok(recoveredMedia);
  assert.equal(recoveredMedia.fileId, "doc-12345");
  assert.equal(recoveredMedia.sentAs, "file");
  assert.equal(recoveredMedia.buffer.toString(), "file-content-for-doc-12345");

  // 4. Test unrecoverable storage outage exceeding max attempts -> moves to DLQ
  storageOnline = false;

  const entry = dlq.enqueue({
    jobType: "document_ingestion",
    payload: { fileId: "doc-corrupted", fileName: "unreachable.pdf" },
    error: "ObjectStoragePermanentlyUnavailable: 503",
    attempts: 3
  });

  const deadLetters = dlq.getAll();
  assert.equal(deadLetters.length, 1);
  assert.equal(deadLetters[0].jobType, "document_ingestion");
  assert.match(deadLetters[0].error, /503/);

  // Verify job.dead_lettered admin event was emitted
  const events = eventHub.getAllEvents();
  const dlqEvent = events.find(e => e.type === "job.dead_lettered");
  assert.ok(dlqEvent);
  assert.equal(dlqEvent.payload.deadLetterId, entry.id);

  // 5. Verify DLQ enables replay once storage restored
  storageOnline = true;
  const replayResult = await dlq.replay(entry.id, async (payload) => {
    assert.equal(payload.fileId, "doc-corrupted");
    return true;
  });
  assert.equal(replayResult.success, true);
  assert.equal(dlq.getById(entry.id)?.status, "replayed");
});

