/**
 * Cell Grid Address Math (PRD 20.3 step 2)
 * Pure functions only: no I/O, no defaults, no domain vocabulary.
 * The exporter computes every totals address from the row count it just wrote
 * instead of inheriting formulas from the controlled template.
 */

export interface Address {
  column: number;
  row: number;
}

/** Convert a zero-based column index into its spreadsheet letter (0 -> A). */
export function columnToLetter(column: number): string {
  if (!Number.isInteger(column) || column < 0) {
    throw new Error(`Export Template Invalid: column index must be a non-negative integer, got ${column}`);
  }
  let letter = "";
  let remaining = column;
  while (remaining >= 0) {
    letter = String.fromCharCode((remaining % 26) + 65) + letter;
    remaining = Math.floor(remaining / 26) - 1;
  }
  return letter;
}

/** Convert a spreadsheet column letter into its zero-based index (A -> 0). */
export function letterToColumn(letter: string): number {
  if (!/^[A-Za-z]+$/.test(letter)) {
    throw new Error(`Export Template Invalid: '${letter}' is not a column letter`);
  }
  let column = 0;
  for (const char of letter.toUpperCase()) {
    column = column * 26 + (char.charCodeAt(0) - 64);
  }
  return column - 1;
}

/** Build an A1 address such as 'B7'. */
export function cellAddress(column: number, row: number): string {
  if (!Number.isInteger(row) || row < 1) {
    throw new Error(`Export Template Invalid: row must be a 1-based integer, got ${row}`);
  }
  return `${columnToLetter(column)}${row}`;
}

/** Parse an A1 address such as 'B7' back into zero-based column plus 1-based row. */
export function parseAddress(address: string): Address {
  const match = /^([A-Za-z]+)(\d+)$/.exec(address);
  if (!match) {
    throw new Error(`Export Template Invalid: '${address}' is not an A1 address`);
  }
  return { column: letterToColumn(match[1]), row: Number(match[2]) };
}

/** Build an inclusive range such as 'B7:B9'. */
export function cellRange(start: Address, end: Address): string {
  if (start.column !== end.column) {
    throw new Error("Export Template Invalid: a range must stay within one column");
  }
  if (end.row < start.row) {
    throw new Error("Export Template Invalid: a range must not end before it starts");
  }
  return `${cellAddress(start.column, start.row)}:${cellAddress(end.column, end.row)}`;
}

/** Number of rows a sheet occupies when written from `firstDataRow`. */
export function rowSpan(itemCount: number, firstDataRow: number): { firstRow: number; lastRow: number; rowCount: number } {
  if (!Number.isInteger(itemCount) || itemCount < 0) {
    throw new Error(`Export Template Invalid: item count must be a non-negative integer, got ${itemCount}`);
  }
  if (!Number.isInteger(firstDataRow) || firstDataRow < 1) {
    throw new Error(`Export Template Invalid: firstDataRow must be a 1-based integer, got ${firstDataRow}`);
  }
  if (itemCount === 0) {
    return { firstRow: firstDataRow, lastRow: firstDataRow - 1, rowCount: 0 };
  }
  return { firstRow: firstDataRow, lastRow: firstDataRow + itemCount - 1, rowCount: itemCount };
}

/**
 * Build the totals formula for one sheet.
 * Counts the identity column over exactly the rows the exporter wrote, so an
 * inserted or dropped row changes the result instead of silently shifting.
 */
export function buildCountFormula(identityColumn: number, span: { firstRow: number; lastRow: number; rowCount: number }): string {
  if (span.rowCount === 0) {
    return "0";
  }
  return `COUNTA(${cellRange({ column: identityColumn, row: span.firstRow }, { column: identityColumn, row: span.lastRow })})`;
}

/** Build the grand-total formula across per-sheet count cells on the summary sheet. */
export function buildGrandTotalFormula(perSheetTotals: Array<{ sheetName: string; address: string }>): string {
  if (perSheetTotals.length === 0) {
    return "0";
  }
  const parts = perSheetTotals.map(entry => `'${escapeSheetNameForFormula(entry.sheetName)}'!${entry.address}`);
  return `SUM(${parts.join(",")})`;
}

function escapeSheetNameForFormula(name: string): string {
  return name.replace(/'/g, "''");
}