import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { runCli } from "../../packages/engine/dist/index.js";

test("CLI: Displays help on --help flag", async () => {
  const res = await runCli(["--help"]);
  assert.equal(res.code, 0);
  assert.ok(res.stdout.includes("Usage: inventory-cli"));
  assert.ok(res.stdout.includes("validate-config"));
});

test("CLI: Rejects unknown command with error", async () => {
  const res = await runCli(["unknown-command"]);
  assert.equal(res.code, 1);
  assert.ok(res.stderr.includes("Unknown command"));
});

test("CLI validate-config: Successfully validates Ops Workbook JSON", async () => {
  const fixturePath = "tests/fixtures/valid_config.json";
  const res = await runCli(["validate-config", fixturePath]);

  assert.equal(res.code, 0);
  assert.ok(res.stdout.includes("Config Valid (LD-5)"));
  assert.equal(res.data.valid, true);
  assert.ok(res.data.sha256);
});

test("CLI validate-config: Fails if config file path is missing", async () => {
  const res = await runCli(["validate-config"]);
  assert.equal(res.code, 1);
  assert.ok(res.stderr.includes("Missing config file path"));
});

test("CLI submit: Creates submission draft", async () => {
  const res = await runCli(["submit", "waybill.pdf", "manifest.jpg"]);
  assert.equal(res.code, 0);
  assert.ok(res.data.id);
  assert.equal(res.data.state, "DRAFT");
});

test("CLI inspect: Inspects proposal status", async () => {
  const res = await runCli(["inspect", "prop-9988"]);
  assert.equal(res.code, 0);
  assert.equal(res.data.id, "prop-9988");
});

test("CLI approve: Records approval for proposal with specified actor", async () => {
  const res = await runCli(["approve", "prop-9988", "--actor", "supervisor-alice"]);
  assert.equal(res.code, 0);
  assert.equal(res.data.actorRef, "supervisor-alice");
  assert.equal(res.data.status, "APPROVED");
});

test("CLI export: Generates dated projection summary (LD-3)", async () => {
  const res = await runCli(["export", "--org", "ApexEnergy"]);
  assert.equal(res.code, 0);
  assert.ok(res.data.filename.startsWith("ApexEnergy_INVENTORY_"));
  assert.equal(res.data.selfCheckPassed, true);
});
