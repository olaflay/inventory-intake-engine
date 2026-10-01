import type { UUID, LedgerEntry, DispatchRecord } from "@inventory/domain";
import { LedgerReplayer } from "./ledgerReplayer.js";

export interface AssetUpdateIntent {
  assetId: UUID;
  expectedVersion: number;
  newLocationId: UUID | null;
  newMovementState: "at_location" | "in_transit";
  newStatusCode?: string;
  sourceLocationId?: UUID | null;
}

export interface PostProposalParams {
  proposalId?: UUID;
  proposalVersionId: UUID;
  proposalKind: "dispatch" | "receive" | "move" | "status_change" | "reversal";
  actorRef: string;
  items: AssetUpdateIntent[];
  dispatchId?: UUID;
  reversesEntryId?: UUID;
  toLocationId?: UUID | null;
  fromLocationId?: UUID | null;
  simulateCrashMidPost?: boolean;
}

export interface AssetStateRecord {
  id: UUID;
  version: number;
  locationId: UUID | null;
  movementState: "at_location" | "in_transit";
  statusCode: string;
  transitDispatchId?: UUID | null;
}

export interface PostResult {
  success: boolean;
  transactionId?: UUID;
  staleAssetId?: UUID;
  error?: string;
  dispatchRecord?: DispatchRecord;
  ledgerEntries?: LedgerEntry[];
}

export class InvariantViolationError extends Error {
  constructor(public readonly invariantId: "I1" | "I2" | "I3" | "I4", message: string) {
    super(`Invariant Violation [${invariantId}]: ${message}`);
    this.name = "InvariantViolationError";
  }
}

/**
 * Optimistic Concurrency Posting Engine (LD-11, FR-TXN-01..05)
 * Never uses row-level locking (SELECT ... FOR UPDATE).
 * Enforces atomic state transitions, linked reversals, dispatch/receive lifecycles,
 * and asserts Invariants I1–I4 after every post.
 */
