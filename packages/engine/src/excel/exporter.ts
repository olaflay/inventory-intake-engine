/**
 * Excel Form Exporter (LD-3, FR-EXP-01, PRD 20.3, EC-56)
 *
 * Renders the company's controlled form from the canonical database as a NEW
 * dated file. It never edits a workbook in place and never writes to inventory.
 *
 * Every sheet name, column, range, mark, remark and filename segment comes from
 * cfg:export_template. There are no defaults and no domain literals in this file
 * (LD-5): a missing mapping key makes the export fail loudly rather than guess.
 */

import { buildCountFormula, buildGrandTotalFormula, cellAddress, columnToLetter, letterToColumn, parseAddress, rowSpan } from "./cellGrid.js";
import { readXlsx, writeXlsx, type SheetCell, type SheetSpec } from "./xlsxWriter.js";

export interface ExportTemplateColumn {
  /** Semantic key, e.g. 'internal_ref'. */
  key: string;
  /** Spreadsheet column letter declared by the template profile. */
  column: string;
}

export interface ExportTemplateSheet {
  /** Sheet name as it must appear in the produced file. */
  sheet_name: string;
  /** Category code this sheet projects. */
  category_code: string;
  /** 1-based row where item rows start. */
  first_data_row: number;
  columns: ExportTemplateColumn[];
  /** Column letter of the row-count totals cell. */
  totals_column: string;
  /** Column letter the totals label is written to. Must not be an item column. */
  totals_label_column: string;
  /** Label written next to the per-sheet totals cell. */
  totals_label: string;
}

export interface LocationExportRule {
  /** Location type code from cfg:location_types. */
  location_type?: string;
  /** Specific location name; takes precedence over location_type. */
  location_name?: string;
  /** Column letter of the location mark column on the sheet. */
  mark_column: string;
  /** Column letter of the remark column on the sheet. */
  remark_column: string;
  /** Value written into the mark column. */
  mark_value: string;
  /** Remark text; '{{location}}' and '{{alias}}' are substituted. */
  remark_template?: string;
}

export interface SummarySheetConfig {
  sheet_name: string;
  first_data_row: number;
  label_column: string;
  total_column: string;
  totals_label: string;
}

export interface ExportConfig {
  version: string;
  /** e.g. '{org}_INVENTORY_{date}'. Never overwrites; the date is stamped by the exporter. */
  filename_pattern: string;
  sheets: ExportTemplateSheet[];
  summary: SummarySheetConfig;
  location_export_rules: LocationExportRule[];
  /** Serial column separator used when writing the identity cell. */
  serial_separator: string;
}

export interface ExportAssetRow {
  internalRef: string;
  description: string;
  categoryCode: string;
  statusCode: string;
  /** Location type code from cfg:location_types; selects the location_type rule. */
  locationType?: string;
  locationName: string;
  /** Location display alias; substituted into remark_template as '{alias}'. */
  locationAlias?: string;
  serialNumbers: string[];
  remarks?: string;
}

export interface SheetExportData {
  categoryCode: string;
  sheetName: string;
  rows: ExportAssetRow[];
}

export interface SelfCheckDiff {
  sheet: string;
  expectedFromDatabase: number;
  countedInFile: number;
  claimedInFile: number | null;
  reason: string;
}

export interface ExportResult {
  filename: string;
  /** Count of category data sheets in the produced file. */
  sheetCount: number;
  /** Count of category sheets plus the summary sheet. */
  totalSheetCount: number;
  totalItems: number;
  selfCheckPassed: boolean;
  generatedAt: string;
  bytes: Buffer;
  perSheetCounts: Array<{ sheetName: string; dataRows: number; formula: string; claimed: number }>;
  diff: SelfCheckDiff[];
}

export class ExportTemplateMismatchError extends Error {
  public readonly code = "export_template_mismatch";

  constructor(public readonly problems: string[]) {
    super(`Export Blocked (FR-EXP-01): template profile mismatch: ${problems.join("; ")}`);
    this.name = "ExportTemplateMismatchError";
  }
}

