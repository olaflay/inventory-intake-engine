import test from "node:test";
import assert from "node:assert/strict";
import {
  EventHub,
  WebhookDeliverer,
  DailyDigestService,
  JobScheduler,
  DeadLetterQueue
} from "../../packages/engine/dist/index.js";

test("EventHub (FR-EVT-01): monotonic sequence assignment and cursor-based polling", () => {
  const hub = new EventHub();

  const e1 = hub.emit({ type: "submission.state_changed", entityType: "submission", entityId: "sub-1", payload: { state: "CLOSED" } });
  const e2 = hub.emit({ type: "proposal.ready", entityType: "proposal", entityId: "prop-1", payload: { tier: 2 } });
  const e3 = hub.emit({ type: "approval.requested", entityType: "proposal", entityId: "prop-1", audience: ["supervisor"], payload: { tier: 2 } });
  const e4 = hub.emit({ type: "transaction.posted", entityType: "proposal", entityId: "prop-1", payload: { txnId: "txn-1" } });

  assert.equal(e1.seq, 1);
  assert.equal(e2.seq, 2);
  assert.equal(e3.seq, 3);
  assert.equal(e4.seq, 4);

  // Poll afterSeq 0 with limit 2 -> returns e1 and e2
  const page1 = hub.getEventsAfter(0, 2);
  assert.equal(page1.length, 2);
  assert.equal(page1[0].seq, 1);
  assert.equal(page1[1].seq, 2);

  // Poll afterSeq 2 with limit 2 -> returns e3 and e4
  const page2 = hub.getEventsAfter(2, 2);
  assert.equal(page2.length, 2);
  assert.equal(page2[0].seq, 3);
  assert.equal(page2[1].seq, 4);

  // Poll with audience filter
  const supervisorEvents = hub.getEventsAfter(0, 10, "supervisor");
  assert.equal(supervisorEvents.length, 1);
  assert.equal(supervisorEvents[0].type, "approval.requested");
});

test("WebhookDeliverer (FR-EVT-01): HMAC-SHA256 signature verification over timestamp and body", async () => {
  const secret = "whsec_test_secret_123456";
  const deliverer = new WebhookDeliverer({
    url: "https://adapter.example.com/webhook",
    secret,
    maxAttempts: 3
  });

  const event = {
    seq: 10,
    eventId: "evt-uuid-10",
    type: "proposal.ready",
    entityType: "proposal",
    entityId: "prop-10",
    audience: ["telegram:adapter"],
    payload: { proposalId: "prop-10" },
    createdAt: new Date().toISOString()
  };

  let capturedHeaders = null;
  let capturedBody = null;

  const mockFetch = async (url, init) => {
    capturedHeaders = init.headers;
    capturedBody = init.body;
    return {
      ok: true,
      status: 200,
      text: async () => "OK"
    };
  };

  const res = await deliverer.deliver(event, mockFetch);
  assert.equal(res.success, true);
  assert.equal(res.statusCode, 200);

  // Verify HMAC-SHA256 signature
  const timestamp = capturedHeaders["X-Timestamp"];
  const signature = capturedHeaders["X-Signature"];
  assert.ok(timestamp);
  assert.ok(signature);

  const isValid = WebhookDeliverer.verifySignature(secret, timestamp, capturedBody, signature);
  assert.equal(isValid, true, "Signature must verify against payload and timestamp");

  // Tampered payload must fail verification
  const isTamperedValid = WebhookDeliverer.verifySignature(secret, timestamp, capturedBody + "tampered", signature);
  assert.equal(isTamperedValid, false, "Tampered payload must fail signature verification");
});

test("WebhookDeliverer (PRD §28): permanent errors fail fast without retry; 5xx retries to dead letter", async () => {
  const deliverer = new WebhookDeliverer({
    url: "https://adapter.example.com/webhook",
    secret: "test_secret",
    maxAttempts: 3
  });

  const event = {
    seq: 15,
    eventId: "evt-uuid-15",
    type: "test.event",
    entityType: "test",
    entityId: "test-15",
    audience: ["admin"],
    payload: {},
    createdAt: new Date().toISOString()
  };

  // Case 1: Permanent 400 error fails on first attempt without retrying
  let attempts400 = 0;
  const mock400 = async () => {
    attempts400 += 1;
    return { ok: false, status: 400, text: async () => "Bad Request" };
  };

  const res400 = await deliverer.deliver({ ...event }, mock400);
  assert.equal(res400.success, false);
  assert.equal(res400.deadLettered, true);
  assert.equal(attempts400, 1, "Permanent 400 client error should NOT be retried");

  // Case 2: Server 500 error retries up to maxAttempts (3) then dead-letters
  let attempts500 = 0;
  const mock500 = async () => {
    attempts500 += 1;
    return { ok: false, status: 500, text: async () => "Internal Server Error" };
  };

  const res500 = await deliverer.deliver({ ...event }, mock500);
  assert.equal(res500.success, false);
  assert.equal(res500.deadLettered, true);
  assert.equal(attempts500, 3, "Transient 500 error must retry until maxAttempts (3)");
});

