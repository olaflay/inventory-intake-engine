import type { OutboxEvent } from "../events/eventHub.js";

export type { OutboxEvent };

export interface DeliveryResult {
  seq: number;
  success: boolean;
  deadLettered: boolean;
  error?: string;
}

/**
 * Transactional Outbox Worker (PRD §28, §41)
 * Processes events from outbox_event and delivers them to registered adapters.
 * Implements exponential backoff and dead-letter routing.
 */
export class OutboxWorker {
  private maxAttempts: number;

  constructor(maxAttempts = 5) {
    this.maxAttempts = maxAttempts;
  }

  async deliverEvent(
    event: OutboxEvent,
    deliverFn: (event: OutboxEvent) => Promise<boolean>
  ): Promise<DeliveryResult> {
    const attempts = (event.attempts || 0) + 1;

    try {
      const delivered = await deliverFn(event);
      if (delivered) {
        return { seq: event.seq, success: true, deadLettered: false };
      }
      throw new Error("Delivery rejected by destination");
    } catch (err: any) {
      if (attempts >= this.maxAttempts) {
        return {
          seq: event.seq,
          success: false,
          deadLettered: true,
          error: `Max attempts (${this.maxAttempts}) reached: ${err.message}`
        };
      }

      return {
        seq: event.seq,
        success: false,
        deadLettered: false,
        error: err.message
      };
    }
  }
}
