import test from "node:test";
import assert from "node:assert/strict";
import {
  ExcelFormExporter,
  ExportSelfCheckError,
  ExportTemplateMismatchError,
  buildCountFormula,
  buildGrandTotalFormula,
  cellAddress,
  cellRange,
  columnToLetter,
  letterToColumn,
  parseAddress,
  readXlsx,
  rowSpan,
  writeXlsx
} from "../../packages/engine/dist/index.js";
import { EngineeringConfigLoader } from "../../packages/engine/dist/index.js";
import { EngineApiServer } from "../../packages/engine/dist/index.js";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// cfg:export_template profile for the sample company (LD-5: supplied by config)
// ---------------------------------------------------------------------------
const exampleExportConfig = {
  version: "1.0",
  filename_pattern: "{org}_INVENTORY_{date}.xlsx",
  serial_separator: ", ",
  sheets: [
    {
      sheet_name: "SURVEY EQUIPMENT",
      category_code: "SURVEY",
      first_data_row: 2,
      totals_column: "B",
      totals_label_column: "H",
      totals_label: "Total",
      columns: [
        { key: "internal_ref", column: "A" },
        { key: "description", column: "C" },
        { key: "status", column: "D" },
        { key: "location_mark", column: "E" },
        { key: "location_remark", column: "F" },
        { key: "remarks", column: "G" }
      ]
    },
    {
      sheet_name: "IT EQUIPMENT",
      category_code: "IT",
      first_data_row: 2,
      totals_column: "B",
      totals_label_column: "H",
      totals_label: "Total",
      columns: [
        { key: "internal_ref", column: "A" },
        { key: "description", column: "C" },
        { key: "status", column: "D" },
        { key: "location_mark", column: "E" },
        { key: "location_remark", column: "F" },
        { key: "remarks", column: "G" }
      ]
    }
  ],
  summary: {
    sheet_name: "SUMMARY",
    first_data_row: 2,
    label_column: "A",
    total_column: "B",
    totals_label: "Grand Total"
  },
  location_export_rules: [
    {
      location_type: "vessel",
      mark_column: "E",
      remark_column: "F",
      mark_value: "1",
      remark_template: "at {location}"
    }
  ]
};

function sampleRows(categoryCode, sheetName, count, locationName = "Warami 10", locationType = "vessel") {
  return {
    categoryCode,
    sheetName,
    rows: Array.from({ length: count }, (_, i) => ({
      internalRef: `GOSL/SE/${String(i + 1).padStart(3, "0")}`,
      description: `Item ${i + 1}`,
      categoryCode,
      statusCode: "OPERATIONAL",
      locationType,
      locationName,
      serialNumbers: [`SN${i + 1}`]
    }))
  };
}

// ---------------------------------------------------------------------------
// Cell grid address math (PRD 20.3 step 2)
// ---------------------------------------------------------------------------
test("FR-EXP-01 cellGrid: converts columns, addresses and ranges both ways", () => {
  assert.equal(columnToLetter(0), "A");
  assert.equal(columnToLetter(25), "Z");
  assert.equal(columnToLetter(26), "AA");
  assert.equal(letterToColumn("A"), 0);
  assert.equal(letterToColumn("AA"), 26);

  assert.equal(cellAddress(1, 7), "B7");
  assert.deepEqual(parseAddress("B7"), { column: 1, row: 7 });
  assert.equal(cellRange({ column: 0, row: 2 }, { column: 0, row: 4 }), "A2:A4");
});

test("FR-EXP-01 cellGrid: rejects invalid addresses and ranges", () => {
  assert.throws(() => cellAddress(0, 0), /row must be a 1-based integer/);
  assert.throws(() => parseAddress("7B"), /is not an A1 address/);
  assert.throws(() => letterToColumn("A1"), /is not a column letter/);
  assert.throws(() => cellRange({ column: 0, row: 5 }, { column: 0, row: 2 }), /must not end before it starts/);
});

test("FR-EXP-01 totals formulas are generated from computed addresses, not inherited", () => {
  const span = rowSpan(3, 2);
  assert.deepEqual(span, { firstRow: 2, lastRow: 4, rowCount: 3 });
  // Exporter computes COUNTA over exactly the rows it wrote
  assert.equal(buildCountFormula(0, span), "COUNTA(A2:A4)");

  // A different first_data_row produces a different range, proving no formula is inherited
  assert.equal(buildCountFormula(0, rowSpan(3, 4)), "COUNTA(A4:A6)");

  // Empty sheet yields a literal zero rather than a range over reversed bounds
  assert.equal(buildCountFormula(0, rowSpan(0, 2)), "0");

  assert.equal(
    buildGrandTotalFormula([
      { sheetName: "SURVEY EQUIPMENT", address: "B5" },
      { sheetName: "IT EQUIPMENT", address: "B9" }
    ]),
    "SUM('SURVEY EQUIPMENT'!B5,'IT EQUIPMENT'!B9)"
  );
});

