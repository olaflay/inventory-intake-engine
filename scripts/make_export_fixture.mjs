#!/usr/bin/env node
/**
 * Produce a dated projection from the fixtures, for the LibreOffice
 * recalculation check (FR-EXP-01 / PRD 20.3 step 6).
 *
 * Both the template profile and the rows come from files, not from literals
 * in this script (LD-5). Output goes to the directory named by EXPORT_OUT_DIR
 * (default tmp-export).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { ExcelFormExporter, readXlsx } from "../packages/engine/dist/index.js";

const TEMPLATE = process.env.EXPORT_TEMPLATE ?? "tests/fixtures/export_template.json";
const DATA = process.env.EXPORT_DATA ?? "tests/fixtures/export_data.json";
const OUT_DIR = process.env.EXPORT_OUT_DIR ?? "tmp-export";
// Fixed date so the produced filename is stable across runs.
const AS_OF = new Date("2026-10-01T00:00:00.000Z");

const config = JSON.parse(await readFile(TEMPLATE, "utf-8"));
const data = JSON.parse(await readFile(DATA, "utf-8"));

const result = new ExcelFormExporter().generateProjection(
  data.organizationName,
  data.sheets,
  AS_OF,
  config
);

mkdirSync(OUT_DIR, { recursive: true });
const outPath = `${OUT_DIR}/${result.filename}`;
writeFileSync(outPath, result.bytes);

console.log(`WROTE ${outPath} items=${result.totalItems} sheets=${result.totalSheetCount}`);
console.log(
  "TOTALS " +
    JSON.stringify(
      result.perSheetCounts.map(entry => ({ sheet: entry.sheetName, formula: entry.formula, claimed: entry.claimed }))
    )
);

// Echo the totals addresses the recalculation check asserts, and record the
// expectations to a file. Both come from config + data, so the workflow and
// this script cannot drift apart silently.
const read = readXlsx(result.bytes);
const summary = config.summary;
const grandTotalRow = summary.first_data_row + config.sheets.length;
const totals = [];

config.sheets.forEach((sheet, index) => {
  // first_data_row + rows written gives the row after the last item, which is
  // where the totals formula was placed.
  const dataRows = data.sheets.find(s => s.categoryCode === sheet.category_code)?.rows.length ?? 0;
  const address = `${sheet.totals_column}${sheet.first_data_row + dataRows}`;
  const value = read.sheets.find(s => s.name === sheet.sheet_name)?.cells.get(address);
  const claimed = result.perSheetCounts[index]?.claimed;
  console.log(`CACHED ${sheet.sheet_name} ${address} = ${value} (claimed ${claimed})`);
  if (Number(value) !== claimed) {
    throw new Error(`Fixture script: ${sheet.sheet_name} ${address} cached ${value} but claimed ${claimed}`);
  }
  totals.push({ sheet: sheet.sheet_name, address, expected: claimed });
});

const grandAddress = `${summary.total_column}${grandTotalRow}`;
const grand = read.sheets.find(s => s.name === summary.sheet_name)?.cells.get(grandAddress);
console.log(`CACHED ${summary.sheet_name} ${grandAddress} = ${grand} (claimed ${result.totalItems})`);
if (Number(grand) !== result.totalItems) {
  throw new Error(`Fixture script: grand total cached ${grand} but claimed ${result.totalItems}`);
}
totals.push({ sheet: summary.sheet_name, address: grandAddress, expected: result.totalItems });

writeFileSync(`${OUT_DIR}/expected_totals.json`, `${JSON.stringify({ filename: result.filename, totals }, null, 2)}\n`);
console.log(`WROTE ${OUT_DIR}/expected_totals.json`);