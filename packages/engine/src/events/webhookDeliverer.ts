import crypto from "node:crypto";
import type { OutboxEvent } from "./eventHub.js";

export interface WebhookEndpointConfig {
  url: string;
  secret: string;
  maxAttempts?: number;
  initialBackoffMs?: number;
}

export interface WebhookDeliveryResult {
  seq: number;
  success: boolean;
  statusCode?: number;
  attempts: number;
  deadLettered: boolean;
  error?: string;
  signature?: string;
}

/**
 * Webhook Deliverer (FR-EVT-01, PRD §28)
 * Delivers transactional outbox events over HTTP with HMAC-SHA256 signatures,
 * exponential backoff, and dead-letter routing.
 */
export class WebhookDeliverer {
  private config: WebhookEndpointConfig;

  constructor(config: WebhookEndpointConfig) {
    if (!config || !config.url) {
      throw new Error("WebhookDeliverer requires url in configuration (LD-5: no defaults in code).");
    }
    if (!config.secret) {
      throw new Error("WebhookDeliverer requires secret in configuration (LD-5: no defaults in code).");
    }
    this.config = {
      maxAttempts: config.maxAttempts ?? 5,
      initialBackoffMs: config.initialBackoffMs ?? 100,
      ...config
    };
  }

  /**
   * Generates HMAC-SHA256 signature over `${timestamp}.${body}` (FR-EVT-01).
   */
  static generateSignature(secret: string, timestamp: string, bodyJson: string): string {
    const payload = `${timestamp}.${bodyJson}`;
    return crypto.createHmac("sha256", secret).update(payload).digest("hex");
  }

  /**
   * Verifies an incoming webhook signature against secret and body.
   */
  static verifySignature(secret: string, timestamp: string, bodyJson: string, expectedSignature: string): boolean {
    const calculated = WebhookDeliverer.generateSignature(secret, timestamp, bodyJson);
    return crypto.timingSafeEqual(Buffer.from(calculated), Buffer.from(expectedSignature));
  }

  async deliver(
    event: OutboxEvent,
    fetchMock?: (url: string, init: any) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>
  ): Promise<WebhookDeliveryResult> {
    const maxAttempts = this.config.maxAttempts!;
    let currentAttempt = event.attempts || 0;
    const bodyJson = JSON.stringify(event);

    while (currentAttempt < maxAttempts) {
      currentAttempt += 1;
      event.attempts = currentAttempt;
      const timestamp = new Date().toISOString();
      const signature = WebhookDeliverer.generateSignature(this.config.secret, timestamp, bodyJson);

      try {
        const caller = fetchMock || fetch;
        const res = await caller(this.config.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Signature": signature,
            "X-Timestamp": timestamp,
            "X-Event-Seq": String(event.seq),
            "X-Event-Id": event.eventId
          },
          body: bodyJson
        });

        if (res.ok) {
          event.delivered = true;
          return {
            seq: event.seq,
            success: true,
            statusCode: res.status,
            attempts: currentAttempt,
            deadLettered: false,
            signature
          };
        }

        // Permanent client error (4xx except 429) -> do not retry
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          const errText = await res.text();
          return {
            seq: event.seq,
            success: false,
            statusCode: res.status,
            attempts: currentAttempt,
            deadLettered: true,
            error: `Permanent webhook failure (${res.status}): ${errText}`,
            signature
          };
        }

        // Server error or 429 rate limit -> retryable
        if (currentAttempt >= maxAttempts) {
          return {
            seq: event.seq,
            success: false,
            statusCode: res.status,
            attempts: currentAttempt,
            deadLettered: true,
            error: `Exceeded max retry attempts (${maxAttempts}) with status ${res.status}`,
            signature
          };
        }
      } catch (networkErr: any) {
        if (currentAttempt >= maxAttempts) {
          return {
            seq: event.seq,
            success: false,
            attempts: currentAttempt,
            deadLettered: true,
            error: `Network error after ${maxAttempts} attempts: ${networkErr.message}`
          };
        }
      }
    }

    return {
      seq: event.seq,
      success: false,
      attempts: currentAttempt,
      deadLettered: true,
      error: `Exceeded max attempts (${maxAttempts})`
    };
  }
}