export class PostingService {
  async postTransaction(
    params: PostProposalParams,
    assetStore: Map<UUID, AssetStateRecord>,
    ledgerStore: LedgerEntry[],
    dispatchStore: Map<UUID, DispatchRecord> = new Map(),
    terminalStatuses: string[] = ["SCRAPPED", "OBSOLETE", "LOST"]
  ): Promise<PostResult> {
    // Snapshot original states for atomic rollback guarantee
    const rollbackSnapshots = new Map<UUID, AssetStateRecord>();
    for (const [id, record] of assetStore.entries()) {
      rollbackSnapshots.set(id, { ...record });
    }
    const originalLedgerLength = ledgerStore.length;
    const rollbackDispatches = new Map<UUID, DispatchRecord>();
    for (const [id, d] of dispatchStore.entries()) {
      rollbackDispatches.set(id, { ...d });
    }

    const rollback = () => {
      assetStore.clear();
      for (const [id, record] of rollbackSnapshots.entries()) {
        assetStore.set(id, { ...record });
      }
      ledgerStore.length = originalLedgerLength;
      dispatchStore.clear();
      for (const [id, d] of rollbackDispatches.entries()) {
        dispatchStore.set(id, { ...d });
      }
    };

    try {
      // 1. Sort items by asset ID ascending to prevent deadlocks (LD-11)
      const sortedItems = [...params.items].sort((a, b) => a.assetId.localeCompare(b.assetId));

      // 2. Validate all expected versions and business constraints atomically (FR-TXN-01)
      for (const item of sortedItems) {
        const current = assetStore.get(item.assetId);
        if (!current || current.version !== item.expectedVersion) {
          return {
            success: false,
            staleAssetId: item.assetId,
            error: `Optimistic version conflict on asset ${item.assetId}. Expected ${item.expectedVersion} but found ${current?.version}. Proposal is STALE.`
          };
        }

        // Terminal status move block check (FR-TXN-04, EC-29)
        const isTerminal = terminalStatuses.some(s => s.toUpperCase() === current.statusCode.toUpperCase());
        if (isTerminal && item.newLocationId !== current.locationId && params.proposalKind !== "status_change") {
          return {
            success: false,
            staleAssetId: item.assetId,
            error: `Asset ${item.assetId} has terminal status '${current.statusCode}' and cannot be moved (EC-29).`
          };
        }

        // Dispatch check: cannot dispatch an asset that is already in transit (Invariant I2)
        if (params.proposalKind === "dispatch" && current.movementState === "in_transit") {
          return {
            success: false,
            staleAssetId: item.assetId,
            error: `Asset ${item.assetId} is already in transit and cannot be dispatched again (Invariant I2).`
          };
        }
      }

      // Reversal state validation (FR-TXN-03, EC-48)
      if (params.proposalKind === "reversal") {
        if (!params.reversesEntryId) {
          return { success: false, error: "Reversal transaction requires reversesEntryId." };
        }
        const originalEntry = ledgerStore.find(e => e.id === params.reversesEntryId);
        if (!originalEntry) {
          return { success: false, error: `Original ledger entry ${params.reversesEntryId} not found.` };
        }
        const current = assetStore.get(originalEntry.assetId);
        // Verify current asset state still equals the state immediately after the original entry
        if (current && (current.locationId !== originalEntry.toLocationId || current.movementState !== originalEntry.movementState)) {
          return {
            success: false,
            staleAssetId: originalEntry.assetId,
            error: `Asset state changed since original entry ${params.reversesEntryId}. Direct reversal blocked (EC-48).`
          };
        }
      }

      // 3. Apply updates
      const transactionId = `txn-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const now = new Date().toISOString();
      const newLedgerEntries: LedgerEntry[] = [];

      let newDispatchRecord: DispatchRecord | undefined;
      if (params.proposalKind === "dispatch") {
        const dispatchId = params.dispatchId || `dsp-${Date.now()}`;
        newDispatchRecord = {
          id: dispatchId,
          fromLocationId: params.fromLocationId || null as any,
          toLocationId: params.toLocationId || null as any,
          assetIds: sortedItems.map(i => i.assetId),
          status: "open",
          createdAt: now
        };
        dispatchStore.set(dispatchId, newDispatchRecord);
      } else if (params.proposalKind === "receive" && params.dispatchId) {
        const d = dispatchStore.get(params.dispatchId);
        if (d) {
          d.status = "received";
          d.receivedAt = now;
        }
      }

      for (let i = 0; i < sortedItems.length; i++) {
        // Crash mid-post simulation test (EC-46)
        if (params.simulateCrashMidPost && i === Math.floor(sortedItems.length / 2)) {
          throw new Error("Simulated mid-post crash (EC-46)");
        }

        const item = sortedItems[i];
        const current = assetStore.get(item.assetId)!;
        const beforeLocation = current.locationId;
        const beforeState = { ...current };

        current.version += 1;
        current.locationId = item.newLocationId;
        current.movementState = item.newMovementState;
        if (item.newStatusCode) {
          current.statusCode = item.newStatusCode;
        }
        if (params.proposalKind === "dispatch") {
          current.transitDispatchId = newDispatchRecord?.id;
        } else if (params.proposalKind === "receive") {
          current.transitDispatchId = null;
        }

        const ledgerEntry: LedgerEntry = {
          id: `led-${Date.now()}-${i}-${item.assetId}`,
          transactionId,
          proposalId: params.proposalId || params.proposalVersionId,
          proposalVersion: 1,
          assetId: item.assetId,
          kind: params.proposalKind,
          before: beforeState,
          after: { ...current },
          movementState: item.newMovementState,
          fromLocationId: item.sourceLocationId || beforeLocation,
          toLocationId: item.newLocationId,
          dispatchId: params.dispatchId || newDispatchRecord?.id || null,
          statusCode: current.statusCode,
          reversesEntryId: params.reversesEntryId || null,
          actorRef: params.actorRef,
          timestamp: now
        };

        ledgerStore.push(ledgerEntry);
        newLedgerEntries.push(ledgerEntry);
      }

      // 4. Invariant Checks (FR-TXN-05)
      // I3: Ledger entries created equals approved lines
      if (newLedgerEntries.length !== sortedItems.length) {
        throw new InvariantViolationError("I3", `Expected ${sortedItems.length} entries but created ${newLedgerEntries.length}`);
      }

      // I4: Version increased by exactly 1 per touched asset
      for (const item of sortedItems) {
        const current = assetStore.get(item.assetId)!;
        if (current.version !== item.expectedVersion + 1) {
          throw new InvariantViolationError("I4", `Asset ${item.assetId} version was ${item.expectedVersion}, now ${current.version}`);
        }
      }

      // I2: No asset in two open dispatches
      const openDispatches = Array.from(dispatchStore.values()).filter(d => d.status === "open");
      const openAssetCount = new Map<UUID, number>();
      for (const d of openDispatches) {
        for (const aId of d.assetIds) {
          const count = (openAssetCount.get(aId) || 0) + 1;
          if (count > 1) {
            throw new InvariantViolationError("I2", `Asset ${aId} is present in multiple open dispatches simultaneously`);
          }
          openAssetCount.set(aId, count);
        }
      }

      // I1: Replaying ledger equals asset state
      for (const item of sortedItems) {
        const current = assetStore.get(item.assetId)!;
        const replayed = LedgerReplayer.replayAssetHistory(item.assetId, ledgerStore);
        if (current.movementState !== replayed.movementState) {
          throw new InvariantViolationError("I1", `Asset ${item.assetId} movementState mismatch: DB=${current.movementState}, replayed=${replayed.movementState}`);
        }
        if (current.locationId !== replayed.locationId) {
          throw new InvariantViolationError("I1", `Asset ${item.assetId} locationId mismatch: DB=${current.locationId}, replayed=${replayed.locationId}`);
        }
      }

      return {
        success: true,
        transactionId,
        dispatchRecord: newDispatchRecord,
        ledgerEntries: newLedgerEntries
      };
    } catch (err: any) {
      // Clean rollback guarantees zero partial state (EC-46)
      rollback();
      throw err;
    }
  }
}
