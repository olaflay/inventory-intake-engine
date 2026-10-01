import http, { IncomingMessage, ServerResponse } from "node:http";
import type {
  EngineIntent,
  RegisteredActor,
  TelegramAdapterConfig,
  TelegramUpdate
} from "./types.js";
import { renderIntent } from "./renderer.js";
import { CallbackStore } from "./callbackStore.js";
import { AudienceDeliverer, type OutboundSendFunction } from "./audienceDeliverer.js";
import { MediaDownloader, type FileDownloadFetcher } from "./mediaDownloader.js";
import { CommandDispatcher, type DispatchResult } from "./commandDispatcher.js";

export interface ServerAdapterOptions {
  getActor?: (actorId: string) => RegisteredActor | null;
  sendFn?: OutboundSendFunction;
  fileFetcher?: FileDownloadFetcher;
  rateLimitDelayMs?: number;
  onUndeliverable?: (intent: EngineIntent, missingActors: string[]) => void;
  onEngineAction?: (payload: any) => Promise<any>;
}

export class TelegramAdapterServer {
  private server: http.Server;
  private port: number;
  private secret: string;
  private botToken: string;
  private processedUpdates: Set<number> = new Set();

  private callbackStore: CallbackStore;
  private deliverer: AudienceDeliverer;
  private downloader: MediaDownloader;
  private dispatcher: CommandDispatcher;

  constructor(config: TelegramAdapterConfig, options?: ServerAdapterOptions) {
    this.port = config.port;
    this.secret = config.webhookSecret;
    this.botToken = config.botToken;

    this.callbackStore = new CallbackStore(config.defaultTtlMs);
    this.downloader = new MediaDownloader(this.botToken, options?.fileFetcher);

    this.deliverer = new AudienceDeliverer({
      rateLimitDelayMs: options?.rateLimitDelayMs ?? 1000,
      sendFn: options?.sendFn,
      onUndeliverable: options?.onUndeliverable
    });

    const defaultGetActor = (actorId: string): RegisteredActor | null => {
      // Default: if options.getActor provided use it, otherwise return null
      return options?.getActor ? options.getActor(actorId) : null;
    };

    this.dispatcher = new CommandDispatcher({
      audienceDeliverer: this.deliverer,
      callbackStore: this.callbackStore,
      mediaDownloader: this.downloader,
      getActor: defaultGetActor,
      onEngineAction: options?.onEngineAction
    });

    this.server = http.createServer((req, res) => this.handleWebhook(req, res));
  }

  private handleWebhook(req: IncomingMessage, res: ServerResponse): void {
    if (req.method !== "POST" || req.url !== "/webhook/telegram") {
      res.writeHead(404);
      res.end();
      return;
    }

    // FR-TG-01: Verify secret token header
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
        const update = JSON.parse(body || "{}") as TelegramUpdate;
        const updateId = update.update_id;

        // FR-TG-01: Deduplicate on update_id
        if (this.processedUpdates.has(updateId)) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, note: "duplicate ignored" }));
          return;
        }

        this.processedUpdates.add(updateId);

        // Acknowledge immediately within seconds (FR-TG-01)
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));

        // Process asynchronously
        setImmediate(() => {
          this.processUpdateAsync(update);
        });
      } catch {
        res.writeHead(400);
        res.end();
      }
    });
  }

  private async processUpdateAsync(update: TelegramUpdate): Promise<DispatchResult> {
    const result = await this.dispatcher.handleUpdate(update);

    // If dispatcher generated a direct reply message, deliver it back to chat
    if (result.replyText && update.message?.chat?.id) {
      const chatId = update.message.chat.id;
      const intent: EngineIntent = {
        intentId: `reply-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        type: "notice",
        messageKey: "adapter_reply",
        fallbackText: result.replyText,
        audience: [`telegram:${update.message.from?.id || chatId}`]
      };
      await this.deliverer.deliverIntent(intent);
    }

    return result;
  }

  public async deliverIntent(intent: EngineIntent) {
    return this.deliverer.deliverIntent(intent);
  }

  public renderAndFormat(intent: EngineIntent) {
    return renderIntent(intent);
  }

  public getCallbackStore(): CallbackStore {
    return this.callbackStore;
  }

  public getAudienceDeliverer(): AudienceDeliverer {
    return this.deliverer;
  }

  public getCommandDispatcher(): CommandDispatcher {
    return this.dispatcher;
  }

  public getMediaDownloader(): MediaDownloader {
    return this.downloader;
  }

  public getHttpServer(): http.Server {
    return this.server;
  }

  public getPort(): number {
    const addr = this.server.address();
    return typeof addr === "object" && addr ? addr.port : this.port;
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

