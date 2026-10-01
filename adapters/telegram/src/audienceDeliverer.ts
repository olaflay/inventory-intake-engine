import type { EngineIntent, OutboundMessage } from "./types.js";
import { renderIntent } from "./renderer.js";

export const TELEGRAM_MAX_TEXT_LENGTH = 4096;

export interface AudienceDeliveryResult {
  deliveredChats: number[];
  undeliverableActors: string[];
  status: "delivered" | "partially_delivered" | "undeliverable" | "duplicate_ignored";
}

export type OutboundSendFunction = (message: OutboundMessage) => Promise<void>;

/**
 * Audience Deliverer & Rate-Limited Outbound Queue (FR-TG-09, FR-TG-10).
 * Manages actor chat ID routing, per-chat throttling (~1 msg/sec), message chunking, and intent deduplication.
 */
export class AudienceDeliverer {
  private actorChats: Map<string, number> = new Map();
  private deliveredIntents: Set<string> = new Set();
  private chatQueues: Map<number, OutboundMessage[]> = new Map();
  private chatProcessing: Set<number> = new Set();
  private rateLimitDelayMs: number;
  private sendFn?: OutboundSendFunction;
  private undeliverableHandler?: (intent: EngineIntent, missingActors: string[]) => void;

  constructor(options?: {
    rateLimitDelayMs?: number;
    sendFn?: OutboundSendFunction;
    onUndeliverable?: (intent: EngineIntent, missingActors: string[]) => void;
  }) {
    this.rateLimitDelayMs = options?.rateLimitDelayMs ?? 1000;
    this.sendFn = options?.sendFn;
    this.undeliverableHandler = options?.onUndeliverable;
  }

  /**
   * Registers or updates the active chat ID for a given actor (e.g. "telegram:12345").
   */
  public registerChat(actorId: string, chatId: number): void {
    this.actorChats.set(actorId, chatId);
  }

  public getChatId(actorId: string): number | undefined {
    return this.actorChats.get(actorId);
  }

  /**
   * Delivers an engine intent to every actor in intent.audience.
   * Reports "undeliverable" if no actors can be reached (FR-TG-09).
   * Deduplicates on intentId (FR-TG-10).
   */
  public async deliverIntent(intent: EngineIntent): Promise<AudienceDeliveryResult> {
    // 1. Deduplication on intentId (FR-TG-10)
    if (this.deliveredIntents.has(intent.intentId)) {
      return {
        deliveredChats: [],
        undeliverableActors: [],
        status: "duplicate_ignored"
      };
    }

    const deliveredChats: number[] = [];
    const undeliverableActors: string[] = [];

    // 2. Resolve audience to chat IDs
    for (const actorId of intent.audience) {
      const chatId = this.actorChats.get(actorId);
      if (chatId !== undefined) {
        deliveredChats.push(chatId);
      } else {
        undeliverableActors.push(actorId);
      }
    }

    // If none can be reached, report undeliverable (FR-TG-09)
    if (deliveredChats.length === 0) {
      if (this.undeliverableHandler) {
        this.undeliverableHandler(intent, undeliverableActors);
      }
      return {
        deliveredChats: [],
        undeliverableActors,
        status: "undeliverable"
      };
    }

    // 3. Render intent
    const rendered = renderIntent(intent);

    // 4. Split message if exceeding platform limits (FR-TG-10)
    const chunks = this.splitMessage(rendered.text, TELEGRAM_MAX_TEXT_LENGTH);

    // 5. Enqueue messages for each delivered chat
    for (const chatId of deliveredChats) {
      for (let i = 0; i < chunks.length; i++) {
        const isLastChunk = i === chunks.length - 1;
        const msg: OutboundMessage = {
          chatId,
          text: chunks[i],
          // Attach keyboard only to the last chunk
          inlineKeyboard: isLastChunk ? rendered.inlineKeyboard : undefined,
          intentId: intent.intentId
        };
        await this.enqueueMessage(chatId, msg);
      }
    }

    this.deliveredIntents.add(intent.intentId);

    return {
      deliveredChats,
      undeliverableActors,
      status: undeliverableActors.length > 0 ? "partially_delivered" : "delivered"
    };
  }

  /**
   * Splits message text into chunks that respect the platform max length.
   */
  public splitMessage(text: string, maxLen: number = TELEGRAM_MAX_TEXT_LENGTH): string[] {
    if (text.length <= maxLen) {
      return [text];
    }

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > maxLen) {
      // Find clean break on newline or space before maxLen
      let splitIdx = remaining.lastIndexOf("\n", maxLen);
      if (splitIdx <= 0) {
        splitIdx = remaining.lastIndexOf(" ", maxLen);
      }
      if (splitIdx <= 0) {
        splitIdx = maxLen; // Hard split if no spaces/newlines found
      }

      chunks.push(remaining.slice(0, splitIdx).trimEnd());
      remaining = remaining.slice(splitIdx).trimStart();
    }

    if (remaining.length > 0) {
      chunks.push(remaining);
    }

    return chunks;
  }

  private async enqueueMessage(chatId: number, message: OutboundMessage): Promise<void> {
    let queue = this.chatQueues.get(chatId);
    if (!queue) {
      queue = [];
      this.chatQueues.set(chatId, queue);
    }
    queue.push(message);

    if (!this.chatProcessing.has(chatId)) {
      this.processChatQueue(chatId);
    }
  }

  private async processChatQueue(chatId: number): Promise<void> {
    this.chatProcessing.add(chatId);
    const queue = this.chatQueues.get(chatId);

    while (queue && queue.length > 0) {
      const msg = queue.shift();
      if (msg && this.sendFn) {
        try {
          await this.sendFn(msg);
        } catch (err) {
          // In real use, could log or retry; keep going to not block queue
        }
      }

      if (queue.length > 0 && this.rateLimitDelayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, this.rateLimitDelayMs));
      }
    }

    this.chatProcessing.delete(chatId);
  }

  public clear(): void {
    this.actorChats.clear();
    this.deliveredIntents.clear();
    this.chatQueues.clear();
    this.chatProcessing.clear();
  }
}
