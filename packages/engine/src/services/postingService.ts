import type { UUID } from "@inventory/domain";

export interface AssetUpdateIntent {
  assetId: UUID;
  expectedVersion: number;
  newLocationId: UUID | null;
  newMovementState: "at_location" | "in_transit";
  newStatusCode?: string;
}

export interface PostProposalParams {
  proposalVersionId: UUID;
  proposalKind: "dispatch" | "receive" | "move" | "status_change";
  actorRef: string;
  items: AssetUpdateIntent[];
}

export interface PostResult {
  success: boolean;
  transactionId?: UUID;
  staleAssetId?: UUID;
  error?: string;
}

/**
 * Optimistic Concurrency Posting Engine (LD-11)
 * Never uses row-level locking (SELECT ... FOR UPDATE).
 * Updates assets in sorted ID order with `WHERE id = :id AND version = :version`.
 */
export class PostingService {
  /**
   * Mock / in-memory store simulation for atomic testing,
   * also maps directly to SQL transaction logic.
   */
  async postTransaction(
    params: PostProposalParams,
    assetStore: Map<UUID, { id: UUID; version: number; locationId: UUID | null; movementState: string; statusCode: string }>,
    ledgerStore: any[]
  ): Promise<PostResult> {
    // 1. Sort items by asset ID ascending to prevent deadlocks
    const sortedItems = [...params.items].sort((a, b) => a.assetId.localeCompare(b.assetId));

    // 2. Validate all expected versions atomically
    for (const item of sortedItems) {
      const current = assetStore.get(item.assetId);
      if (!current || current.version !== item.expectedVersion) {
        return {
          success: false,
          staleAssetId: item.assetId,
          error: `Optimistic version conflict on asset ${item.assetId}. Proposal is STALE.`
        };
      }
    }

    // 3. Apply updates and increment versions atomically
    const transactionId = `txn-${Date.now()}`;
    for (const item of sortedItems) {
      const current = assetStore.get(item.assetId)!;
      const beforeState = { ...current };

      current.version += 1;
      current.locationId = item.newLocationId;
      current.movementState = item.newMovementState;
      if (item.newStatusCode) {
        current.statusCode = item.newStatusCode;
      }

      ledgerStore.push({
        id: `led-${Date.now()}-${item.assetId}`,
        transactionId,
        assetId: item.assetId,
        kind: params.proposalKind,
        before: beforeState,
        after: { ...current },
        createdAt: new Date().toISOString()
      });
    }

    return {
      success: true,
      transactionId
    };
  }
}
