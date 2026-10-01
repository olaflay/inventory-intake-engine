import crypto from "node:crypto";
import type { CallbackTokenRecord } from "./types.js";

/**
 * In-memory / persistent adapter callback token store (FR-TG-08).
 * Telegram callback_data is capped at 64 bytes.
 * We store short random tokens mapped to (proposalId, version, action, actor, expiresAt).
 */
export class CallbackStore {
  private store: Map<string, CallbackTokenRecord> = new Map();
  private defaultTtlMs: number;

  constructor(defaultTtlMs: number = 3600 * 1000) {
    this.defaultTtlMs = defaultTtlMs;
  }

  /**
   * Generates a short random token and registers target action details.
   */
  public createToken(
    params: {
      proposalId: string;
      version: number;
      action: string;
      actor: string;
      ttlMs?: number;
    }
  ): string {
    const token = crypto.randomBytes(6).toString("hex"); // 12 characters, safe inside 64 bytes
    const expiresAt = Date.now() + (params.ttlMs ?? this.defaultTtlMs);

    const record: CallbackTokenRecord = {
      token,
      proposalId: params.proposalId,
      version: params.version,
      action: params.action,
      actor: params.actor,
      expiresAt
    };

    this.store.set(token, record);
    return token;
  }

  /**
   * Validates and resolves token for a specific actor.
   * Rejects if token not found, expired, or invoked by a different actor.
   */
  public resolveToken(token: string, actor: string): CallbackTokenRecord | null {
    const record = this.store.get(token);
    if (!record) return null;

    if (Date.now() > record.expiresAt) {
      this.store.delete(token);
      return null;
    }

    if (record.actor !== actor) {
      return null; // Actor mismatch
    }

    return record;
  }

  /**
   * Prunes expired tokens from memory.
   */
  public pruneExpired(): number {
    const now = Date.now();
    let removed = 0;
    for (const [token, rec] of this.store.entries()) {
      if (now > rec.expiresAt) {
        this.store.delete(token);
        removed++;
      }
    }
    return removed;
  }

  public clear(): void {
    this.store.clear();
  }

  public count(): number {
    return this.store.size;
  }
}
