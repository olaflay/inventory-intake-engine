/**
 * Minimal OOXML (.xlsx) writer and reader.
 *
 * The repository ships zero runtime dependencies, so this module builds the
 * zip container by hand using node:zlib. It supports exactly what the export
 * projection needs: inline strings, numbers, and formulas with cached values
 * so a read-back works without a spreadsheet application.
 */

import { deflateRawSync, inflateRawSync } from "node:zlib";

export type CellKind = "string" | "number" | "formula";

export interface SheetCell {
  address: string;
  kind: CellKind;
  value?: string;
  number?: number;
  formula?: string;
  cachedValue?: number;
}

export interface SheetSpec {
  name: string;
  cells: SheetCell[];
}

export interface WorkbookSpec {
  sheets: SheetSpec[];
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  name: string;
  data: Buffer;
  crc: number;
  compressed: Buffer;
}

/**
 * Build a zip archive. Uses STORE (method 0) because every entry here is small
 * and reproducibility matters more than size for an audit artefact.
 */
function buildZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data);
    const compressed = deflateRawSync(entry.data, { level: 9 });

    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    nameBytes.copy(local, 30);

    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nameBytes.copy(central, 46);

    locals.push(local, compressed);
    centrals.push(central);
    offset += local.length + compressed.length;
  }

  const centralBuffer = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuffer, end]);
}

function parseZip(buf: Buffer): Map<string, Buffer> {
  // Locate the end-of-central-directory record, then walk the central directory.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) {
    throw new Error("Export Self-Check Failed: produced file is not a readable workbook archive");
  }

  const entryCount = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();

  for (let i = 0; i < entryCount; i++) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) {
      throw new Error("Export Self-Check Failed: corrupt workbook central directory");
    }
    const method = buf.readUInt16LE(ptr + 10);
    const compressedSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOffset = buf.readUInt32LE(ptr + 42);
    const name = buf.toString("utf8", ptr + 46, ptr + 46 + nameLen);

    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compressedSize);
    out.set(name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw));

    ptr += 46 + nameLen + extraLen + commentLen;
  }

  return out;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Assert the sheet name is usable as-is. Renaming silently here would produce
 * a file whose sheet names no longer match the controlled template, so an
 * invalid name is a hard failure (FR-EXP-01 template fidelity).
 */
function assertSheetName(sheetName: string): string {
  if (!sheetName || sheetName.trim().length === 0) {
    throw new Error("Export Template Invalid: sheet name cannot be empty");
  }
  // Excel forbids \ / ? * [ ] : and caps worksheet names at 31 characters.
  if (/[\\/?*:[\]]/.test(sheetName)) {
    throw new Error(`Export Template Invalid: sheet name '${sheetName}' contains characters Excel forbids`);
  }
  if (sheetName.length > 31) {
    throw new Error(`Export Template Invalid: sheet name '${sheetName}' exceeds the 31-character Excel limit`);
  }
  return sheetName;
}

function cellXml(cell: SheetCell): string {
  if (cell.kind === "formula") {
    const cached = cell.cachedValue === undefined ? 0 : cell.cachedValue;
    return `<c r="${cell.address}"><f>${escapeXml(cell.formula ?? "")}</f><v>${cached}</v></c>`;
  }
  if (cell.kind === "number") {
    return `<c r="${cell.address}"><v>${cell.number ?? 0}</v></c>`;
  }
  return `<c r="${cell.address}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell.value ?? "")}</t></is></c>`;
}