// ---------------------------------------------------------------------------
// xlsx container (PRD 20.3 step 5: the file must be readable back)
// ---------------------------------------------------------------------------
test("FR-EXP-01 xlsxWriter: writes a readable archive and round-trips cells", () => {
  const bytes = writeXlsx({
    sheets: [
      {
        name: "DATA",
        cells: [
          { address: "A1", kind: "string", value: "Ref & <one>" },
          { address: "B1", kind: "number", number: 42 },
          { address: "C1", kind: "formula", formula: "COUNTA(A1:A2)", cachedValue: 2 }
        ]
      }
    ]
  });

  // PK zip magic
  assert.equal(bytes.readUInt32LE(0), 0x04034b50);

  const read = readXlsx(bytes);
  assert.equal(read.sheets.length, 1);
  assert.equal(read.sheets[0].name, "DATA");
  assert.equal(read.sheets[0].cells.get("A1"), "Ref & <one>");
  assert.equal(read.sheets[0].cells.get("B1"), 42);
  assert.equal(read.sheets[0].cells.get("C1"), 2);
});

test("FR-EXP-01 xlsxWriter: refuses a workbook with no sheets", () => {
  assert.throws(() => writeXlsx({ sheets: [] }), /no sheets/);
});

test("FR-EXP-01 xlsxWriter: a sheet name Excel cannot hold is a failure, not a silent rename", () => {
  const cell = { address: "A1", kind: "string", value: "x" };

  // Renaming here would make the produced file's sheet names disagree with
  // the controlled template, so the write must fail instead.
  assert.throws(
    () => writeXlsx({ sheets: [{ name: "SURVEY/EQUIP", cells: [cell] }] }),
    /characters Excel forbids/
  );
  assert.throws(
    () => writeXlsx({ sheets: [{ name: "A".repeat(32), cells: [cell] }] }),
    /31-character Excel limit/
  );
  assert.throws(
    () => writeXlsx({ sheets: [{ name: "   ", cells: [cell] }] }),
    /cannot be empty/
  );
  assert.throws(
    () => writeXlsx({ sheets: [{ name: "DATA", cells: [cell] }, { name: "data", cells: [cell] }] }),
    /duplicate sheet name/
  );

  // A 31-character name is the limit, not over it.
  const atLimit = "A".repeat(31);
  assert.equal(readXlsx(writeXlsx({ sheets: [{ name: atLimit, cells: [cell] }] })).sheets[0].name, atLimit);
});

test("FR-EXP-01 xlsxWriter: cells are emitted in ascending column order within a row", () => {
  const written = writeXlsx({
    sheets: [
      {
        name: "DATA",
        // Deliberately out of order: OOXML readers expect ascending columns.
        cells: [
          { address: "C1", kind: "number", number: 3 },
          { address: "A1", kind: "string", value: "a" },
          { address: "B1", kind: "string", value: "b" },
          { address: "A2", kind: "string", value: "a2" }
        ]
      }
    ]
  });

  const read = readXlsx(written);
  const sheet = read.sheets[0];
  assert.deepEqual([...sheet.cells.keys()], ["A1", "B1", "C1", "A2"]);
  assert.equal(sheet.cells.get("A1"), "a");
  assert.equal(sheet.cells.get("C1"), 3);
});

// ---------------------------------------------------------------------------
// Export projection (FR-EXP-01)
// ---------------------------------------------------------------------------
test("FR-EXP-01 Export: renders item rows into the declared columns and self-checks", () => {
  const exporter = new ExcelFormExporter();
  const asOf = new Date("2026-10-01T00:00:00.000Z");

  const result = exporter.generateProjection(
    "GOSL",
    [sampleRows("SURVEY", "SURVEY EQUIPMENT", 3), sampleRows("IT", "IT EQUIPMENT", 2)],
    asOf,
    exampleExportConfig
  );

  assert.equal(result.filename, "GOSL_INVENTORY_2026_10_01.xlsx");
  assert.equal(result.sheetCount, 2);
  assert.equal(result.totalSheetCount, 3);
  assert.equal(result.totalItems, 5);
  assert.equal(result.selfCheckPassed, true);
  assert.ok(result.bytes.length > 0);

  const read = readXlsx(result.bytes);
  const survey = read.sheets.find(s => s.name === "SURVEY EQUIPMENT");
  assert.ok(survey);
  // Identity in A, description in C, status in D (columns come from config, not code)
  assert.equal(survey.cells.get("A2"), "GOSL/SE/001");
  assert.equal(survey.cells.get("C2"), "Item 1");
  assert.equal(survey.cells.get("D2"), "OPERATIONAL");
  // Totals regenerated at the row after the last written item
  assert.equal(survey.cells.get("B5"), 3);

  const summary = read.sheets.find(s => s.name === "SUMMARY");
  assert.ok(summary);
  assert.equal(summary.cells.get("B2"), 3);
  assert.equal(summary.cells.get("B3"), 2);
  assert.equal(summary.cells.get("B4"), 5);
});