export class ExportSelfCheckError extends Error {
  public readonly code = "export_self_check_failed";

  constructor(public readonly diff: SelfCheckDiff[]) {
    super(`Export Failed (FR-EXP-01): self-check mismatch: ${diff.map(d => `${d.sheet}: ${d.reason}`).join("; ")}`);
    this.name = "ExportSelfCheckError";
  }
}

/** Minimal filesystem probe so 'never overwrite' is testable without real IO. */
export interface ExportTargetProbe {
  exists(filename: string): boolean;
}

export class ExcelFormExporter {
  /**
   * Render the projection.
   * `asOfDate` is injected so the filename is deterministic under test.
   */
  public generateProjection(
    organizationName: string,
    sheets: SheetExportData[],
    asOfDate: Date,
    config: ExportConfig,
    target?: ExportTargetProbe
  ): ExportResult {
    if (!config) {
      throw new Error("Export Blocked (LD-5): cfg:export_template is required; the exporter has no defaults");
    }
    const effective = config;
    this.assertTemplateProfile(effective, sheets, organizationName);

    // Dashes become underscores so the stamped date stays a safe filename segment.
    const dateSegment = asOfDate.toISOString().slice(0, 10).replace(/-/g, "_");
    const filename = effective.filename_pattern
      .replace(/\{org\}/g, organizationName)
      .replace(/\{date\}/g, dateSegment);

    if (target && target.exists(filename)) {
      throw new Error(`Export Blocked (FR-EXP-01): refusing to overwrite existing file '${filename}'`);
    }

    const sheetSpecs: SheetSpec[] = [];
    const perSheetCounts: ExportResult["perSheetCounts"] = [];
    const grandTotalRefs: Array<{ sheetName: string; address: string }> = [];
    let totalItems = 0;

    for (const template of effective.sheets) {
      const data = sheets.find(s => s.categoryCode === template.category_code);
      const rows = data ? data.rows : [];
      const span = rowSpan(rows.length, template.first_data_row);

      const cells: SheetCell[] = [];
      const identityColumn = this.requireColumn(template, "internal_ref");

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNumber = span.firstRow + i;
        for (const column of template.columns) {
          const address = cellAddress(letterToColumn(column.column), rowNumber);
          cells.push(...this.renderCell(column.key, address, row, template, effective));
        }
      }

      const countFormula = buildCountFormula(identityColumn, span);
      const totalsAddress = cellAddress(letterToColumn(template.totals_column), span.lastRow + 1);
      cells.push({ address: totalsAddress, kind: "formula", formula: countFormula, cachedValue: rows.length });
      const labelAddress = cellAddress(letterToColumn(template.totals_label_column), span.lastRow + 1);
      cells.push({ address: labelAddress, kind: "string", value: template.totals_label });

      grandTotalRefs.push({ sheetName: template.sheet_name, address: totalsAddress });
      totalItems += rows.length;
      perSheetCounts.push({ sheetName: template.sheet_name, dataRows: rows.length, formula: countFormula, claimed: rows.length });
      sheetSpecs.push({ name: template.sheet_name, cells });
    }

    const summaryCells: SheetCell[] = [];
    const grandTotalColumn = letterToColumn(effective.summary.total_column);
    const labelColumn = letterToColumn(effective.summary.label_column);
    const grandTotalFormula = buildGrandTotalFormula(grandTotalRefs);

    effective.sheets.forEach((template, index) => {
      const rowNumber = effective.summary.first_data_row + index;
      summaryCells.push({ address: cellAddress(labelColumn, rowNumber), kind: "string", value: template.sheet_name });
      summaryCells.push({ address: cellAddress(grandTotalColumn, rowNumber), kind: "number", number: perSheetCounts[index].claimed });
    });

    const grandTotalRow = effective.summary.first_data_row + effective.sheets.length;
    summaryCells.push({ address: cellAddress(labelColumn, grandTotalRow), kind: "string", value: effective.summary.totals_label });
    summaryCells.push({ address: cellAddress(grandTotalColumn, grandTotalRow), kind: "formula", formula: grandTotalFormula, cachedValue: totalItems });
    sheetSpecs.push({ name: effective.summary.sheet_name, cells: summaryCells });

