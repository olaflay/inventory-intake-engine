import http, { IncomingMessage, ServerResponse } from "node:http";
import type { EngineIntent } from "./types.js";
import { renderIntent } from "./renderer.js";

export interface TelegramAdapterConfig {
  port: number;
  webhookSecret: string;
  botToken: string;
  engineBaseUrl: string;
  engineAdapterKey: string;
}

export class TelegramAdapterServer {
  private server: http.Server;
  private port: number;
  private secret: string;
  private processedUpdates: Set<number> = new Set();

  constructor(config: TelegramAdapterConfig) {
    this.port = config.port;
    this.secret = config.webhookSecret;
    this.server = http.createServer((req, res) => this.handleWebhook(req, res));
  }

  private handleWebhook(req: IncomingMessage, res: ServerResponse): void {
    if (req.method !== "POST" || req.url !== "/webhook/telegram") {
      res.writeHead(404);
      res.end();
      return;
    }

    // Verify secret token header (FR-TG-01)
    const secretHeader = req.headers["x-telegram-bot-api-secret-token"];
    if (secretHeader !== this.secret) {
      res.writeHead(403);
      res.end(JSON.stringify({ error: "Invalid secret token" }));
      return;
    }

    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      try {
        const update = JSON.parse(body || "{}");
        const updateId = update.update_id;

        // Deduplicate update_id (FR-TG-01)
        if (this.processedUpdates.has(updateId)) {
          res.writeHead(200);
          res.end(JSON.stringify({ ok: true, note: "duplicate ignored" }));
          return;
        }

        this.processedUpdates.add(updateId);

        // Acknowledge within seconds
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400);
        res.end();
      }
    });
  }

  public renderAndFormat(intent: EngineIntent) {
    return renderIntent(intent);
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
}