test("FR-EXP-01 Export: location rendering follows cfg:location_export_rules (PRD 20.3 step 3)", () => {
  const exporter = new ExcelFormExporter();
  const result = exporter.generateProjection(
    "GOSL",
    [sampleRows("SURVEY", "SURVEY EQUIPMENT", 1, "Warami 10"), sampleRows("IT", "IT EQUIPMENT", 0)],
    new Date("2026-10-01T00:00:00.000Z"),
    exampleExportConfig
  );

  const survey = readXlsx(result.bytes).sheets.find(s => s.name === "SURVEY EQUIPMENT");
  assert.equal(survey.cells.get("E2"), "1");            // mark_value from config
  assert.equal(survey.cells.get("F2"), "at Warami 10"); // remark_template from config
});

test("FR-EXP-01 Export: a location_name rule overrides the location_type rule", () => {
  const exporter = new ExcelFormExporter();
  const config = {
    ...exampleExportConfig,
    location_export_rules: [
      { location_type: "vessel", mark_column: "E", remark_column: "F", mark_value: "1", remark_template: "type rule" },
      { location_name: "Warami 10", mark_column: "E", remark_column: "F", mark_value: "Z", remark_template: "named rule" }
    ]
  };

  const result = exporter.generateProjection(
    "GOSL",
    [sampleRows("SURVEY", "SURVEY EQUIPMENT", 1, "Warami 10"), sampleRows("IT", "IT EQUIPMENT", 0)],
    new Date("2026-10-01T00:00:00.000Z"),
    config
  );

  const survey = readXlsx(result.bytes).sheets.find(s => s.name === "SURVEY EQUIPMENT");
  assert.equal(survey.cells.get("E2"), "Z");
  assert.equal(survey.cells.get("F2"), "named rule");
});

test("FR-EXP-01 Export: a location_type rule only matches its own type (LD-5)", () => {
  const exporter = new ExcelFormExporter();
  // Two type rules: matching must key on the row's declared type, not on
  // "first rule that happens to have a location_type".
  const config = {
    ...exampleExportConfig,
    location_export_rules: [
      { location_type: "shore_based", mark_column: "E", remark_column: "F", mark_value: "9", remark_template: "shore" },
      { location_type: "vessel", mark_column: "E", remark_column: "F", mark_value: "1", remark_template: "type rule" }
    ]
  };

  const vessel = exporter.generateProjection(
    "GOSL",
    [sampleRows("SURVEY", "SURVEY EQUIPMENT", 1, "Warami 10", "vessel"), sampleRows("IT", "IT EQUIPMENT", 0)],
    new Date("2026-10-01T00:00:00.000Z"),
    config
  );
  const vesselSheet = readXlsx(vessel.bytes).sheets.find(s => s.name === "SURVEY EQUIPMENT");
  assert.equal(vesselSheet.cells.get("E2"), "1");
  assert.equal(vesselSheet.cells.get("F2"), "type rule");

  const shore = exporter.generateProjection(
    "GOSL",
    [sampleRows("SURVEY", "SURVEY EQUIPMENT", 1, "Depot Yard", "shore_based"), sampleRows("IT", "IT EQUIPMENT", 0)],
    new Date("2026-10-01T00:00:00.000Z"),
    config
  );
  const shoreSheet = readXlsx(shore.bytes).sheets.find(s => s.name === "SURVEY EQUIPMENT");
  assert.equal(shoreSheet.cells.get("E2"), "9");
  assert.equal(shoreSheet.cells.get("F2"), "shore");
});

test("FR-EXP-01 Export: an undeclared location type leaves mark and remark blank (LD-5)", () => {
  const exporter = new ExcelFormExporter();
  // The exporter must never borrow another type's mark. Blank beats wrong.
  const result = exporter.generateProjection(
    "GOSL",
    [sampleRows("SURVEY", "SURVEY EQUIPMENT", 1, "Unlisted Depot", "unmapped_type"), sampleRows("IT", "IT EQUIPMENT", 0)],
    new Date("2026-10-01T00:00:00.000Z"),
    exampleExportConfig
  );

  const survey = readXlsx(result.bytes).sheets.find(s => s.name === "SURVEY EQUIPMENT");
  assert.equal(survey.cells.get("A2"), "GOSL/SE/001");
  assert.equal(survey.cells.get("E2"), "");
  assert.equal(survey.cells.get("F2"), "");
});

test("FR-EXP-01 Export: '{alias}' substitutes the row alias and falls back to the name", () => {
  const exporter = new ExcelFormExporter();
  const config = {
    ...exampleExportConfig,
    location_export_rules: [
      { location_type: "vessel", mark_column: "E", remark_column: "F", mark_value: "1", remark_template: "{location} (shown as {alias})" }
    ]
  };

  const aliased = sampleRows("SURVEY", "SURVEY EQUIPMENT", 1);
  aliased.rows[0].locationAlias = "Vessel Ten";
  const withAlias = exporter.generateProjection(
    "GOSL",
    [aliased, sampleRows("IT", "IT EQUIPMENT", 0)],
    new Date("2026-10-01T00:00:00.000Z"),
    config
  );
  assert.equal(
    readXlsx(withAlias.bytes).sheets.find(s => s.name === "SURVEY EQUIPMENT").cells.get("F2"),
    "Warami 10 (shown as Vessel Ten)"
  );

  const withoutAlias = exporter.generateProjection(
    "GOSL",
    [sampleRows("SURVEY", "SURVEY EQUIPMENT", 1), sampleRows("IT", "IT EQUIPMENT", 0)],
    new Date("2026-10-01T00:00:00.000Z"),
    config
  );
  assert.equal(
    readXlsx(withoutAlias.bytes).sheets.find(s => s.name === "SURVEY EQUIPMENT").cells.get("F2"),
    "Warami 10 (shown as Warami 10)"
  );
});

