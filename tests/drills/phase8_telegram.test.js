import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  TelegramAdapterServer,
  CallbackStore,
  AudienceDeliverer,
  MediaDownloader,
  CommandDispatcher,
  renderIntent,
  TELEGRAM_MAX_TEXT_LENGTH
} from "../../adapters/telegram/dist/index.js";

// Helper to perform HTTP requests in tests
function postJson(port, path, headers, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          ...headers
        }
      },
      res => {
        let resBody = "";
        res.on("data", chunk => { resBody += chunk; });
        res.on("end", () => {
          let parsed;
          try { parsed = JSON.parse(resBody); } catch { parsed = resBody; }
          resolve({ status: res.statusCode, data: parsed });
        });
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

test("FR-TG-01 Webhook Secret Verification, Fast Ack & Deduplication", async () => {
  const testPort = 9811;
  const secret = "test-webhook-secret-xyz-123";
  const server = new TelegramAdapterServer({
    port: testPort,
    webhookSecret: secret,
    botToken: "dummy-token-123"
  });

  await server.listen();

  try {
    // 1. Missing / wrong secret header -> 403
    const badRes = await postJson(
      testPort,
      "/webhook/telegram",
      { "x-telegram-bot-api-secret-token": "wrong-secret" },
      { update_id: 100 }
    );
    assert.equal(badRes.status, 403);

    // 2. Correct secret header -> 200 Fast Ack
    const goodRes = await postJson(
      testPort,
      "/webhook/telegram",
      { "x-telegram-bot-api-secret-token": secret },
      { update_id: 100, message: { chat: { id: 123, type: "private" }, text: "/help" } }
    );
    assert.equal(goodRes.status, 200);
    assert.equal(goodRes.data.ok, true);

    // 3. Duplicate update_id -> 200 OK with duplicate notice
    const dupRes = await postJson(
      testPort,
      "/webhook/telegram",
      { "x-telegram-bot-api-secret-token": secret },
      { update_id: 100 }
    );
    assert.equal(dupRes.status, 200);
    assert.equal(dupRes.data.note, "duplicate ignored");
  } finally {
    await server.close();
  }
});

test("FR-TG-02 Private chats only: Group and channel updates are ignored", async () => {
  const deliverer = new AudienceDeliverer();
  const callbackStore = new CallbackStore();
  const downloader = new MediaDownloader("dummy-token");

  const dispatcher = new CommandDispatcher({
    audienceDeliverer: deliverer,
    callbackStore,
    mediaDownloader: downloader,
    getActor: () => ({ actorId: "telegram:123", telegramId: 123, role: "worker", assurance: "channel_verified" })
  });

  // Group chat update
  const groupUpdate = {
    update_id: 201,
    message: {
      message_id: 1,
      chat: { id: -100987654, type: "group" },
      date: Date.now(),
      text: "/start"
    }
  };

  const res = await dispatcher.handleUpdate(groupUpdate);
  assert.equal(res.ignored, true);
  assert.equal(res.handled, false);
});

test("FR-TG-03 Registration flow: Unregistered user receives instructions and zero inventory data", async () => {
  const deliverer = new AudienceDeliverer();
  const callbackStore = new CallbackStore();
  const downloader = new MediaDownloader("dummy-token");

  // Mock actor registry
  const registeredActors = new Map([
    ["telegram:111111", { actorId: "telegram:111111", telegramId: 111111, name: "Alice", role: "worker", assurance: "channel_verified" }]
  ]);

  const dispatcher = new CommandDispatcher({
    audienceDeliverer: deliverer,
    callbackStore,
    mediaDownloader: downloader,
    getActor: id => registeredActors.get(id) || null
  });

  // 1. Unregistered user sends message
  const unregisteredUpdate = {
    update_id: 301,
    message: {
      message_id: 1,
      from: { id: 999999, is_bot: false, first_name: "Mallory" },
      chat: { id: 999999, type: "private" },
      date: Date.now(),
      text: "Show me all assets at Onne base"
    }
  };

  const unregRes = await dispatcher.handleUpdate(unregisteredUpdate);
  assert.equal(unregRes.handled, true);
  assert.match(unregRes.replyText, /You are not registered in the system/);
  assert.match(unregRes.replyText, /telegram:999999/);
  assert.match(unregRes.replyText, /administrator to request access/);
  assert.doesNotMatch(unregRes.replyText, /Onne/); // No inventory data revealed

  // 2. Admin adds user to registry (simulating Ops Workbook reload)
  registeredActors.set("telegram:999999", {
    actorId: "telegram:999999",
    telegramId: 999999,
    name: "Mallory",
    role: "worker",
    assurance: "channel_verified"
  });

  // 3. User sends /start again
  const startUpdate = {
    update_id: 302,
    message: {
      message_id: 2,
      from: { id: 999999, is_bot: false, first_name: "Mallory" },
      chat: { id: 999999, type: "private" },
      date: Date.now(),
      text: "/start"
    }
  };

  const regRes = await dispatcher.handleUpdate(startUpdate);
  assert.equal(regRes.handled, true);
  assert.match(regRes.replyText, /Welcome to the Inventory Intake Bot, Mallory/);
});

test("FR-TG-04 & FR-TG-05 Media handling: photos vs files, coaching tip, and album aggregation", async () => {
  const downloadedFiles = [];
  const mockFetcher = async fileId => {
    downloadedFiles.push(fileId);
    return Buffer.from(`mock-file-content-for-${fileId}`);
  };

  const downloader = new MediaDownloader("dummy-bot-token", mockFetcher);

  // 1. Download Photo (selects largest resolution)
  const photoUpdate = await downloader.downloadPhoto([
    { file_id: "photo-small-1", file_unique_id: "u1", width: 100, height: 100 },
    { file_id: "photo-large-2", file_unique_id: "u2", width: 1024, height: 768 }
  ], "album-group-42");

  assert.equal(photoUpdate.fileId, "photo-large-2");
  assert.equal(photoUpdate.sentAs, "photo");
  assert.equal(photoUpdate.mediaGroupId, "album-group-42");
  assert.equal(photoUpdate.buffer.toString(), "mock-file-content-for-photo-large-2");

  // Coaching tip for photos
  const tip = downloader.getCoachingTip("photo");
  assert.match(tip, /Tip: For documents and waybills, sending as a file/);

  // 2. Download Document (file)
  const docUpdate = await downloader.downloadDocument({
    file_id: "doc-pdf-99",
    file_unique_id: "u3",
    file_name: "waybill_001434.pdf",
    mime_type: "application/pdf"
  }, "album-group-42");

  assert.equal(docUpdate.fileId, "doc-pdf-99");
  assert.equal(docUpdate.sentAs, "file");
  assert.equal(docUpdate.mimeType, "application/pdf");
  assert.equal(docUpdate.mediaGroupId, "album-group-42");
  assert.equal(downloader.getCoachingTip("file"), null);
});

test("FR-TG-06 Commands: /start, /help, /whoami, /done, /cancel, /status, /pending, /history", async () => {
  const deliverer = new AudienceDeliverer();
  const callbackStore = new CallbackStore();
  const downloader = new MediaDownloader("dummy-token", async () => Buffer.from("test"));

  const workerActor = {
    actorId: "telegram:555",
    telegramId: 555,
    name: "John Dispatcher",
    role: "warehouse_worker",
    assurance: "channel_verified"
  };

  const dispatcher = new CommandDispatcher({
    audienceDeliverer: deliverer,
    callbackStore,
    mediaDownloader: downloader,
    getActor: () => workerActor
  });

  const sendCmd = (text, chatId = 555) =>
    dispatcher.handleUpdate({
      update_id: Math.floor(Math.random() * 10000),
      message: {
        message_id: 1,
        from: { id: chatId, is_bot: false, first_name: "John" },
        chat: { id: chatId, type: "private" },
        date: Date.now(),
        text
      }
    });

  // /help
  const helpRes = await sendCmd("/help");
  assert.match(helpRes.replyText, /\/whoami/);
  assert.match(helpRes.replyText, /\/done/);
  assert.match(helpRes.replyText, /\/history/);

  // /whoami (FR-TG-11 assurance check)
  const whoamiRes = await sendCmd("/whoami");
  assert.match(whoamiRes.replyText, /telegram:555/);
  assert.match(whoamiRes.replyText, /warehouse_worker/);
  assert.match(whoamiRes.replyText, /channel_verified/);

  // /status with no draft
  const statusEmpty = await sendCmd("/status");
  assert.match(statusEmpty.replyText, /No active draft/);

  // Send photo to initiate draft
  await dispatcher.handleUpdate({
    update_id: 991,
    message: {
      message_id: 2,
      from: { id: 555, is_bot: false, first_name: "John" },
      chat: { id: 555, type: "private" },
      date: Date.now(),
      photo: [{ file_id: "pic-1", file_unique_id: "p1", width: 100, height: 100 }]
    }
  });

  // /status with active draft
  const statusDraft = await sendCmd("/status");
  assert.match(statusDraft.replyText, /Active draft: draft-/);

  // /done
  const doneRes = await sendCmd("/done");
  assert.equal(doneRes.draftAction, "closed");
  assert.match(doneRes.replyText, /has been closed and sent for processing/);

  // /cancel on clean state
  const cancelNoDraft = await sendCmd("/cancel");
  assert.match(cancelNoDraft.replyText, /No active draft to cancel/);

  // /history
  const histNoArg = await sendCmd("/history");
  assert.match(histNoArg.replyText, /Please specify a reference/);

  const histArg = await sendCmd("/history D-0134");
  assert.match(histArg.replyText, /Ledger history for 'D-0134'/);
});

test("FR-TG-07 & FR-TG-08 Intent rendering, numbered fallback replies & short callback token safety", async () => {
  const deliverer = new AudienceDeliverer();
  const callbackStore = new CallbackStore(3600 * 1000); // 1h TTL
  const downloader = new MediaDownloader("dummy-token");

  const actorId = "telegram:777";
  const dispatcher = new CommandDispatcher({
    audienceDeliverer: deliverer,
    callbackStore,
    mediaDownloader: downloader,
    getActor: () => ({ actorId, telegramId: 777, role: "worker", assurance: "channel_verified" })
  });

  // 1. Create short callback tokens for proposal actions
  const tokenApprove = callbackStore.createToken({
    proposalId: "prop-888",
    version: 1,
    action: "approve",
    actor: actorId
  });
  const tokenReject = callbackStore.createToken({
    proposalId: "prop-888",
    version: 1,
    action: "reject",
    actor: actorId
  });

  // Verify token length is short (hex 12 chars, fits within Telegram 64 bytes)
  assert.equal(tokenApprove.length, 12);

  // 2. Render intent with fallback numbers (FR-TG-07)
  const intent = {
    intentId: "int-tier2-appr",
    type: "proposal",
    messageKey: "approval_needed",
    fallbackText: "Approval needed (Tier 2): 17-line dispatch to Warami 10",
    actions: [
      { id: tokenApprove, label: "Approve" },
      { id: tokenReject, label: "Reject" }
    ],
    audience: [actorId]
  };

  const rendered = renderIntent(intent);
  assert.match(rendered.text, /1\. Approve/);
  assert.match(rendered.text, /2\. Reject/);
  assert.match(rendered.text, /\(Tap a button or reply with a number\)/);

  // 3. User clicks inline button (Callback Query)
  const buttonClickRes = await dispatcher.handleUpdate({
    update_id: 401,
    callback_query: {
      id: "cb-1",
      from: { id: 777, is_bot: false, first_name: "Approver" },
      data: tokenApprove
    }
  });
  assert.equal(buttonClickRes.handled, true);
  assert.match(buttonClickRes.replyText, /Action 'approve' processed for proposal prop-888/);

  // 4. Cross-actor click prevention: another user clicks button -> rejected
  const attackerClickRes = await dispatcher.handleUpdate({
    update_id: 402,
    callback_query: {
      id: "cb-2",
      from: { id: 666, is_bot: false, first_name: "Attacker" },
      data: tokenReject
    }
  });
  assert.match(attackerClickRes.replyText, /Invalid, expired, or unauthorized/);

  // 5. Expired token rejection
  const expiredStore = new CallbackStore(1); // 1ms TTL
  const expToken = expiredStore.createToken({
    proposalId: "prop-expired",
    version: 1,
    action: "approve",
    actor: actorId,
    ttlMs: -100 // Already expired
  });
  assert.equal(expiredStore.resolveToken(expToken, actorId), null);

  // 6. Numbered text fallback resolution (replying "1")
  // First initialize session with active intent
  await dispatcher.handleUpdate({
    update_id: 403,
    message: {
      message_id: 10,
      from: { id: 777, is_bot: false, first_name: "Approver" },
      chat: { id: 777, type: "private" },
      date: Date.now(),
      text: "/status"
    }
  });
  dispatcher.setActiveIntent(actorId, intent);

  // User replies "1"
  const textReplyRes = await dispatcher.handleUpdate({
    update_id: 404,
    message: {
      message_id: 11,
      from: { id: 777, is_bot: false, first_name: "Approver" },
      chat: { id: 777, type: "private" },
      date: Date.now(),
      text: "1"
    }
  });
  assert.equal(textReplyRes.handled, true);
  assert.match(textReplyRes.replyText, /Selected option: Approve/);
});

test("FR-TG-09 & FR-TG-10 Audience delivery, undeliverable notice, deduplication & splitting", async () => {
  const sentMessages = [];
  let undeliverableReported = null;

  const deliverer = new AudienceDeliverer({
    rateLimitDelayMs: 0, // Fast delivery for test
    sendFn: async msg => {
      sentMessages.push(msg);
    },
    onUndeliverable: (intent, missing) => {
      undeliverableReported = { intent, missing };
    }
  });

  // 1. Deliver to known actors
  deliverer.registerChat("telegram:101", 101);
  deliverer.registerChat("telegram:102", 102);

  const intentMulti = {
    intentId: "int-multi-1",
    type: "notice",
    messageKey: "items_in_transit",
    fallbackText: "12 items in transit to Warami 10. Reference D-0134.",
    audience: ["telegram:101", "telegram:102"]
  };

  const resMulti = await deliverer.deliverIntent(intentMulti);
  assert.equal(resMulti.status, "delivered");
  assert.equal(resMulti.deliveredChats.length, 2);

  // Wait a tick for async queue
  await new Promise(r => setTimeout(r, 20));
  assert.equal(sentMessages.length, 2);
  assert.equal(sentMessages[0].chatId, 101);
  assert.equal(sentMessages[1].chatId, 102);

  // 2. Deduplication on intentId (FR-TG-10): sending same intent again is ignored
  const resDup = await deliverer.deliverIntent(intentMulti);
  assert.equal(resDup.status, "duplicate_ignored");
  assert.equal(sentMessages.length, 2); // No new message sent

  // 3. Undeliverable handling (FR-TG-09): audience has no stored chat IDs
  const intentUnreachable = {
    intentId: "int-unreachable-1",
    type: "notice",
    messageKey: "alert",
    fallbackText: "Urgent inventory alert",
    audience: ["telegram:9999", "telegram:8888"]
  };

  const resUnreach = await deliverer.deliverIntent(intentUnreachable);
  assert.equal(resUnreach.status, "undeliverable");
  assert.notEqual(undeliverableReported, null);
  assert.equal(undeliverableReported.missing.length, 2);

  // 4. Message splitting (>4096 characters)
  const longText = "A".repeat(5000) + "\n\n" + "B".repeat(2000);
  const chunks = deliverer.splitMessage(longText, TELEGRAM_MAX_TEXT_LENGTH);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= TELEGRAM_MAX_TEXT_LENGTH);
  }
});

