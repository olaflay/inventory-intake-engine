import http, { IncomingMessage, ServerResponse } from "node:http";

export interface EngineServerConfig {
  port: number;
  adapterKeyPepper: string;
}

export class EngineApiServer {
  private server: http.Server;
  private port: number;

  constructor(config: EngineServerConfig) {
    this.port = config.port;
    this.server = http.createServer((req, res) => this.handleRequest(req, res));
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
