import crypto from "node:crypto";
import type { UUID } from "@inventory/domain";
import type { EventHub } from "../events/eventHub.js";

export interface DeadLetterEntry {
  id: UUID;
  jobType: string;
  originalPayload: Record<string, unknown>;
  error: string;
  attempts: number;
  failedAt: string;
  status: "pending_review" | "resolved" | "replayed";
  submissionId?: UUID;
}

export interface EnqueueDeadLetterParams {
  jobType: string;
  payload: Record<string, unknown>;
  error: string;
  attempts: number;
  submissionId?: UUID;
}

/**
 * DeadLetterQueue (PRD §28, §30)
 * Stores failed background jobs and outbox events that have exhausted max retry attempts.
 * Emits high-priority admin alert events (job.dead_lettered) and supports replay.
 */
export class DeadLetterQueue {
  private deadLetters: Map<UUID, DeadLetterEntry> = new Map();
  private eventHub?: EventHub;

  constructor(eventHub?: EventHub) {
    this.eventHub = eventHub;
  }

  enqueue(params: EnqueueDeadLetterParams): DeadLetterEntry {
    const id = crypto.randomUUID();
    const entry: DeadLetterEntry = {
      id,
      jobType: params.jobType,
      originalPayload: params.payload,
      error: params.error,
      attempts: params.attempts,
      failedAt: new Date().toISOString(),
      status: "pending_review",
      submissionId: params.submissionId
    };

    this.deadLetters.set(id, entry);

    // Emit admin notice event (PRD §28, §30)
    if (this.eventHub) {
      this.eventHub.emit({
        type: "job.dead_lettered",
        entityType: "dead_letter",
        entityId: id,
        audience: ["admin"],
        payload: {
          deadLetterId: id,
          jobType: params.jobType,
          error: params.error,
          attempts: params.attempts,
          submissionId: params.submissionId
        }
      });
    }

    return entry;
  }

  async replay(
    id: UUID,
    handlerFn: (payload: Record<string, unknown>) => Promise<boolean>
  ): Promise<{ success: boolean; error?: string }> {
    const entry = this.deadLetters.get(id);
    if (!entry) {
      throw new Error(`Dead letter entry '${id}' not found.`);
    }

    try {
      const ok = await handlerFn(entry.originalPayload);
      if (ok) {
        entry.status = "replayed";
        return { success: true };
      }
      return { success: false, error: "Replay execution returned false" };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  getPendingCount(): number {
    return Array.from(this.deadLetters.values()).filter(d => d.status === "pending_review").length;
  }

  getAll(): DeadLetterEntry[] {
    return Array.from(this.deadLetters.values());
  }

  getById(id: UUID): DeadLetterEntry | undefined {
    return this.deadLetters.get(id);
  }

  reset(): void {
    this.deadLetters.clear();
  }
}
