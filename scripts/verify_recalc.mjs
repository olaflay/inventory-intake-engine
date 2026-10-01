#!/usr/bin/env node
/**
 * Assert that LibreOffice's own recalculation of the totals formulas agrees
 * with what the exporter claimed from the database (FR-EXP-01, PRD 20.3 step 6).
 *
 * The exporter writes cached values so the file looks right before any
 * calculation. This script ignores those cached values' authority: it reads
 * the file LibreOffice produced and compares the recalculated numbers against
 * the claims the fixture script recorded.
 *
 * Usage: node scripts/verify_recalc.mjs <recalc-dir> <expected-json>
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readXlsx } from "../packages/engine/dist/index.js";

const [dir, expectedPath] = process.argv.slice(2);
if (!dir || !expectedPath) {
  console.error("Usage: node scripts/verify_recalc.mjs <recalc-dir> <expected-json>");
  process.exit(2);
}

const expected = JSON.parse(readFileSync(expectedPath, "utf-8"));

const file = readdirSync(dir).find(name => name.endsWith(".xlsx"));
if (!file) {
  console.error(`FAIL: no .xlsx produced in ${dir}`);
  process.exit(1);
}

const workbook = readXlsx(readFileSync(join(dir, file)));
const read = (sheet, address) => workbook.sheets.find(s => s.name === sheet)?.cells.get(address);

const failures = [];

for (const check of expected.totals) {
  const actual = Number(read(check.sheet, check.address));
  console.log(`recalculated ${check.sheet} ${check.address} = ${actual} (expected ${check.expected})`);
  if (!Number.isFinite(actual) || actual !== check.expected) {
    failures.push(`${check.sheet} ${check.address}: recalculated ${actual}, expected ${check.expected}`);
  }
}

if (failures.length > 0) {
  console.error("FAIL: LibreOffice recalculation disagrees with the exporter claims:");
  for (const line of failures) {
    console.error(`  ${line}`);
  }
  process.exit(1);
}

console.log(`PASS: LibreOffice recalculated ${expected.totals.length} totals and all match`);