test("DailyDigestService (FR-OPS-01, EC-22, EC-49): gathers overdue dispatches, aging approvals, and unlinked receipts", () => {
  const digestService = new DailyDigestService({
    overdueDispatchDays: 3,
    agingApprovalHours: 24
  });

  const now = new Date("2026-09-21T12:00:00.000Z");

  // Dispatch 1: 5 days old (overdue!)
  // Dispatch 2: 1 day old (not overdue)
  // Dispatch 3: 10 days old but already received (not open, so not overdue)
  const dispatches = [
    {
      id: "dsp-overdue-1",
      fromLocationId: "loc-base",
      toLocationId: "loc-rig-1",
      assetIds: ["a1", "a2"],
      status: "open",
      createdAt: new Date("2026-09-16T12:00:00.000Z").toISOString()
    },
    {
      id: "dsp-recent-2",
      fromLocationId: "loc-base",
      toLocationId: "loc-rig-2",
      assetIds: ["a3"],
      status: "open",
      createdAt: new Date("2026-09-20T12:00:00.000Z").toISOString()
    },
    {
      id: "dsp-closed-3",
      fromLocationId: "loc-base",
      toLocationId: "loc-rig-3",
      assetIds: ["a4"],
      status: "received",
      createdAt: new Date("2026-09-11T12:00:00.000Z").toISOString()
    }
  ];

  // Proposal 1: 36 hours old pending approval (aging!)
  // Proposal 2: 2 hours old pending approval
  // Proposal 3: with unlinked_receipt line (EC-49)
  const proposals = [
    {
      id: "prop-aging-1",
      submissionId: "sub-1",
      version: 1,
      state: "PENDING_APPROVAL",
      header: { documentType: "waybill" },
      lines: [],
      questions: [{ id: "q1", questionKey: "confirm_destination", type: "choice", prompt: "Confirm?" }],
      tier: 2,
      createdAt: new Date("2026-09-20T00:00:00.000Z").toISOString()
    },
    {
      id: "prop-recent-2",
      submissionId: "sub-2",
      version: 1,
      state: "PENDING_APPROVAL",
      header: { documentType: "waybill" },
      lines: [],
      questions: [],
      tier: 1,
      createdAt: new Date("2026-09-21T10:00:00.000Z").toISOString()
    },
    {
      id: "prop-unlinked-3",
      submissionId: "sub-3",
      version: 1,
      state: "APPROVED",
      header: { documentType: "waybill" },
      lines: [
        {
          lineNo: 1,
          extractedDescription: "Unknown Valve",
          extractedSerials: ["VLV-99"],
          quantity: 1,
          matchState: "exact",
          assetId: "a-vlv",
          candidates: [],
          flags: ["unlinked_receipt"],
          action: "move"
        }
      ],
      questions: [],
      tier: 2,
      createdAt: new Date("2026-09-21T08:00:00.000Z").toISOString()
    }
  ];

  const digest = digestService.generateDigest("2026-09-21", dispatches, proposals, now);

  assert.equal(digest.counts.overdueDispatches, 1);
  assert.equal(digest.overdueDispatches[0].dispatchId, "dsp-overdue-1");
  assert.equal(digest.counts.agingApprovals, 1);
  assert.equal(digest.agingApprovals[0].proposalId, "prop-aging-1");
  assert.equal(digest.counts.unresolvedQuestions, 1);
  assert.equal(digest.counts.unlinkedReceipts, 1);
  assert.match(digest.fallbackText, /Overdue Dispatches: 1/);
});

test("JobScheduler (FR-OPS-01): heartbeat-tracked catch-up runs missed jobs without duplicate runs", async () => {
  const scheduler = new JobScheduler();

  // Day 1: normal scheduled run
  const run1 = await scheduler.runOrCatchUp("daily_digest", ["2026-09-18"], async (date) => {
    return { date, status: "completed" };
  });
  assert.deepEqual(run1.executedDates, ["2026-09-18"]);
  assert.deepEqual(run1.skippedDates, []);

  // System went offline for 2 days. On restart, scheduler is tasked with checking 2026-09-18, 19, 20
  const catchUpRun = await scheduler.runOrCatchUp(
    "daily_digest",
    ["2026-09-18", "2026-09-19", "2026-09-20"],
    async (date) => {
      return { date, status: "catch_up_executed" };
    }
  );

  // 2026-09-18 was already run -> skipped!
  // 2026-09-19 and 2026-09-20 -> executed!
  assert.deepEqual(catchUpRun.executedDates, ["2026-09-19", "2026-09-20"]);
  assert.deepEqual(catchUpRun.skippedDates, ["2026-09-18"]);

  // Immediate second check -> all dates skipped, zero duplicates!
  const thirdCheck = await scheduler.runOrCatchUp(
    "daily_digest",
    ["2026-09-18", "2026-09-19", "2026-09-20"],
    async () => {
      throw new Error("Should never execute!");
    }
  );
  assert.deepEqual(thirdCheck.executedDates, []);
  assert.deepEqual(thirdCheck.skippedDates, ["2026-09-18", "2026-09-19", "2026-09-20"]);
});

test("DeadLetterQueue (PRD §28, §30): enqueuing emits admin alert and enables job replay", async () => {
  const eventHub = new EventHub();
  const dlq = new DeadLetterQueue(eventHub);

  // Enqueue failed background job
  const entry = dlq.enqueue({
    jobType: "extract_document",
    payload: { documentId: "doc-corrupted-99", fileBytes: 1024 },
    error: "AI Provider API 500: unrecoverable inference crash",
    attempts: 5,
    submissionId: "sub-corrupted-99"
  });

  assert.ok(entry.id);
  assert.equal(entry.status, "pending_review");
  assert.equal(dlq.getPendingCount(), 1);

  // Verify that an admin alert event was automatically emitted to EventHub
  const events = eventHub.getAllEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "job.dead_lettered");
  assert.equal(events[0].audience.includes("admin"), true);
  assert.equal(events[0].payload.deadLetterId, entry.id);

  // Replay job after downstream issue resolved
  let replayHandled = false;
  const replayRes = await dlq.replay(entry.id, async (payload) => {
    assert.equal(payload.documentId, "doc-corrupted-99");
    replayHandled = true;
    return true;
  });

  assert.equal(replayRes.success, true);
  assert.equal(replayHandled, true);
  assert.equal(entry.status, "replayed");
  assert.equal(dlq.getPendingCount(), 0);
});
