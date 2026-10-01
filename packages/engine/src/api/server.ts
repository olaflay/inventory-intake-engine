import http, { IncomingMessage, ServerResponse } from "node:http";
import { ExcelFormExporter, type ExportConfig, type SheetExportData } from "../excel/exporter.js";

export interface EngineServerConfig {
  port: number;
  adapterKeyPepper: string;
  /** Optional exporter wired to POST /v1/exports (FR-EXP-01). */
  exporter?: ExcelFormExporter;
}

export class EngineApiServer {
  private server: http.Server;
  private port: number;
  private exporter: ExcelFormExporter;
  private exportConfig?: ExportConfig;
  private exports = new Map<string, { filename: string; bytes: Buffer; selfCheckPassed: boolean; createdAt: string }>();

  constructor(config: EngineServerConfig) {
    this.port = config.port;
    this.exporter = config.exporter ?? new ExcelFormExporter();
    this.server = http.createServer((req, res) => this.handleRequest(req, res));
  }

  /** Wire the validated cfg:export_template used by POST /v1/exports. */
  public setExportConfig(config: ExportConfig): void {
    this.exportConfig = config;
  }

  private sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url || "/", `http://localhost:${this.port}`);
    const method = req.method || "GET";

    // 1. Health checks
    if (method === "GET" && (url.pathname === "/healthz" || url.pathname === "/readyz")) {
      return this.sendJson(res, 200, { status: "ok", uptime: process.uptime() });
    }

    // 2. Auth check for API routes
    if (url.pathname.startsWith("/v1/")) {
      const authHeader = req.headers["authorization"];
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return this.sendJson(res, 401, {
          error: { code: "unauthorized", message: "Missing or invalid adapter key" }
        });
      }
    }

    // 3. Dispatch routes (PRD §42)
    if (method === "POST" && url.pathname === "/v1/submissions") {
      let body = "";
      req.on("data", chunk => { body += chunk; });
      req.on("end", () => {
        try {
          if (body) JSON.parse(body);
          const submissionId = `sub-${Date.now()}`;
          return this.sendJson(res, 201, {
            id: submissionId,
            state: "DRAFT",
            limits: { maxFiles: 10, closeAfterSeconds: 90 }
          });
        } catch {
          return this.sendJson(res, 400, { error: { code: "bad_request", message: "Invalid JSON" } });
        }
      });
      return;
    }

    // Export endpoints (FR-EXP-01, PRD 20.3). Export failure never touches the ledger.
    if (method === "POST" && url.pathname === "/v1/exports") {
      let body = "";
      req.on("data", chunk => { body += chunk; });
      req.on("end", () => {
        let parsed: { organizationName?: string; sheets?: SheetExportData[] };
        try {
          parsed = body ? JSON.parse(body) : { organizationName: "", sheets: [] };
        } catch {
          return this.sendJson(res, 400, { error: { code: "bad_request", message: "Invalid JSON" } });
        }

        if (!parsed.organizationName || !Array.isArray(parsed.sheets)) {
          return this.sendJson(res, 400, {
            error: { code: "bad_request", message: "'organizationName' and 'sheets' are required" }
          });
        }

        if (!this.exportConfig) {
          return this.sendJson(res, 503, {
            error: {
              code: "export_template_not_configured",
              message: "cfg:export_template is not loaded; the exporter refuses to guess a template profile (LD-5)"
            }
          });
        }

        try {
          const result = this.exporter.generateProjection(
            parsed.organizationName,
            parsed.sheets,
            new Date(),
            this.exportConfig
          );
          const exportId = `exp-${Date.now()}`;
          this.exports.set(exportId, {
            filename: result.filename,
            bytes: result.bytes,
            selfCheckPassed: result.selfCheckPassed,
            createdAt: result.generatedAt
          });
          return this.sendJson(res, 201, {
            id: exportId,
            filename: result.filename,
            sheetCount: result.sheetCount,
            totalItems: result.totalItems,
            selfCheckPassed: result.selfCheckPassed
          });
        } catch (err: unknown) {
          const error = err as { code?: string; message?: string };
          const status = error.code === "export_self_check_failed" ? 422 : 409;
          return this.sendJson(res, status, {
            error: { code: error.code ?? "export_failed", message: error.message ?? "Export failed" }
          });
        }
      });
      return;
    }

    if (method === "GET" && url.pathname.startsWith("/v1/exports/")) {
      const exportId = url.pathname.split("/")[3];
      if (url.pathname.endsWith("/file")) {
        const record = this.exports.get(exportId);
        if (!record) {
          return this.sendJson(res, 404, { error: { code: "not_found", message: "Export not found" } });
        }
        res.writeHead(200, {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${record.filename}"`
        });
        res.end(record.bytes);
        return;
      }
      const record = this.exports.get(exportId);
      if (!record) {
        return this.sendJson(res, 404, { error: { code: "not_found", message: "Export not found" } });
      }
      return this.sendJson(res, 200, {
        id: exportId,
        filename: record.filename,
        selfCheckPassed: record.selfCheckPassed,
        createdAt: record.createdAt
      });
    }

    if (method === "GET" && url.pathname.startsWith("/v1/proposals/")) {
      const parts = url.pathname.split("/");
      const proposalId = parts[3];
      return this.sendJson(res, 200, {
        id: proposalId,
        state: "READY",
        version: 1,
        tier: 2,
        approvalsRequired: 1,
        lines: []
      });
    }

    return this.sendJson(res, 404, { error: { code: "not_found", message: "Endpoint not found" } });
  }

  public listen(): Promise<void> {
    return new Promise(resolve => {
      this.server.listen(this.port, () => resolve());
    });
  }

  public close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close(err => (err ? reject(err) : resolve()));
    });
  }

  public getHttpServer(): http.Server {
    return this.server;
  }
}