    const bytes = writeXlsx({ sheets: sheetSpecs });
    const selfCheckPassed = this.selfCheck(bytes, perSheetCounts, totalItems, effective);

    return {
      filename,
      sheetCount: effective.sheets.length,
      totalSheetCount: sheetSpecs.length,
      totalItems,
      selfCheckPassed,
      generatedAt: asOfDate.toISOString(),
      bytes,
      perSheetCounts,
      diff: []
    };
  }

  /**
   * Re-read the produced bytes and recompute totals independently.
   * Counts the identity cells the file actually holds and compares them with the
   * cached value the file claims. Any mismatch throws with a diff; the ledger is
   * never touched either way.
   */
  public selfCheck(bytes: Buffer, perSheetCounts: ExportResult["perSheetCounts"], databaseTotal: number, config: ExportConfig): boolean {
    const readBack = readXlsx(bytes);
    const diff: SelfCheckDiff[] = [];

    for (const entry of perSheetCounts) {
      const sheet = readBack.sheets.find(s => s.name === entry.sheetName);
      if (!sheet) {
        diff.push({
          sheet: entry.sheetName,
          expectedFromDatabase: entry.dataRows,
          countedInFile: 0,
          claimedInFile: null,
          reason: "sheet is missing from the produced file"
        });
        continue;
      }

      const template = config.sheets.find(s => s.sheet_name === entry.sheetName);
      if (!template) continue;

      const identityColumn = this.requireColumn(template, "internal_ref");
      const span = rowSpan(entry.dataRows, template.first_data_row);
      let counted = 0;
      for (let row = span.firstRow; row <= span.lastRow; row++) {
        const value = sheet.cells.get(cellAddress(identityColumn, row));
        if (value !== undefined && String(value).trim() !== "") counted++;
      }

      const totalsAddress = cellAddress(letterToColumn(template.totals_column), span.lastRow + 1);
      const claimedRaw = sheet.cells.get(totalsAddress);
      const claimed = typeof claimedRaw === "number" ? claimedRaw : null;

      if (counted !== entry.dataRows) {
        diff.push({
          sheet: entry.sheetName,
          expectedFromDatabase: entry.dataRows,
          countedInFile: counted,
          claimedInFile: claimed,
          reason: "identity cells in the file do not match the database count"
        });
      } else if (claimed !== entry.dataRows) {
        diff.push({
          sheet: entry.sheetName,
          expectedFromDatabase: entry.dataRows,
          countedInFile: counted,
          claimedInFile: claimed,
          reason: "the file's totals cell does not match the database count"
        });
      }
    }

    const summary = readBack.sheets.find(s => s.name === config.summary.sheet_name);
    if (!summary) {
      diff.push({
        sheet: config.summary.sheet_name,
        expectedFromDatabase: databaseTotal,
        countedInFile: 0,
        claimedInFile: null,
        reason: "summary sheet is missing from the produced file"
      });
    } else {
      const grandTotalRow = config.summary.first_data_row + config.sheets.length;
      const claimedRaw = summary.cells.get(cellAddress(letterToColumn(config.summary.total_column), grandTotalRow));
      const claimed = typeof claimedRaw === "number" ? claimedRaw : null;
      if (claimed !== databaseTotal) {
        diff.push({
          sheet: config.summary.sheet_name,
          expectedFromDatabase: databaseTotal,
          countedInFile: 0,
          claimedInFile: claimed,
          reason: "grand total does not match the sum of database counts"
        });
      }
    }

    if (diff.length > 0) {
      throw new ExportSelfCheckError(diff);
    }
    return true;
  }

  /**
   * Profile/template check (FR-EXP-01).
   * A renamed sheet, an unknown category, or a data set with no declared sheet
   * blocks the export with a clear message rather than writing a wrong file.
   */
  private assertTemplateProfile(config: ExportConfig, sheets: SheetExportData[], organizationName: string): void {
    const problems: string[] = [];

    if (!organizationName || organizationName.trim() === "") {
      problems.push("organization name is empty");
    }

    const declaredCategories = new Set(config.sheets.map(s => s.category_code));
    for (const data of sheets) {
      if (!declaredCategories.has(data.categoryCode)) {
        problems.push(`category '${data.categoryCode}' has no declared sheet in the template`);
      }
      const template = config.sheets.find(s => s.category_code === data.categoryCode);
      if (template && template.sheet_name !== data.sheetName) {
        problems.push(`category '${data.categoryCode}' expects sheet '${template.sheet_name}' but the database supplied '${data.sheetName}'`);
      }
    }

    if (sheets.length > config.sheets.length) {
      problems.push("the database has more sheets than the template declares");
    }

    const seenSheetNames = new Set<string>();
    for (const template of config.sheets) {
      if (seenSheetNames.has(template.sheet_name)) {
        problems.push(`sheet '${template.sheet_name}' is declared more than once`);
      }
      seenSheetNames.add(template.sheet_name);
      if (!template.columns.some(c => c.key === "internal_ref")) {
        problems.push(`sheet '${template.sheet_name}' has no 'internal_ref' column to count`);
      }
    }

    if (problems.length > 0) {
      throw new ExportTemplateMismatchError(problems);
    }
  }

  private requireColumn(template: ExportTemplateSheet, key: string): number {
    const column = template.columns.find(c => c.key === key);
    if (!column) {
      throw new ExportTemplateMismatchError([`sheet '${template.sheet_name}' is missing the '${key}' column mapping`]);
    }
    return letterToColumn(column.column);
  }

  private renderCell(
    key: string,
    address: string,
    row: ExportAssetRow,
    template: ExportTemplateSheet,
    config: ExportConfig
  ): SheetCell[] {
    if (key === "internal_ref") {
      return [{ address, kind: "string", value: row.internalRef }];
    }
    if (key === "description") {
      return [{ address, kind: "string", value: row.description }];
    }
    if (key === "status") {
      return [{ address, kind: "string", value: row.statusCode }];
    }
    if (key === "serials") {
      return [{ address, kind: "string", value: row.serialNumbers.join(config.serial_separator) }];
    }
    if (key === "remarks") {
      return [{ address, kind: "string", value: row.remarks ?? "" }];
    }
    if (key === "location_mark") {
      const rule = this.resolveLocationRule(row, config);
      const address2 = parseAddress(address);
      const mark = rule && rule.mark_column === columnToLetter(address2.column) ? rule.mark_value : "";
      return [{ address, kind: "string", value: mark }];
    }
    if (key === "location_remark") {
      const rule = this.resolveLocationRule(row, config);
      const address2 = parseAddress(address);
      const remark = rule && rule.remark_column === columnToLetter(address2.column) ? this.renderRemark(rule, row) : "";
      return [{ address, kind: "string", value: remark }];
    }
    throw new ExportTemplateMismatchError([
      `sheet '${template.sheet_name}' declares unknown column key '${key}'`
    ]);
  }

  /**
   * cfg:location_export_rules drives location rendering (PRD 20.3 step 3).
   * A rule matched by location_name wins over one matched by location_type.
   * No rule means no mark and no remark; nothing is invented here.
   */
  private resolveLocationRule(row: ExportAssetRow, config: ExportConfig): LocationExportRule | undefined {
    // A rule scoped to a specific location name wins over the type-wide rule.
    const nameRule = config.location_export_rules.find(r => r.location_name !== undefined && r.location_name === row.locationName);
    if (nameRule) return nameRule;
    // Then match on the row's declared location type. No type means no
    // type-wide rule may be invented (LD-5: never guess a mapping).
    return config.location_export_rules.find(
      r => r.location_type !== undefined && r.location_type === row.locationType
    );
  }

  private renderRemark(rule: LocationExportRule, row: ExportAssetRow): string {
    const alias = row.locationAlias ?? row.locationName;
    return (rule.remark_template ?? "")
      .replace(/\{location\}/g, row.locationName)
      .replace(/\{alias\}/g, alias);
  }
}

  
