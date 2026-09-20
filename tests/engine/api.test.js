import test from "node:test";
import assert from "node:assert/strict";
import { EngineApiServer, ExcelFormExporter } from "../../packages/engine/dist/index.js";

test("Engine API Server: health checks and authentication gating", async () => {
  const server = new EngineApiServer({ port: 48991, adapterKeyPepper: "pepper-123" });
  await server.listen();

  try {
    // 1. Health check
    const healthRes = await fetch("http://localhost:48991/healthz");
    assert.equal(healthRes.status, 200);
    const healthData = await healthRes.json();
    assert.equal(healthData.status, "ok");

    // 2. Auth rejection on protected endpoint
    const unauthRes = await fetch("http://localhost:48991/v1/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actor: { ref: "telegram:123" } })
    });
    assert.equal(unauthRes.status, 401);

    // 3. Authorized submission creation
    const authRes = await fetch("http://localhost:48991/v1/submissions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer test-adapter-key"
      },
      body: JSON.stringify({ actor: { ref: "telegram:123" } })
    });
    assert.equal(authRes.status, 201);
    const subData = await authRes.json();
    assert.equal(subData.state, "DRAFT");
    assert.match(subData.id, /^sub-/);
  } finally {
    await server.close();
  }
});

test("ExcelFormExporter: generates projection with verified totals and self-checks", () => {
  const exporter = new ExcelFormExporter();
  const sheets = [
    {
      categoryCode: "SURVEY",
      sheetName: "SURVEY EQUIPMENT",
      rows: [
        {
          internalRef: "GOSL/SE/001",
          description: "Meridian Gyro",
          categoryCode: "SURVEY",
          statusCode: "OPERATIONAL",
          locationName: "Warami 10",
          serialNumbers: ["8709"]
        }
      ]
    },
    {
      categoryCode: "IT",
      sheetName: "IT EQUIPMENT",
      rows: [
        {
          internalRef: "GOSL/SE/088",
          description: "HP CPU",
          categoryCode: "IT",
          statusCode: "OPERATIONAL",
          locationName: "Base Store",
          serialNumbers: ["6CR5420WK4"]
        }
      ]
    }
  ];

  const result = exporter.generateProjection("GOSL", sheets);
  assert.equal(result.sheetCount, 2);
  assert.equal(result.totalItems, 2);
  assert.equal(result.selfCheckPassed, true);
  assert.match(result.filename, /^GOSL_INVENTORY_\d{4}_\d{2}_\d{2}\.xlsx$/);
});