test("FR-EXP-01 Export: an empty category sheet still emits a zero totals formula", () => {
  const exporter = new ExcelFormExporter();
  const result = exporter.generateProjection(
    "GOSL",
    [sampleRows("SURVEY", "SURVEY EQUIPMENT", 0), sampleRows("IT", "IT EQUIPMENT", 0)],
    new Date("2026-10-01T00:00:00.000Z"),
    exampleExportConfig
  );

  const survey = readXlsx(result.bytes).sheets.find(s => s.name === "SURVEY EQUIPMENT");
  assert.equal(survey.cells.get("B2"), 0);
  assert.equal(result.totalItems, 0);
  assert.equal(result.selfCheckPassed, true);
});

test("FR-EXP-01 Export: serial joining uses the configured separator (LD-5)", () => {
  const exporter = new ExcelFormExporter();
  const config = { ...exampleExportConfig, serial_separator: " | " };

  const data = sampleRows("SURVEY", "SURVEY EQUIPMENT", 0);
  data.rows.push({
    internalRef: "GOSL/SE/900",
    description: "Twin serial",
    categoryCode: "SURVEY",
    statusCode: "OPERATIONAL",
    locationName: "Base Store",
    serialNumbers: ["AAA", "BBB"]
  });

  const serialConfig = {
    ...config,
    sheets: config.sheets.map(s => ({
      ...s,
      columns: [...s.columns, { key: "serials", column: "H" }]
    }))
  };

  const result = exporter.generateProjection("GOSL", [data, sampleRows("IT", "IT EQUIPMENT", 0)], new Date("2026-10-01T00:00:00.000Z"), serialConfig);
  const survey = readXlsx(result.bytes).sheets.find(s => s.name === "SURVEY EQUIPMENT");
  assert.equal(survey.cells.get("H2"), "AAA | BBB");
});

// ---------------------------------------------------------------------------
// Template profile mismatch blocks the export (FR-EXP-01)
// ---------------------------------------------------------------------------
test("FR-EXP-01 Export: a renamed sheet in the database blocks the export", () => {
  const exporter = new ExcelFormExporter();
  assert.throws(
    () =>
      exporter.generateProjection(
        "GOSL",
        [sampleRows("SURVEY", "RENAMED SHEET", 1), sampleRows("IT", "IT EQUIPMENT", 1)],
        new Date("2026-10-01T00:00:00.000Z"),
        exampleExportConfig
      ),
    err => {
      assert.ok(err instanceof ExportTemplateMismatchError);
      assert.equal(err.code, "export_template_mismatch");
      assert.match(err.message, /export_template_mismatch|template profile mismatch/);
      assert.match(err.message, /SURVEY EQUIPMENT/);
      return true;
    }
  );
});

test("FR-EXP-01 Export: a category with no declared sheet blocks the export", () => {
  const exporter = new ExcelFormExporter();
  assert.throws(
    () =>
      exporter.generateProjection(
        "GOSL",
        [sampleRows("SURVEY", "SURVEY EQUIPMENT", 1), sampleRows("MARINE", "MARINE EQUIPMENT", 1)],
        new Date("2026-10-01T00:00:00.000Z"),
        exampleExportConfig
      ),
    err => {
      assert.ok(err instanceof ExportTemplateMismatchError);
      assert.match(err.message, /MARINE/);
      return true;
    }
  );
});

test("FR-EXP-01 Export: a sheet declared without an internal_ref column is rejected", () => {
  const exporter = new ExcelFormExporter();
  const broken = {
    ...exampleExportConfig,
    sheets: exampleExportConfig.sheets.map(s => ({
      ...s,
      columns: s.columns.filter(c => c.key !== "internal_ref")
    }))
  };
  assert.throws(
    () => exporter.generateProjection("GOSL", [sampleRows("SURVEY", "SURVEY EQUIPMENT", 1)], new Date("2026-10-01T00:00:00.000Z"), broken),
    err => {
      assert.ok(err instanceof ExportTemplateMismatchError);
      assert.match(err.message, /internal_ref/);
      return true;
    }
  );
});

