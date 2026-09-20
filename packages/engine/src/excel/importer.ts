import type { UUID } from "@inventory/domain";
import { CanonicalAsset, AssetRegistry } from "../services/assetRegistry.js";

export interface RawLegacyRow {
  sheetName: string;
  rowIndex: number;
  categoryCode: string;
  itemDescription: string;
  serialRaw?: string;
  assetNo?: string;
  locationMarker?: string; // column holding mark "1"
  statusRaw?: string;
  remarks?: string;
  isTotalRow?: boolean;
}

export type ConflictKind =
  | "duplicate_serial"
  | "duplicate_asset_no"
  | "unrecorded_location"
  | "unmapped_column"
  | "description_mismatch";

export interface ConflictResolution {
  action: "merge" | "ignore" | "assign_location" | "override_description";
  targetLocationId?: UUID;
  chosenDescription?: string;
  resolvedBy?: string;
}

export interface ImportConflict {
  id: string;
  kind: ConflictKind;
  key: string; // the offending serial or asset number
  sheetNames: string[];
  rowIndices: number[];
  descriptions: string[];
  resolution?: ConflictResolution;
}

export interface ImportDryRunReport {
  totalSheets: number;
  totalRowsParsed: number;
  validItemRows: number;
  totalIgnoredTotalsRows: number;
  unrecordedLocationCount: number;
  itemsLackingBothSerialAndAssetNo: number;
  conflicts: ImportConflict[];
  canCommit: boolean;
}

export interface CommitResult {
  committedCount: number;
  importedAt: string;
  committedBy: string;
  summary: {
    mergedAssetsCount: number;
    unrecordedAssignedCount: number;
  };
}

/**
 * 3-Stage Legacy Excel Importer (LD-3, PRD §20.2, FR-IMP-01)
 * Stage 1: Analyze - Heuristic header & totals filtering
 * Stage 2: Dry-Run - Conflict detection (multi-sheet duplicates, repeated asset numbers, unrecorded locations)
 * Stage 3: Commit - Blocked until 100% conflicts resolved; commits clean records to AssetRegistry
 */
export class LegacyExcelImporter {
  private conflicts: Map<string, ImportConflict> = new Map();

  private normalize(s?: string): string {
    return (s || "").toUpperCase().replace(/[- /.]/g, "").trim();
  }

  /**
   * Stage 1: Analyze raw workbook rows
   * Filters out totals rows and summary metadata
   */
  public analyze(rows: RawLegacyRow[]): { totalRows: number; filteredItemRows: RawLegacyRow[]; totalsRowsCount: number } {
    const itemRows: RawLegacyRow[] = [];
    let totalsRowsCount = 0;

    for (const r of rows) {
      const desc = (r.itemDescription || "").toLowerCase();
      // Ignore totals rows
      if (r.isTotalRow || desc.includes("total") || desc.includes("sum(") || desc.startsWith("count")) {
        totalsRowsCount += 1;
        continue;
      }
      itemRows.push(r);
    }

    return {
      totalRows: rows.length,
      filteredItemRows: itemRows,
      totalsRowsCount
    };
  }

  /**
   * Stage 2: Dry-Run
   * Simulates full import, detects multi-sheet duplicates and repeated asset numbers,
   * generates conflict report and checks whether the commit gate can be opened.
   */
  public dryRun(rawRows: RawLegacyRow[]): ImportDryRunReport {
    const { filteredItemRows, totalsRowsCount } = this.analyze(rawRows);

    const serialMap = new Map<string, { sheets: Set<string>; rowIndices: number[]; descs: string[] }>();
    const assetNoMap = new Map<string, { sheets: Set<string>; rowIndices: number[]; descs: string[] }>();

    let unrecordedCount = 0;
    let lackingBothCount = 0;

    for (const row of filteredItemRows) {
      const normSerial = this.normalize(row.serialRaw);
      const normAssetNo = this.normalize(row.assetNo);

      if (!row.locationMarker) {
        unrecordedCount += 1;
      }

      if (!normSerial && !normAssetNo) {
        lackingBothCount += 1;
      }

      if (normSerial) {
        if (!serialMap.has(normSerial)) {
          serialMap.set(normSerial, { sheets: new Set(), rowIndices: [], descs: [] });
        }
        const entry = serialMap.get(normSerial)!;
        entry.sheets.add(row.sheetName);
        entry.rowIndices.push(row.rowIndex);
        entry.descs.push(row.itemDescription);
      }

      if (normAssetNo) {
        if (!assetNoMap.has(normAssetNo)) {
          assetNoMap.set(normAssetNo, { sheets: new Set(), rowIndices: [], descs: [] });
        }
        const entry = assetNoMap.get(normAssetNo)!;
        entry.sheets.add(row.sheetName);
        entry.rowIndices.push(row.rowIndex);
        entry.descs.push(row.itemDescription);
      }
    }

    // 1. Detect multi-sheet duplicate serials (e.g. 18 in July sample)
    for (const [normSerial, data] of serialMap.entries()) {
      if (data.sheets.size > 1) {
        const id = `conflict-serial-${normSerial}`;
        const existingRes = this.conflicts.get(id)?.resolution;
        this.conflicts.set(id, {
          id,
          kind: "duplicate_serial",
          key: normSerial,
          sheetNames: Array.from(data.sheets),
          rowIndices: data.rowIndices,
          descriptions: data.descs,
          resolution: existingRes
        });
      }
    }

    // 2. Detect repeated asset numbers across sheets (e.g. 6 in July sample)
    for (const [normAssetNo, data] of assetNoMap.entries()) {
      if (data.sheets.size > 1) {
        const id = `conflict-asset-${normAssetNo}`;
        const existingRes = this.conflicts.get(id)?.resolution;
        this.conflicts.set(id, {
          id,
          kind: "duplicate_asset_no",
          key: normAssetNo,
          sheetNames: Array.from(data.sheets),
          rowIndices: data.rowIndices,
          descriptions: data.descs,
          resolution: existingRes
        });
      }
    }

    const conflictsList = Array.from(this.conflicts.values());
    const canCommit = conflictsList.length === 0 || conflictsList.every(c => c.resolution !== undefined);

    return {
      totalSheets: new Set(rawRows.map(r => r.sheetName)).size,
      totalRowsParsed: rawRows.length,
      validItemRows: filteredItemRows.length,
      totalIgnoredTotalsRows: totalsRowsCount,
      unrecordedLocationCount: unrecordedCount,
      itemsLackingBothSerialAndAssetNo: lackingBothCount,
      conflicts: conflictsList,
      canCommit
    };
  }

