#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import http from "node:http";
import {
  EngineApiServer,
  OpsWorkbookLoader,
  ExcelFormExporter
} from "../packages/engine/dist/index.js";
import {
  TelegramAdapterServer
} from "../adapters/telegram/dist/index.js";

const ENGINE_PORT = parseInt(process.env.ENGINE_PORT || process.env.PORT || "4000", 10);
const ADAPTER_PORT = parseInt(process.env.ADAPTER_PORT || "4001", 10);
const ADAPTER_PEPPER = process.env.ADAPTER_KEY_PEPPER || "local-dev-pepper-32-bytes-secure";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "test_token_dev";
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || "dev_secret";
const CONFIG_PATH = process.env.OPS_WORKBOOK_PATH || resolve(process.cwd(), "tests/fixtures/valid_config.json");
const EXPORT_TEMPLATE_PATH = process.env.EXPORT_TEMPLATE_PATH || resolve(process.cwd(), "tests/fixtures/export_template.json");

async function main() {
  console.log("===============================================================");
  console.log("    HEADLESS EQUIPMENT INVENTORY INTAKE ENGINE (PRD §42)     ");
  console.log("===============================================================");

  // 1. Load & Validate Configuration Snapshot (LD-5)
  console.log(`[Config] Loading Ops Workbook from: ${CONFIG_PATH}`);
  const rawConfig = await readFile(CONFIG_PATH, "utf-8");
  const parsedConfig = JSON.parse(rawConfig);
  const loader = new OpsWorkbookLoader();
  const snapshot = loader.validateAndCreateSnapshot(parsedConfig);
  console.log(`[Config] Snapshot validated successfully:`);
  console.log(`         - Org Name: ${snapshot.bundle.meta.org_name}`);
  console.log(`         - Snapshot ID: ${snapshot.id}`);
  console.log(`         - SHA-256: ${snapshot.sha256}`);
  console.log(`         - Active Roles: ${snapshot.bundle.roles.length}, Categories: ${snapshot.bundle.categories.length}`);

  // 2. Load Export Template Configuration (LD-3)
  console.log(`[Config] Loading Export Template from: ${EXPORT_TEMPLATE_PATH}`);
  const rawTemplate = await readFile(EXPORT_TEMPLATE_PATH, "utf-8");
  const exportTemplate = JSON.parse(rawTemplate);

  // 3. Boot Engine HTTP API Server
  const exporter = new ExcelFormExporter();
  const engineServer = new EngineApiServer({
    port: ENGINE_PORT,
    adapterKeyPepper: ADAPTER_PEPPER,
    exporter
  });
  engineServer.setExportConfig(exportTemplate);
  await engineServer.listen();
  console.log(`[Engine] HTTP API Server listening on http://localhost:${ENGINE_PORT}`);
  console.log(`         - Health Check: GET http://localhost:${ENGINE_PORT}/healthz`);
  console.log(`         - Readiness:    GET http://localhost:${ENGINE_PORT}/readyz`);
  console.log(`         - Submissions:  POST http://localhost:${ENGINE_PORT}/v1/submissions`);
  console.log(`         - Exports:      POST http://localhost:${ENGINE_PORT}/v1/exports`);

  // 4. Boot Telegram Adapter Webhook Server
  const adapterServer = new TelegramAdapterServer({
    port: ADAPTER_PORT,
    webhookSecret: TELEGRAM_WEBHOOK_SECRET,
    botToken: TELEGRAM_BOT_TOKEN,
    defaultTtlMs: 24 * 60 * 60 * 1000
  }, {
    onEngineAction: async (action) => {
      console.log(`[Adapter -> Engine] Dispatching action:`, action.action);
      return { status: "dispatched", action: action.action, timestamp: new Date().toISOString() };
    }
  });
  await adapterServer.listen();
  console.log(`[Adapter] Telegram Adapter listening on http://localhost:${ADAPTER_PORT}`);
  console.log(`          - Webhook Endpoint: POST http://localhost:${ADAPTER_PORT}/webhook/telegram`);

  // 5. Automated Health Self-Verification
  await verifyEndpoint(`http://localhost:${ENGINE_PORT}/healthz`);
  await verifyEndpoint(`http://localhost:${ENGINE_PORT}/readyz`);
  console.log("[Status] Self-check: All endpoints HEALTHY and READY (200 OK)");
  console.log("===============================================================");
  console.log(" Inventory Intake Engine & Telegram Adapter running successfully.");
  console.log(" Press Ctrl+C to terminate processes gracefully.");
  console.log("===============================================================");

  // 6. Graceful Shutdown Handlers
  const shutdown = async (signal) => {
    console.log(`\n[Shutdown] Received ${signal}. Stopping services gracefully...`);
    try {
      await engineServer.close();
      await adapterServer.close();
      console.log("[Shutdown] All servers closed cleanly.");
      process.exit(0);
    } catch (err) {
      console.error("[Shutdown] Error closing servers:", err);
      process.exit(1);
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

function verifyEndpoint(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      if (res.statusCode === 200) {
        resolve();
      } else {
        reject(new Error(`Endpoint ${url} responded with status: ${res.statusCode}`));
      }
    }).on("error", reject);
  });
}

main().catch(err => {
  console.error("[Fatal Error] Failed to start services:", err);
  process.exit(1);
});
