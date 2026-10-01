import type { UUID, LedgerEntry } from "@inventory/domain";

export interface ReplayedAssetState {
  assetId: UUID;
  locationId: UUID | null;
  movementState: "at_location" | "in_transit";
  statusCode: string;
  totalEntries: number;
}

/**
 * Ledger Replayer (FR-TXN-05, Invariant I1)
 * Pure, deterministic replay of an asset's immutable ledger history
 * to assert that the current database state equals the replayed state.
 */
export class LedgerReplayer {
  static replayAssetHistory(assetId: UUID, history: LedgerEntry[]): ReplayedAssetState {
    const assetEntries = history
      .filter(e => e.assetId === assetId)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    let currentLocationId: UUID | null = null;
    let currentMovementState: "at_location" | "in_transit" = "at_location";
    let currentStatusCode = "OPERATIONAL";

    for (const entry of assetEntries) {
      if (entry.movementState) {
        currentMovementState = entry.movementState;
      }

      if (entry.toLocationId !== undefined && entry.toLocationId !== null) {
        currentLocationId = entry.toLocationId;
      } else if (entry.fromLocationId) {
        currentLocationId = entry.fromLocationId;
      }

      if (entry.statusCode) {
        currentStatusCode = entry.statusCode;
      }
    }

    return {
      assetId,
      locationId: currentLocationId,
      movementState: currentMovementState,
      statusCode: currentStatusCode,
      totalEntries: assetEntries.length
    };
  }
}