  /**
   * Backwards-compatible alias for analyze and dry-run
   */
  public analyzeWorkbook(rows: RawLegacyRow[]): any {
    const report = this.dryRun(rows);
    return {
      totalSheets: report.totalSheets,
      totalRowsParsed: report.totalRowsParsed,
      unrecordedLocationCount: report.unrecordedLocationCount,
      conflicts: report.conflicts.map(c => ({
        ...c,
        serialNorm: c.key
      })),
      canCommit: report.canCommit
    };
  }

  /**
   * Records human resolution for a detected conflict
   */
  public resolveConflict(
    conflictOrId: string | ImportConflict | any,
    resolutionOrAction: ConflictResolution | "merge" | "ignore" | any
  ): any {
    const id = typeof conflictOrId === "string" ? conflictOrId : conflictOrId?.id;
    const conflict = this.conflicts.get(id);
    const resolution: ConflictResolution =
      typeof resolutionOrAction === "string"
        ? { action: resolutionOrAction }
        : resolutionOrAction;

    if (conflict) {
      conflict.resolution = resolution;
    }
    if (typeof conflictOrId === "object" && conflictOrId !== null) {
      return {
        ...conflictOrId,
        resolution
      };
    }
    return true;
  }

  /**
   * Stage 3: Commit (Tier 3 Gate)
   * Commits clean items into canonical database.
   * Throws if any conflict remains unresolved.
   */
  public commit(
    rawRows: RawLegacyRow[],
    registry: AssetRegistry,
    defaultLocationId: UUID,
    actorRef: string
  ): CommitResult {
    const dryRunReport = this.dryRun(rawRows);
    if (!dryRunReport.canCommit) {
      const unresolvedCount = dryRunReport.conflicts.filter(c => !c.resolution).length;
      throw new Error(
        `Commit Blocked (PRD §20.2): ${unresolvedCount} unresolved conflicts must be resolved before committing to inventory.`
      );
    }

    const { filteredItemRows } = this.analyze(rawRows);
    const createdAssets: CanonicalAsset[] = [];
    const seenSerials = new Set<string>();

    let idx = 1;
    let mergedCount = 0;

    for (const row of filteredItemRows) {
      const normSerial = this.normalize(row.serialRaw);

      if (normSerial) {
        // If this serial is a resolved duplicate, handle merge or ignore
        const conflict = this.conflicts.get(`conflict-serial-${normSerial}`);
        if (conflict?.resolution) {
          if (conflict.resolution.action === "ignore") {
            continue;
          }
          if (seenSerials.has(normSerial)) {
            // Already added base record during merge
            mergedCount += 1;
            continue;
          }
        }
        seenSerials.add(normSerial);
      }

      const asset: CanonicalAsset = {
        id: `ast-imp-${idx++}`,
        internalRef: row.assetNo || `REF-IMP-${idx}`,
        categoryCode: row.categoryCode || "GENERAL",
        description: row.itemDescription,
        serials: row.serialRaw ? [row.serialRaw] : [],
        locationId: defaultLocationId,
        movementState: "at_location",
        statusCode: row.statusRaw || "AVAILABLE",
        remarks: row.remarks,
        version: 1,
        updatedAt: new Date().toISOString()
      };

      createdAssets.push(asset);
    }

    registry.batchCommit(createdAssets);

    return {
      committedCount: createdAssets.length,
      importedAt: new Date().toISOString(),
      committedBy: actorRef,
      summary: {
        mergedAssetsCount: mergedCount,
        unrecordedAssignedCount: dryRunReport.unrecordedLocationCount
      }
    };
  }
}
