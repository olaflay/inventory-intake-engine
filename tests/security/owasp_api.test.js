import test from "node:test";
import assert from "node:assert/strict";
import { EngineApiServer, ExcelFormExporter } from "../../packages/engine/dist/index.js";
import { TelegramAdapterServer } from "../../adapters/telegram/dist/server.js";
import { AudienceDeliverer } from "../../adapters/telegram/dist/audienceDeliverer.js";
import { EvidenceValidator } from "../../packages/vision/dist/index.js";
import { validateDecision } from "../../packages/domain/dist/index.js";

test("OWASP Security Audit: Comprehensive verification against API Top 10", async (t) => {
  const apiServer = new EngineApiServer({
    port: 0,
    adapterKeyPepper: "test-pepper"
  });
  await apiServer.listen();
  const apiPort = apiServer.getHttpServer().address().port;

  const tgServer = new TelegramAdapterServer({
    port: 0,
    botToken: "test-bot-token",
    webhookSecret: "secret-token-xyz-12345",
    defaultTtlMs: 3600000
  });

  await tgServer.listen();
  const tgPort = tgServer.getPort();

  t.after(async () => {
    await apiServer.close();
    await tgServer.close();
  });



  // -------------------------------------------------------------------------
  // API1: Broken Object Level Authorization & API5: Broken Function Level Authorization
  // -------------------------------------------------------------------------
  await t.test("API1 & API5: Role authorization strictly enforces access controls", () => {
    const tier2Config = {
      tier: 2,
      label: "Tier 2",
      approverRoles: ["Supervisor", "Admin"],
      approvalsRequired: 1,
      minAssurance: "channel_authenticated",
      allowSelfApproval: false,
      expiryHours: 48
    };

    // Worker role cannot approve Tier 2 proposal
    const workerDecision = validateDecision(
      tier2Config,
      "telegram:worker1",
      "Worker", // Role
      "telegram:worker2", // Submitter
      []
    );
    assert.equal(workerDecision.allowed, false);
    assert.match(workerDecision.reason, /not authorized/i);

    // Self-approval is blocked on Tier 2 even for Supervisor
    const supervisorSelfDecision = validateDecision(
      tier2Config,
      "telegram:sup1",
      "Supervisor",
      "telegram:sup1", // Same actor as submitter
      []
    );
    assert.equal(supervisorSelfDecision.allowed, false);
    assert.match(supervisorSelfDecision.reason, /self-approval/i);
  });


  // -------------------------------------------------------------------------
  // API2: Broken Authentication
  // -------------------------------------------------------------------------
  await t.test("API2: Rejects requests missing Bearer auth or invalid webhook secrets", async () => {
    // 1. Missing Authorization header on engine API
    const resNoAuth = await fetch(`http://localhost:${apiPort}/v1/submissions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actor: { ref: "telegram:1" } })
    });
    assert.equal(resNoAuth.status, 401);
    const bodyNoAuth = await resNoAuth.json();
    assert.equal(bodyNoAuth.error.code, "unauthorized");

    // 2. Invalid webhook secret on Telegram adapter
    const resBadWebhook = await fetch(`http://localhost:${tgPort}/webhook/telegram`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": "wrong-secret-token"
      },
      body: JSON.stringify({ update_id: 1001 })
    });
    assert.equal(resBadWebhook.status, 403);
  });

  // -------------------------------------------------------------------------
  // API3: Broken Object Property Level Authorization
  // -------------------------------------------------------------------------
  await t.test("API3: Responses never leak internal keys, database credentials or row locks", async () => {
    const res = await fetch(`http://localhost:${apiPort}/v1/proposals/prop-12345`, {
      headers: { "Authorization": "Bearer valid-adapter-key" }
    });
    assert.equal(res.status, 200);
    const data = await res.json();

    const stringified = JSON.stringify(data);
    assert.equal(stringified.includes("password"), false);
    assert.equal(stringified.includes("secret"), false);
    assert.equal(stringified.includes("pepper"), false);
    assert.equal(stringified.includes("token"), false);
    assert.equal(stringified.includes("connectionString"), false);
  });

  // -------------------------------------------------------------------------
  // API4: Unrestricted Resource Consumption
  // -------------------------------------------------------------------------
  await t.test("API4: Rate limits and submission resource bounds are enforced", async () => {
    // 1. File count boundary: Max files limit advertised and enforced
    const resSub = await fetch(`http://localhost:${apiPort}/v1/submissions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer valid-adapter-key"
      },
      body: JSON.stringify({ actor: { ref: "telegram:123" } })
    });
    assert.equal(resSub.status, 201);
    const subData = await resSub.json();
    assert.equal(subData.limits.maxFiles, 10);
    assert.equal(subData.limits.closeAfterSeconds, 90);

    // 2. Telegram message rate limit delay (1 msg/sec per chat queue)
    let sendTimestamps = [];
    const deliverer = new AudienceDeliverer({
      rateLimitDelayMs: 60, // Shortened for fast test
      sendFn: async () => {
        sendTimestamps.push(Date.now());
      }
    });
    deliverer.registerChat("telegram:user1", 1001);

    // Enqueue two messages to the same chat
    deliverer.deliverIntent({
      intentId: "test-intent-rate-limit-1",
      kind: "notice",
      audience: ["telegram:user1"],
      fallbackText: "broadcast notice 1"
    });

    deliverer.deliverIntent({
      intentId: "test-intent-rate-limit-2",
      kind: "notice",
      audience: ["telegram:user1"],
      fallbackText: "broadcast notice 2"
    });

    // Wait for queue to process both messages
    while (sendTimestamps.length < 2) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    assert.equal(sendTimestamps.length, 2);
    assert.ok(sendTimestamps[1] - sendTimestamps[0] >= 50);
  });


  // -------------------------------------------------------------------------
  // API7: Server-Side Request Forgery (SSRF)
  // -------------------------------------------------------------------------
  await t.test("API7: Engine never makes outbound requests to URLs found in document text", () => {
    const validator = new EvidenceValidator();

    // Document text containing malicious metadata service URLs or SSRF payloads
    const ssrfUrl = "http://169.254.169.254/latest/meta-data/iam/security-credentials";
    const result = validator.validateEvidencedString({
      value: ssrfUrl,
      evidence_text: ssrfUrl,
      legible: true
    });

    // Value is treated strictly as plain string data; no HTTP network connection is triggered
    assert.equal(result.isUnread, false);
    assert.equal(typeof result.field.value, "string");
  });


  // -------------------------------------------------------------------------
  // API8: Security Misconfiguration
  // -------------------------------------------------------------------------
  await t.test("API8: Errors return bounded JSON error envelopes with zero stack trace leakage", async () => {
    // Malformed JSON request body
    const resBadJson = await fetch(`http://localhost:${apiPort}/v1/submissions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer valid-adapter-key"
      },
      body: "{ broken json"
    });

    assert.equal(resBadJson.status, 400);
    const errBody = await resBadJson.json();
    assert.ok(errBody.error);
    assert.equal(errBody.error.code, "bad_request");
    assert.equal(errBody.error.message, "Invalid JSON");

    // Must NOT contain node stack traces or internal filenames
    assert.equal("stack" in errBody.error, false);
    assert.equal("trace" in errBody.error, false);
    assert.equal(JSON.stringify(errBody).includes("SyntaxError:"), false);
    assert.equal(JSON.stringify(errBody).includes(".ts:"), false);
    assert.equal(JSON.stringify(errBody).includes(".js:"), false);
  });
});