// ---------------------------------------------------------------------------
// Self-check independence (FR-EXP-01, PRD 20.3 step 5)
// ---------------------------------------------------------------------------
test("FR-EXP-01 Export: self-check recomputes counts from the file and returns a diff on mismatch", () => {
  const exporter = new ExcelFormExporter();
  const result = exporter.generateProjection(
    "GOSL",
    [sampleRows("SURVEY", "SURVEY EQUIPMENT", 3), sampleRows("IT", "IT EQUIPMENT", 2)],
    new Date("2026-10-01T00:00:00.000Z"),
    exampleExportConfig
  );

  // Hand the self-check a count that disagrees with the bytes on disk.
  // If it trusted its argument it would pass; it must re-read the file instead.
  const overstated = result.perSheetCounts.map(entry =>
    entry.sheetName === "SURVEY EQUIPMENT" ? { ...entry, dataRows: entry.dataRows + 1 } : entry
  );

  assert.throws(
    () => exporter.selfCheck(result.bytes, overstated, result.totalItems, exampleExportConfig),
    err => {
      assert.ok(err instanceof ExportSelfCheckError);
      assert.equal(err.code, "export_self_check_failed");
      const surveyDiff = err.diff.find(d => d.sheet === "SURVEY EQUIPMENT");
      assert.ok(surveyDiff, "the diff must name the offending sheet");
      assert.equal(surveyDiff.expectedFromDatabase, 4);
      assert.equal(surveyDiff.countedInFile, 3);
      assert.match(surveyDiff.reason, /identity cells in the file do not match the database count/);
      return true;
    }
  );

  // A byte-level corruption is also caught: the produced file is decompressed
  // and re-parsed, so a damaged archive cannot silently pass.
  const truncated = result.bytes.subarray(0, result.bytes.length - 40);
  assert.throws(() => exporter.selfCheck(truncated, result.perSheetCounts, result.totalItems, exampleExportConfig));

  // Untouched bytes still pass, proving the check is not trivially failing.
  assert.equal(exporter.selfCheck(result.bytes, result.perSheetCounts, result.totalItems, exampleExportConfig), true);
});

test("FR-EXP-01 Export: a claimed total that disagrees with the database fails loudly", () => {
  const exporter = new ExcelFormExporter();
  const result = exporter.generateProjection(
    "GOSL",
    [sampleRows("SURVEY", "SURVEY EQUIPMENT", 2), sampleRows("IT", "IT EQUIPMENT", 1)],
    new Date("2026-10-01T00:00:00.000Z"),
    exampleExportConfig
  );

  // Same file, but the self-check is told the database holds a different count.
  assert.throws(
    () => exporter.selfCheck(result.bytes, result.perSheetCounts, result.totalItems + 1, exampleExportConfig),
    err => {
      assert.ok(err instanceof ExportSelfCheckError);
      assert.ok(err.diff.some(d => d.sheet === "SUMMARY"));
      return true;
    }
  );
});

test("FR-EXP-01 Export: a missing sheet in the produced file is reported rather than ignored", () => {
  const exporter = new ExcelFormExporter();
  const bytes = writeXlsx({
    sheets: [{ name: "SUMMARY", cells: [{ address: "A1", kind: "string", value: "SUMMARY" }] }]
  });

  assert.throws(
    () =>
      exporter.selfCheck(
        bytes,
        [{ sheetName: "SURVEY EQUIPMENT", dataRows: 1, formula: "COUNTA(A2:A2)", claimed: 1 }],
        1,
        exampleExportConfig
      ),
    err => {
      assert.ok(err instanceof ExportSelfCheckError);
      assert.ok(err.diff.some(d => /missing from the produced file/.test(d.reason)));
      return true;
    }
  );
});

// ---------------------------------------------------------------------------
// Never overwrite (PRD 20.3 step 4)
// ---------------------------------------------------------------------------
test("FR-EXP-01 Export: refuses to overwrite an existing dated file", () => {
  const exporter = new ExcelFormExporter();
  const asOf = new Date("2026-10-01T00:00:00.000Z");
  const existing = new Set(["GOSL_INVENTORY_2026_10_01.xlsx"]);

  assert.throws(
    () =>
      exporter.generateProjection(
        "GOSL",
        [sampleRows("SURVEY", "SURVEY EQUIPMENT", 1), sampleRows("IT", "IT EQUIPMENT", 0)],
        asOf,
        exampleExportConfig,
        { exists: name => existing.has(name) }
      ),
    /refusing to overwrite existing file/
  );

  // A different date is a different file and is allowed.
  const next = exporter.generateProjection(
    "GOSL",
    [sampleRows("SURVEY", "SURVEY EQUIPMENT", 1), sampleRows("IT", "IT EQUIPMENT", 0)],
    new Date("2026-11-01T00:00:00.000Z"),
    exampleExportConfig,
    { exists: name => existing.has(name) }
  );
  assert.equal(next.filename, "GOSL_INVENTORY_2026_11_01.xlsx");
});

// ---------------------------------------------------------------------------
// EC-56: formula totals are regenerated, never imported
// ---------------------------------------------------------------------------
test("EC-56 Export: totals are exporter-generated formulas, not values carried over", () => {
  const exporter = new ExcelFormExporter();
  const result = exporter.generateProjection(
    "GOSL",
    [sampleRows("SURVEY", "SURVEY EQUIPMENT", 4), sampleRows("IT", "IT EQUIPMENT", 1)],
    new Date("2026-10-01T00:00:00.000Z"),
    exampleExportConfig
  );

  // The exporter states the formula it computed from the row count it just wrote.
  const surveyCount = result.perSheetCounts.find(c => c.sheetName === "SURVEY EQUIPMENT");
  assert.equal(surveyCount.formula, "COUNTA(A2:A5)");
  assert.equal(surveyCount.claimed, 4);

  // And the cached value in the file matches that formula's result.
  const survey = readXlsx(result.bytes).sheets.find(s => s.name === "SURVEY EQUIPMENT");
  assert.equal(survey.cells.get("B6"), 4);
});

