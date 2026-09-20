import { CanonicalAsset, AssetRegistry } from "../services/assetRegistry.js";
import { RawLegacyRow } from "./importer.js";

export interface FieldDifference {
  field: string;
  databaseValue: string;
  workbookValue: string;
}

export interface ReconcileDiscrepancy {
  assetId: string;
  internalRef: string;
  serial?: string;
  description: string;
  differences: FieldDifference[];
}

export interface ReconcileDiffReport {
  generatedAt: string;
  totalWorkbookRows: number;
  totalDatabaseAssets: number;
  matchedConsistentCount: number;
  matchedDifferent: ReconcileDiscrepancy[];
  onlyInWorkbook: RawLegacyRow[];
  onlyInDatabase: CanonicalAsset[];
  summary: {
    discrepancyCount: number;
    requiresReview: boolean;
  };
}

/**
 * Reconcile Diff Engine (FR-IMP-02, PRD §20.4)
 * Compares hand-edited Excel workbooks against canonical Postgres records.
 * Produces a 4-way diff report for human review without mutating the database.
 */
export class Reconciler {
  private normalize(s?: string): string {
    return (s || "").toUpperCase().replace(/[- /.]/g, "").trim();
  }

  public diff(workbookRows: RawLegacyRow[], registry: AssetRegistry): ReconcileDiffReport {
    const dbAssets = registry.getAll();
    const dbSerialMap = new Map<string, CanonicalAsset>();
    const matchedAssetIds = new Set<string>();

    for (const asset of dbAssets) {
      for (const s of asset.serials) {
        const norm = this.normalize(s);
        if (norm) {
          dbSerialMap.set(norm, asset);
        }
      }
    }

    let matchedConsistentCount = 0;
    const matchedDifferent: ReconcileDiscrepancy[] = [];
    const onlyInWorkbook: RawLegacyRow[] = [];

    for (const row of workbookRows) {
      const normSerial = this.normalize(row.serialRaw);
      const dbAsset = normSerial ? dbSerialMap.get(normSerial) : undefined;

      if (!dbAsset) {
        onlyInWorkbook.push(row);
        continue;
      }

      matchedAssetIds.add(dbAsset.id);

      const differences: FieldDifference[] = [];

      // Compare status if present
      if (row.statusRaw && this.normalize(row.statusRaw) !== this.normalize(dbAsset.statusCode)) {
        differences.push({
          field: "status",
          databaseValue: dbAsset.statusCode,
          workbookValue: row.statusRaw
        });
      }

      // Compare description if significantly different
      if (
        row.itemDescription &&
        this.normalize(row.itemDescription) !== this.normalize(dbAsset.description)
      ) {
        differences.push({
          field: "description",
          databaseValue: dbAsset.description,
          workbookValue: row.itemDescription
        });
      }

      // Compare location if marker indicates a specific location
      if (row.locationMarker && this.normalize(row.locationMarker) !== this.normalize(dbAsset.locationId)) {
        differences.push({
          field: "location",
          databaseValue: dbAsset.locationId,
          workbookValue: row.locationMarker
        });
      }

      if (differences.length > 0) {
        matchedDifferent.push({
          assetId: dbAsset.id,
          internalRef: dbAsset.internalRef,
          serial: row.serialRaw,
          description: dbAsset.description,
          differences
        });
      } else {
        matchedConsistentCount += 1;
      }
    }

    const onlyInDatabase = dbAssets.filter(a => !matchedAssetIds.has(a.id));

    const discrepancyCount = matchedDifferent.length + onlyInWorkbook.length + onlyInDatabase.length;

    return {
      generatedAt: new Date().toISOString(),
      totalWorkbookRows: workbookRows.length,
      totalDatabaseAssets: dbAssets.length,
      matchedConsistentCount,
      matchedDifferent,
      onlyInWorkbook,
      onlyInDatabase,
      summary: {
        discrepancyCount,
        requiresReview: discrepancyCount > 0
      }
    };
  }
}