test("PRD §21.3 Sample Conversation Flow: Worker dispatch -> Destination selection -> Tier 2 Approval", async () => {
  const sentMessages = [];
  const deliverer = new AudienceDeliverer({
    rateLimitDelayMs: 0,
    sendFn: async msg => {
      sentMessages.push(msg);
    }
  });
  const callbackStore = new CallbackStore();
  const downloader = new MediaDownloader("dummy-bot-token", async () => Buffer.from("mock-doc-bytes"));

  const actors = new Map([
    ["telegram:1001", { actorId: "telegram:1001", telegramId: 1001, name: "Worker Mike", role: "worker", assurance: "channel_verified" }],
    ["telegram:2002", { actorId: "telegram:2002", telegramId: 2002, name: "Supervisor Dan", role: "supervisor", assurance: "channel_verified" }]
  ]);

  const dispatcher = new CommandDispatcher({
    audienceDeliverer: deliverer,
    callbackStore,
    mediaDownloader: downloader,
    getActor: id => actors.get(id) || null
  });

  // Step 1: Worker sends photos with caption "going to Onne today"
  deliverer.registerChat("telegram:1001", 1001);
  deliverer.registerChat("telegram:2002", 2002);

  const workerMsg = await dispatcher.handleUpdate({
    update_id: 501,
    message: {
      message_id: 1,
      from: { id: 1001, is_bot: false, first_name: "Mike" },
      chat: { id: 1001, type: "private" },
      date: Date.now(),
      caption: "going to Onne today",
      photo: [{ file_id: "waybill-photo", file_unique_id: "w1", width: 800, height: 600 }]
    }
  });
  assert.equal(workerMsg.handled, true);
  assert.match(workerMsg.replyText, /Received photo for submission/);

  // Step 2: Bot renders destination options to worker (needs_input)
  const destIntent = {
    intentId: "int-sample-dest",
    type: "needs_input",
    messageKey: "choose_destination",
    fallbackText: "I found a waybill and a loadout list for vessel WARAMI 10 with 17 lines.\nWhere should these items be recorded?",
    actions: [
      { id: "dest-1", label: "Warami 10 (vessel), via FOT Jetty, Onne" },
      { id: "dest-2", label: "FOT Jetty, Onne" },
      { id: "dest-3", label: "Cancel" }
    ],
    audience: ["telegram:1001"]
  };

  await deliverer.deliverIntent(destIntent);
  dispatcher.setActiveIntent("telegram:1001", destIntent);

  // Step 3: Worker replies with "1"
  const selectRes = await dispatcher.handleUpdate({
    update_id: 502,
    message: {
      message_id: 2,
      from: { id: 1001, is_bot: false, first_name: "Mike" },
      chat: { id: 1001, type: "private" },
      date: Date.now(),
      text: "1"
    }
  });
  assert.equal(selectRes.handled, true);
  assert.match(selectRes.replyText, /Selected option: Warami 10 \(vessel\), via FOT Jetty, Onne/);

  // Step 4: Proposal ready, Tier 2 approval needed -> Intent emitted to Approver (telegram:2002)
  const approveToken = callbackStore.createToken({
    proposalId: "prop-dispatch-0134",
    version: 1,
    action: "approve",
    actor: "telegram:2002"
  });

  const approvalIntent = {
    intentId: "int-sample-approval",
    type: "proposal",
    messageKey: "approval_needed",
    fallbackText: "Approval needed (Tier 2): 17-line dispatch to Warami 10 by Worker Mike.",
    actions: [
      { id: approveToken, label: "Approve" }
    ],
    audience: ["telegram:2002"]
  };

  await deliverer.deliverIntent(approvalIntent);

  // Step 5: Approver approves via button click callback token
  const approvalClickRes = await dispatcher.handleUpdate({
    update_id: 503,
    callback_query: {
      id: "cb-sample-appr",
      from: { id: 2002, is_bot: false, first_name: "Dan" },
      data: approveToken
    }
  });
  assert.equal(approvalClickRes.handled, true);
  assert.match(approvalClickRes.replyText, /Action 'approve' processed for proposal prop-dispatch-0134/);

  // Step 6: Confirmation intent sent back to Worker
  const confirmIntent = {
    intentId: "int-sample-confirm",
    type: "result",
    messageKey: "dispatch_confirmed",
    fallbackText: "Approved and recorded. 12 items in transit to Warami 10. Reference D-0134.",
    audience: ["telegram:1001"]
  };
  await deliverer.deliverIntent(confirmIntent);

  // Check that worker received final confirmation
  const workerMsgs = sentMessages.filter(m => m.chatId === 1001);
  const lastWorkerMsg = workerMsgs[workerMsgs.length - 1];
  assert.match(lastWorkerMsg.text, /Approved and recorded\. 12 items in transit to Warami 10\. Reference D-0134\./);
});