// ---------------------------------------------------------------------------
// Config validation (LD-5)
// ---------------------------------------------------------------------------
test("FR-EXP-01 config validation (LD-5): export profile rejects missing keys and undated filenames", () => {
  const loader = new EngineeringConfigLoader();

  const validated = loader.validateExportConfig(exampleExportConfig);
  assert.equal(validated.filename_pattern, "{org}_INVENTORY_{date}.xlsx");

  assert.throws(() => loader.validateExportConfig(null), /LD-5/);
  assert.throws(() => loader.validateExportConfig({ ...exampleExportConfig, filename_pattern: "static.xlsx" }), /\{date\}/);
  assert.throws(() => loader.validateExportConfig({ ...exampleExportConfig, sheets: [] }), /non-empty 'sheets'/);
  assert.throws(
    () => loader.validateExportConfig({ ...exampleExportConfig, location_export_rules: [] }),
    /non-empty 'location_export_rules'/
  );

  const noIdentity = {
    ...exampleExportConfig,
    sheets: exampleExportConfig.sheets.map(s => ({ ...s, columns: s.columns.filter(c => c.key !== "internal_ref") }))
  };
  assert.throws(() => loader.validateExportConfig(noIdentity), /'internal_ref' column/);

  const withSheet = key => ({
    ...exampleExportConfig,
    sheets: exampleExportConfig.sheets.map((s, i) => (i === 0 ? { ...s, [key]: undefined } : s))
  });

  // Every declared totals/summary/rule column must be a real column letter.
  assert.throws(() => loader.validateExportConfig(withSheet("totals_column")), /totals_column/);
  assert.throws(() => loader.validateExportConfig(withSheet("totals_label_column")), /totals_label_column/);
  assert.throws(
    () => loader.validateExportConfig({ ...exampleExportConfig, summary: { ...exampleExportConfig.summary, total_column: "12" } }),
    /summary column '12'/
  );
  assert.throws(
    () => loader.validateExportConfig({ ...exampleExportConfig, summary: { ...exampleExportConfig.summary, label_column: "!!" } }),
    /summary column '!!'/
  );
  assert.throws(
    () =>
      loader.validateExportConfig({
        ...exampleExportConfig,
        location_export_rules: [{ location_type: "vessel", mark_column: "E", remark_column: "E", mark_value: "1" }]
      }),
    /one column for both the mark and the remark/
  );

  // A totals cell on an item column would corrupt the last data row.
  assert.throws(
    () => loader.validateExportConfig(withSheet("totals_label_column")),
    /totals_label_column/
  );
  assert.throws(
    () =>
      loader.validateExportConfig({
        ...exampleExportConfig,
        sheets: exampleExportConfig.sheets.map((s, i) => (i === 0 ? { ...s, totals_column: "C" } : s))
      }),
    /also an item column/
  );

  // Duplicate identifiers would let one declaration silently shadow another.
  assert.throws(
    () =>
      loader.validateExportConfig({
        ...exampleExportConfig,
        sheets: exampleExportConfig.sheets.map((s, i) => (i === 0 ? { ...s, sheet_name: "IT EQUIPMENT" } : s))
      }),
    /duplicate sheet name/
  );
  assert.throws(
    () =>
      loader.validateExportConfig({
        ...exampleExportConfig,
        sheets: exampleExportConfig.sheets.map((s, i) => (i === 0 ? { ...s, category_code: "IT" } : s))
      }),
    /duplicate category code/
  );
  assert.throws(
    () =>
      loader.validateExportConfig({
        ...exampleExportConfig,
        sheets: exampleExportConfig.sheets.map((s, i) =>
          i === 0 ? { ...s, columns: [...s.columns, { key: "internal_ref", column: "J" }] } : s
        )
      }),
    /duplicate column key/
  );
  assert.throws(
    () =>
      loader.validateExportConfig({
        ...exampleExportConfig,
        sheets: exampleExportConfig.sheets.map((s, i) =>
          i === 0 ? { ...s, columns: [...s.columns, { key: "spare", column: "a" }] } : s
        )
      }),
    /duplicate column letter/
  );
  assert.throws(
    () =>
      loader.validateExportConfig({
        ...exampleExportConfig,
        sheets: exampleExportConfig.sheets.map((s, i) =>
          i === 0 ? { ...s, columns: s.columns.map(c => (c.key === "remarks" ? { ...c, column: "AA1" } : c)) } : s
        )
      }),
    /not a spreadsheet column letter/
  );

  // Excel forbids these sheet-name characters; catching it here beats a rename.
  assert.throws(
    () =>
      loader.validateExportConfig({
        ...exampleExportConfig,
        sheets: exampleExportConfig.sheets.map((s, i) => (i === 0 ? { ...s, sheet_name: "SURVEY/EQUIP" } : s))
      }),
    /worksheet name/
  );
  assert.throws(
    () =>
      loader.validateExportConfig({
        ...exampleExportConfig,
        summary: { ...exampleExportConfig.summary, sheet_name: "SURVEY EQUIPMENT" }
      }),
    /already used by category/
  );
  assert.throws(
    () =>
      loader.validateExportConfig({
        ...exampleExportConfig,
        location_export_rules: [
          { location_type: "vessel", mark_column: "E", remark_column: "F", mark_value: "1" },
          { location_type: "vessel", mark_column: "E", remark_column: "F", mark_value: "2" }
        ]
      }),
    /duplicate location_type/
  );
  assert.throws(
    () =>
      loader.validateExportConfig({
        ...exampleExportConfig,
        location_export_rules: [
          { mark_column: "E", remark_column: "F", mark_value: "1" }
        ]
      }),
    /must declare 'location_type' or 'location_name'/
  );
  assert.throws(
    () =>
      loader.validateExportConfig({
        ...exampleExportConfig,
        location_export_rules: [
          { location_type: "vessel", mark_column: "E", remark_column: "F", mark_value: "1" },
          { location_name: "Warami 10", mark_column: "E", remark_column: "F", mark_value: "2" },
          { location_name: "Warami 10", mark_column: "E", remark_column: "F", mark_value: "3" }
        ]
      }),
    /duplicate location_name/
  );
});

