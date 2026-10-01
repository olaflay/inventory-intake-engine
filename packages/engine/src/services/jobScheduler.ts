export interface HeartbeatEntry {
  jobType: string;
  idempotencyKey: string;
  executedAt: string;
  status: "success" | "failed";
  details?: Record<string, unknown>;
}

export interface CatchUpRunResult {
  executedDates: string[];
  skippedDates: string[];
}

/**
 * JobScheduler (FR-OPS-01, PRD §28, §29)
 * Manages scheduled job execution with heartbeat-tracked idempotency keys.
 * Detects missed runs (e.g. after service downtime) and executes catch-up
 * runs exactly once without duplicate notifications.
 */
export class JobScheduler {
  private heartbeats: Map<string, HeartbeatEntry> = new Map();

  private makeKey(jobType: string, dateStr: string): string {
    return `${jobType}:${dateStr}`;
  }

  isAlreadyExecuted(jobType: string, dateStr: string): boolean {
    const key = this.makeKey(jobType, dateStr);
    const entry = this.heartbeats.get(key);
    return entry !== undefined && entry.status === "success";
  }

  recordRun(jobType: string, dateStr: string, status: "success" | "failed" = "success", details?: Record<string, unknown>): void {
    const key = this.makeKey(jobType, dateStr);
    this.heartbeats.set(key, {
      jobType,
      idempotencyKey: key,
      executedAt: new Date().toISOString(),
      status,
      details
    });
  }

  /**
   * Runs a job for target dates with catch-up idempotency (FR-OPS-01).
   * If a date was already successfully run, it is safely skipped.
   */
  async runOrCatchUp(
    jobType: string,
    targetDates: string[],
    jobFn: (date: string) => Promise<Record<string, unknown> | void>
  ): Promise<CatchUpRunResult> {
    const executedDates: string[] = [];
    const skippedDates: string[] = [];

    for (const dateStr of targetDates) {
      if (this.isAlreadyExecuted(jobType, dateStr)) {
        skippedDates.push(dateStr);
        continue;
      }

      try {
        const details = await jobFn(dateStr);
        this.recordRun(jobType, dateStr, "success", details || undefined);
        executedDates.push(dateStr);
      } catch (err: any) {
        this.recordRun(jobType, dateStr, "failed", { error: err.message });
        throw err;
      }
    }

    return {
      executedDates,
      skippedDates
    };
  }

  getHeartbeat(jobType: string, dateStr: string): HeartbeatEntry | undefined {
    return this.heartbeats.get(this.makeKey(jobType, dateStr));
  }

  getAllHeartbeats(): HeartbeatEntry[] {
    return Array.from(this.heartbeats.values());
  }

  reset(): void {
    this.heartbeats.clear();
  }
}