function sheetXml(sheet: SheetSpec): string {
  const byRow = new Map<number, SheetCell[]>();
  for (const cell of sheet.cells) {
    const row = Number(/(\d+)$/.exec(cell.address)?.[1]);
    const bucket = byRow.get(row);
    if (bucket) {
      bucket.push(cell);
    } else {
      byRow.set(row, [cell]);
    }
  }

  const columnIndex = (address: string): number => {
    const letters = /^([A-Za-z]+)/.exec(address)?.[1] ?? "A";
    let index = 0;
    for (const char of letters.toUpperCase()) {
      index = index * 26 + (char.charCodeAt(0) - 64);
    }
    return index - 1;
  };

  const rows = Array.from(byRow.keys())
    .sort((a, b) => a - b)
    .map(row => {
      // OOXML expects cells in ascending column order within a row.
      const cells = [...(byRow.get(row) ?? [])].sort(
        (a, b) => columnIndex(a.address) - columnIndex(b.address)
      );
      return `<row r="${row}">${cells.map(cellXml).join("")}</row>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1"/><sheetData>${rows}</sheetData></worksheet>`;
}

const CONTENT_TYPES_HEADER =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`;

const STYLES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="1"><xf xfId="0"/></cellXfs></styleSheet>`;

const ROOT_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

/** Serialize a workbook specification into .xlsx bytes. */
export function writeXlsx(spec: WorkbookSpec): Buffer {
  if (spec.sheets.length === 0) {
    throw new Error("Export Self-Check Failed: workbook has no sheets");
  }

  const entries: ZipEntry[] = [];
  const push = (name: string, data: string) => {
    const buf = Buffer.from(data, "utf8");
    entries.push({ name, data: buf, crc: 0, compressed: buf });
  };

  let contentTypes = CONTENT_TYPES_HEADER;
  const sheetEntries: Array<{ fileName: string; xml: string }> = [];
  const workbookSheetTags: string[] = [];

  const seenNames = new Set<string>();
  spec.sheets.forEach((sheet, index) => {
    const fileName = `sheet${index + 1}.xml`;
    const xml = sheetXml(sheet);
    sheetEntries.push({ fileName, xml });
    contentTypes += `<Override PartName="/xl/worksheets/${fileName}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`;
    const sheetName = assertSheetName(sheet.name);
    // Excel rejects a workbook with two identically named sheets.
    if (seenNames.has(sheetName.toLowerCase())) {
      throw new Error(`Export Template Invalid: duplicate sheet name '${sheetName}'`);
    }
    seenNames.add(sheetName.toLowerCase());
    workbookSheetTags.push(`<sheet name="${escapeXml(sheetName)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`);
  });
  contentTypes += "</Types>";

  const workbookRels = sheetEntries
    .map((entry, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/${entry.fileName}"/>`)
    .join("");

  push("[Content_Types].xml", contentTypes);
  push("_rels/.rels", ROOT_RELS);
  push(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${workbookSheetTags.join("")}</sheets></workbook>`
  );
  push(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${workbookRels}<Relationship Id="rId${sheetEntries.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
  );
  push("xl/styles.xml", STYLES_XML);
  for (const entry of sheetEntries) {
    push(`xl/worksheets/${entry.fileName}`, entry.xml);
  }

  return buildZip(entries);
}

export interface ReadBackSheet {
  name: string;
  cells: Map<string, string | number>;
}

export interface ReadBackWorkbook {
  sheets: ReadBackSheet[];
}

/**
 * Read a produced workbook back from its bytes.
 * This is the independent half of the self-check: the exporter recomputes
 * totals from the cells it finds here, not from the values it intended to write.
 */
export function readXlsx(buf: Buffer): ReadBackWorkbook {
  const entries = parseZip(buf);

  const workbookXml = entries.get("xl/workbook.xml")?.toString("utf8");
  const relsXml = entries.get("xl/_rels/workbook.xml.rels")?.toString("utf8");
  if (!workbookXml || !relsXml) {
    throw new Error("Export Self-Check Failed: produced file has no workbook part");
  }

  const relTargets = new Map<string, string>();
  for (const match of relsXml.matchAll(/<Relationship\s+Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
    relTargets.set(match[1], match[2]);
  }

  const sheets: ReadBackSheet[] = [];
  for (const match of workbookXml.matchAll(/<sheet\s+name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    const sheetName = match[1].replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    const target = relTargets.get(match[2]);
    if (!target) {
      throw new Error(`Export Self-Check Failed: sheet '${sheetName}' has no relationship target`);
    }
    const xml = entries.get(`xl/${target}`)?.toString("utf8");
    if (!xml) {
      throw new Error(`Export Self-Check Failed: sheet '${sheetName}' part is missing`);
    }
    sheets.push({ name: sheetName, cells: parseSheetCells(xml) });
  }

  return { sheets };
}

function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function parseSheetCells(xml: string): Map<string, string | number> {
  const cells = new Map<string, string | number>();
  const cellPattern = /<c\s+([^>]*?)>([\s\S]*?)<\/c>|<c\s+([^>]*?)\/>/g;

  for (const match of xml.matchAll(cellPattern)) {
    const attrs = match[1] ?? match[3] ?? "";
    const inner = match[2] ?? "";
    const ref = /r="([^"]+)"/.exec(attrs)?.[1];
    if (!ref) continue;

    const valueMatch = /<v>([\s\S]*?)<\/v>/.exec(inner);
    if (valueMatch) {
      const raw = valueMatch[1];
      const numeric = Number(raw);
      cells.set(ref, raw !== "" && !Number.isNaN(numeric) ? numeric : raw);
      continue;
    }

    const textMatch = /<t[^>]*>([\s\S]*?)<\/t>/.exec(inner);
    if (textMatch) {
      cells.set(ref, unescapeXml(textMatch[1]));
    }
  }

  return cells;
}