import test from "node:test";
import assert from "node:assert/strict";
import { resolve, join } from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { runCli, readXlsx } from "../../packages/engine/dist/index.js";

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
  const res = await runCli([
    "export",
    "--org",
    "ApexEnergy",
    "--config",
    "tests/fixtures/export_template.json"
  ]);
  assert.equal(res.code, 0);
  assert.ok(res.data.filename.startsWith("ApexEnergy_INVENTORY_"));
  assert.equal(res.data.selfCheckPassed, true);
});

// LD-5: the exporter has no built-in template profile, so a missing
// --config must fail loudly instead of guessing a layout.
test("CLI export: refuses to run without --config (LD-5)", async () => {
  const res = await runCli(["export", "--org", "ApexEnergy"]);
  assert.equal(res.code, 1);
  assert.match(res.stderr, /--config <export_template\.json> is required/);
});

test("CLI export: projects supplied rows through the configured profile", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "cli-export-"));
  const dataPath = join(dataDir, "data.json");
  writeFileSync(
    dataPath,
    JSON.stringify([
      {
        categoryCode: "SURVEY",
        sheetName: "SURVEY EQUIPMENT",
        rows: [
          {
            internalRef: "AE/SE/001",
            description: "Meridian Gyro",
            categoryCode: "SURVEY",
            statusCode: "OPERATIONAL",
            locationType: "vessel",
            locationName: "Warami 10",
            serialNumbers: ["8709"]
          }
        ]
      }
    ]),
    "utf-8"
  );

  const res = await runCli([
    "export",
    "--org",
    "ApexEnergy",
    "--config",
    "tests/fixtures/export_template.json",
    "--data",
    dataPath
  ]);

  try {
    assert.equal(res.code, 0);
    assert.equal(res.data.totalItems, 1);
    assert.equal(res.data.sheetCount, 2);
    assert.equal(res.data.selfCheckPassed, true);
    // The configured mark/remark columns were filled from the location rule.
    const survey = readXlsx(res.data.bytes).sheets.find(s => s.name === "SURVEY EQUIPMENT");
    assert.equal(survey.cells.get("A2"), "AE/SE/001");
    assert.equal(survey.cells.get("E2"), "1");
    assert.equal(survey.cells.get("F2"), "Warami 10");
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