// ---------------------------------------------------------------------------
// Company-B portability (LD-5): different template, zero code changes
// ---------------------------------------------------------------------------
test("Company-B Export portability (LD-5): renders against a different template profile with zero code changes", () => {
  const loader = new EngineeringConfigLoader();
  const companyBExport = {
    version: "1.0",
    filename_pattern: "{org}_ASSET_REGISTER_{date}.xlsx",
    serial_separator: " | ",
    sheets: [
      {
        sheet_name: "Rig Instruments",
        category_code: "RIG_INSTRUMENT",
        first_data_row: 4,
        totals_column: "D",
        totals_label_column: "A",
        totals_label: "Register Total",
        columns: [
          { key: "internal_ref", column: "B" },
          { key: "description", column: "C" },
          { key: "serials", column: "F" },
          { key: "status", column: "G" },
          { key: "location_mark", column: "H" },
          { key: "location_remark", column: "I" }
        ]
      },
      {
        sheet_name: "Workshop Stock",
        category_code: "WORKSHOP_PART",
        first_data_row: 4,
        totals_column: "D",
        totals_label_column: "A",
        totals_label: "Register Total",
        columns: [
          { key: "internal_ref", column: "B" },
          { key: "description", column: "C" },
          { key: "serials", column: "F" },
          { key: "status", column: "G" },
          { key: "location_mark", column: "H" },
          { key: "location_remark", column: "I" }
        ]
      }
    ],
    summary: {
      sheet_name: "Register Summary",
      first_data_row: 3,
      label_column: "B",
      total_column: "D",
      totals_label: "All Items"
    },
    location_export_rules: [
      { location_type: "rig_alpha", mark_column: "H", remark_column: "I", mark_value: "X", remark_template: "at {location}" }
    ]
  };

  loader.validateExportConfig(companyBExport);

  const exporter = new ExcelFormExporter();
  const result = exporter.generateProjection(
    "CO-B",
    [
      { categoryCode: "RIG_INSTRUMENT", sheetName: "Rig Instruments", rows: [
        { internalRef: "CO-B/EQ/999", description: "Drill Pressure Gauge", categoryCode: "RIG_INSTRUMENT", statusCode: "IN_SERVICE", locationType: "rig_alpha", locationName: "Rig Alpha", serialNumbers: ["SN-RIG-100234"] }
      ] },
      { categoryCode: "WORKSHOP_PART", sheetName: "Workshop Stock", rows: [] }
    ],
    new Date("2026-10-01T00:00:00.000Z"),
    companyBExport
  );

  assert.equal(result.filename, "CO-B_ASSET_REGISTER_2026_10_01.xlsx");
  assert.equal(result.selfCheckPassed, true);
  assert.equal(result.totalItems, 1);

  const read = readXlsx(result.bytes);
  const rig = read.sheets.find(s => s.name === "Rig Instruments");
  // Company-B column layout: identity in B at row 4, totals in D at row 5
  assert.equal(rig.cells.get("B4"), "CO-B/EQ/999");
  assert.equal(rig.cells.get("F4"), "SN-RIG-100234");
  assert.equal(rig.cells.get("H4"), "X");
  assert.equal(rig.cells.get("I4"), "at Rig Alpha");
  assert.equal(rig.cells.get("D5"), 1);

  const summary = read.sheets.find(s => s.name === "Register Summary");
  assert.equal(summary.cells.get("D5"), 1);
});

