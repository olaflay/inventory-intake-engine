import type { UUID, MatchResult } from "../types.js";

export interface ReconcileAsset {
  id: UUID;
  description: string;
  serials: string[];
  locationId: UUID | null;
  statusCode: string;
}

export interface ReconcileLine {
  lineNo: number;
  matchResult: MatchResult;
  matchedAsset?: ReconcileAsset | null;
}

export interface ReconcileResult {
  verifiedLines: ReconcileLine[];
  conflictingLines: ReconcileLine[];
  unknownLines: ReconcileLine[];
  missingFromList: {
    assetId: UUID;
    description: string;
    serials: string[];
  }[];
}

export class ManifestReconciler {
  /**
   * Implements FR-PRO-04 State-Assertion Reconciliation.
   * Categorizes manifest lines and identifies assets at location missing from the manifest.
   */
  static reconcile(
    lines: ReconcileLine[],
    assertedLocationId: UUID,
    allLocationAssets: ReconcileAsset[]
  ): ReconcileResult {
    const verifiedLines: ReconcileLine[] = [];
    const conflictingLines: ReconcileLine[] = [];
    const unknownLines: ReconcileLine[] = [];
    const accountedAssetIds = new Set<UUID>();

    for (const line of lines) {
      const asset = line.matchedAsset;

      if (!asset) {
        unknownLines.push(line);
        continue;
      }

      accountedAssetIds.add(asset.id);

      // Consistent with database: asset is already recorded at the asserted location
      if (asset.locationId === assertedLocationId) {
        verifiedLines.push(line);
      } else {
        // Conflicting: asset is in database, but recorded at another location
        conflictingLines.push(line);
      }
    }

    // EC-40: Find assets database places at the asserted location that the manifest omitted
    const missingFromList = allLocationAssets
      .filter(a => a.locationId === assertedLocationId && !accountedAssetIds.has(a.id))
      .map(a => ({
        assetId: a.id,
        description: a.description,
        serials: a.serials
      }));

    return {
      verifiedLines,
      conflictingLines,
      unknownLines,
      missingFromList
    };
  }
}
