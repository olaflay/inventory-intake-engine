export interface DetectedMime {
  mime: string;
  extension: string;
  isSupported: boolean;
  isExecutable: boolean;
}

export const SUPPORTED_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "application/pdf",
  "image/webp",
  "image/tiff"
]);

/**
 * Magic Bytes Ingestion Validator (FR-DOC-01, EC-15)
 * Inspects leading file signature bytes to determine real file format.
 * Guards against renamed executables (.exe -> .jpg) and decompression hazards.
 */
export function detectMimeFromBytes(buffer: Uint8Array): DetectedMime {
  if (buffer.length < 4) {
    return { mime: "application/octet-stream", extension: "bin", isSupported: false, isExecutable: false };
  }

  // 1. Windows Executable check (MZ header: 0x4D 0x5A)
  if (buffer[0] === 0x4d && buffer[1] === 0x5a) {
    return { mime: "application/x-msdownload", extension: "exe", isSupported: false, isExecutable: true };
  }

  // 2. JPEG (0xFF 0xD8 0xFF)
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: "image/jpeg", extension: "jpg", isSupported: true, isExecutable: false };
  }

  // 3. PNG (0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A)
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { mime: "image/png", extension: "png", isSupported: true, isExecutable: false };
  }

  // 4. PDF (%PDF-: 0x25 0x50 0x44 0x46)
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return { mime: "application/pdf", extension: "pdf", isSupported: true, isExecutable: false };
  }

  // 5. WebP (RIFF....WEBP)
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return { mime: "image/webp", extension: "webp", isSupported: true, isExecutable: false };
  }

  // 6. TIFF (II*. or MM.*)
  if (
    (buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00) ||
    (buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a)
  ) {
    return { mime: "image/tiff", extension: "tiff", isSupported: true, isExecutable: false };
  }

  return { mime: "application/octet-stream", extension: "bin", isSupported: false, isExecutable: false };
}
