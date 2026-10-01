import crypto from "node:crypto";
import type { UUID } from "@inventory/domain";

export interface OutboxEvent {
  seq: number;
  eventId: UUID;
  type: string;
  entityType: string;
  entityId: UUID;
  audience: string[];
  payload: Record<string, unknown>;
  createdAt: string;
  attempts?: number;
  delivered?: boolean;
}

export interface EmitEventParams {
  type: string;
  entityType: string;
  entityId: UUID;
  audience?: string[];
  payload: Record<string, unknown>;
}

/**
 * EventHub (FR-EVT-01, PRD §27, §28)
 * Manages transactional outbox events with monotonically increasing sequence numbers (seq),
 * unique event IDs, and cursor-based polling support.
 */
export class EventHub {
  private events: OutboxEvent[] = [];
  private currentSeq: number = 0;

  emit(params: EmitEventParams): OutboxEvent {
    this.currentSeq += 1;
    const event: OutboxEvent = {
      seq: this.currentSeq,
      eventId: crypto.randomUUID(),
      type: params.type,
      entityType: params.entityType,
      entityId: params.entityId,
      audience: params.audience || ["admin"],
      payload: params.payload,
      createdAt: new Date().toISOString(),
      attempts: 0,
      delivered: false
    };

    this.events.push(event);
    return event;
  }

  /**
   * Cursor-based polling: GET /v1/events?after=<seq>&limit=<n> (FR-EVT-01)
   */
  getEventsAfter(afterSeq: number = 0, limit: number = 50, audience?: string): OutboxEvent[] {
    return this.events
      .filter(e => e.seq > afterSeq && (!audience || e.audience.includes(audience) || e.audience.includes("*")))
      .slice(0, limit);
  }

  getEventBySeq(seq: number): OutboxEvent | undefined {
    return this.events.find(e => e.seq === seq);
  }

  markDelivered(seq: number): void {
    const ev = this.getEventBySeq(seq);
    if (ev) {
      ev.delivered = true;
    }
  }

  getAllEvents(): OutboxEvent[] {
    return [...this.events];
  }

  getCurrentSeq(): number {
    return this.currentSeq;
  }

  reset(): void {
    this.events = [];
    this.currentSeq = 0;
  }
}