// ---------------------------------------------------------------------------
// API surface (FR-EXP-01 delivery endpoint)
// ---------------------------------------------------------------------------
test("FR-EXP-01 API: POST /v1/exports renders and GET /v1/exports/{id}/file streams the workbook", async () => {
  const server = new EngineApiServer({ port: 48993, adapterKeyPepper: "pepper-123" });
  server.setExportConfig(exampleExportConfig);
  await server.listen();

  try {
    const auth = { "Content-Type": "application/json", Authorization: "Bearer test-adapter-key" };

    const unauthorized = await fetch("http://localhost:48993/v1/exports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationName: "GOSL", sheets: [] })
    });
    assert.equal(unauthorized.status, 401);

    const created = await fetch("http://localhost:48993/v1/exports", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        organizationName: "GOSL",
        sheets: [sampleRows("SURVEY", "SURVEY EQUIPMENT", 2), sampleRows("IT", "IT EQUIPMENT", 1)]
      })
    });
    assert.equal(created.status, 201);
    const createdBody = await created.json();
    assert.match(createdBody.id, /^exp-/);
    assert.equal(createdBody.selfCheckPassed, true);
    assert.equal(createdBody.totalItems, 3);

    const file = await fetch(`http://localhost:48993/v1/exports/${createdBody.id}/file`, { headers: auth });
    assert.equal(file.status, 200);
    const bytes = Buffer.from(await file.arrayBuffer());
    assert.equal(bytes.readUInt32LE(0), 0x04034b50);
    assert.equal(readXlsx(bytes).sheets.find(s => s.name === "SUMMARY").cells.get("B4"), 3);

    const missing = await fetch("http://localhost:48993/v1/exports/exp-nope/file", { headers: auth });
    assert.equal(missing.status, 404);
  } finally {
    await server.close();
  }
});

test("FR-EXP-01 API: a template mismatch returns a clear failure and no export id", async () => {
  const server = new EngineApiServer({ port: 48994, adapterKeyPepper: "pepper-123" });
  server.setExportConfig(exampleExportConfig);
  await server.listen();

  try {
    const res = await fetch("http://localhost:48994/v1/exports", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-adapter-key" },
      body: JSON.stringify({
        organizationName: "GOSL",
        sheets: [sampleRows("MARINE", "MARINE EQUIPMENT", 1)]
      })
    });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.error.code, "export_template_mismatch");
    assert.match(body.error.message, /MARINE/);
  } finally {
    await server.close();
  }
});

// ---------------------------------------------------------------------------
// Export failure never affects the ledger (FR-EXP-01)
// ---------------------------------------------------------------------------
test("FR-EXP-01 Export: a failed export leaves the source rows untouched", () => {
  const exporter = new ExcelFormExporter();
  const input = sampleRows("SURVEY", "RENAMED", 1);
  const before = JSON.stringify(input);

  assert.throws(() =>
    exporter.generateProjection("GOSL", [input], new Date("2026-10-01T00:00:00.000Z"), exampleExportConfig)
  );

  // The database projection handed to the exporter is unchanged.
  assert.equal(JSON.stringify(input), before);
});

test("FR-EXP-01 Export: a missing cfg:export_template is a hard failure (LD-5)", () => {
  const exporter = new ExcelFormExporter();
  // No built-in profile: guessing a layout would produce a file that looks
  // plausible and is wrong.
  assert.throws(
    () => exporter.generateProjection("GOSL", [sampleRows("SURVEY", "SURVEY EQUIPMENT", 1)], new Date()),
    /cfg:export_template is required/
  );
});

// ---------------------------------------------------------------------------
// Recalculation gate wiring (PRD 20.3 step 6)
// ---------------------------------------------------------------------------
test("FR-EXP-01 recalc gate: the fixture script and the verifier agree on every totals cell", () => {
  const workDir = mkdtempSync(join(tmpdir(), "export-recalc-"));
  try {
    // The same two scripts the LibreOffice workflow runs, driven here against
    // the exporter's own bytes so the wiring is covered without soffice.
    const run = spawnSync(
      process.execPath,
      ["scripts/make_export_fixture.mjs"],
      { encoding: "utf-8", env: { ...process.env, EXPORT_OUT_DIR: workDir } }
    );
    assert.equal(run.status, 0, run.stderr);

    const verify = spawnSync(
      process.execPath,
      ["scripts/verify_recalc.mjs", workDir, join(workDir, "expected_totals.json")],
      { encoding: "utf-8" }
    );
    assert.equal(verify.status, 0, verify.stderr);
    assert.match(verify.stdout, /PASS: LibreOffice recalculated/);

    // The verifier must also fail when a claim disagrees, or the gate is inert.
    const expectedPath = join(workDir, "expected_totals.json");
    const expected = JSON.parse(readFileSync(expectedPath, "utf-8"));
    expected.totals[0].expected += 1;
    writeFileSync(expectedPath, JSON.stringify(expected), "utf-8");

    const mismatch = spawnSync(
      process.execPath,
      ["scripts/verify_recalc.mjs", workDir, expectedPath],
      { encoding: "utf-8" }
    );
    assert.equal(mismatch.status, 1);
    assert.match(mismatch.stderr, /recalculation disagrees/);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});