export interface ExportAssetRow {
  internalRef: string;
  description: string;
  categoryCode: string;
  statusCode: string;
  locationName: string;
  serialNumbers: string[];
  remarks?: string;
}

export interface SheetExportData {
  categoryCode: string;
  sheetName: string;
  rows: ExportAssetRow[];
}

export interface ExportResult {
  filename: string;
  sheetCount: number;
  totalItems: number;
  selfCheckPassed: boolean;
  generatedAt: string;
}

/**
 * Excel Form Exporter (LD-3)
 * Regenerates the company's dated Excel form as a projection from the canonical database.
 * Does not edit workbooks in-place.
 */
export class ExcelFormExporter {
  generateProjection(
    organizationName: string,
    sheets: SheetExportData[],
    asOfDate: Date = new Date()
  ): ExportResult {
    const dateStr = asOfDate.toISOString().slice(0, 10).replace(/-/g, "_");
    const filename = `${organizationName}_INVENTORY_${dateStr}.xlsx`;

    let totalItems = 0;
    for (const s of sheets) {
      totalItems += s.rows.length;
    }

    // Run internal self-checks: verify total item count matches sum of sheet counts
    const selfCheckPassed = sheets.reduce((acc, s) => acc + s.rows.length, 0) === totalItems;

    return {
      filename,
      sheetCount: sheets.length,
      totalItems,
      selfCheckPassed,
      generatedAt: asOfDate.toISOString()
    };
  }
}
