/**
 * Serial and text normalization rules
 */

export function normalizeSerial(serial: string, ignorableChars: string[] = [" ", "-", "/", "_", "."]): string {
  if (!serial) return "";
  let norm = serial.trim().toUpperCase();
  for (const ch of ignorableChars) {
    norm = norm.replaceAll(ch, "");
  }
  return norm;
}

export function normalizeText(text: string): string {
  if (!text) return "";
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function isShortNumeric(serial: string): boolean {
  const norm = normalizeSerial(serial);
  return /^\d{1,6}$/.test(norm);
}

export function extractSerialParts(serial: string, separators: string[] = ["/", ",", ";", "+"], minPartLength = 3): string[] {
  if (!serial) return [];
  let parts = [serial];
  for (const sep of separators) {
    parts = parts.flatMap(p => p.split(sep));
  }
  return parts
    .map(p => normalizeSerial(p))
    .filter(p => p.length >= minPartLength);
}
