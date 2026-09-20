import crypto from "node:crypto";

export interface HashResult {
  sha256: string;
  perceptualHash: string; // 64-bit hexadecimal dHash
}

/**
 * Computes SHA-256 hash of raw byte buffer
 */
export function computeSha256(buffer: Uint8Array): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/**
 * Computes 64-bit perceptual difference hash (dHash) from image sample pixels or raw buffer.
 * For raw buffers where decoders are unavailable, downsamples byte intensity gradients.
 */
export function computePerceptualHash(buffer: Uint8Array, width = 9, height = 8): string {
  // If buffer is small, expand or hash pseudo-gradients
  const samples: number[] = [];
  const totalSamples = width * height;
  const step = Math.max(1, Math.floor(buffer.length / totalSamples));

  for (let i = 0; i < totalSamples; i++) {
    const idx = (i * step) % buffer.length;
    samples.push(buffer[idx]);
  }

  // Calculate row gradient: compare sample[x] > sample[x+1]
  let hashBits = "";
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width - 1; x++) {
      const left = samples[y * width + x];
      const right = samples[y * width + (x + 1)];
      hashBits += left > right ? "1" : "0";
    }
  }

  // Convert 64-bit string to 16-character hex string
  let hex = "";
  for (let i = 0; i < hashBits.length; i += 4) {
    const chunk = hashBits.slice(i, i + 4);
    hex += parseInt(chunk, 2).toString(16);
  }

  return hex.padStart(16, "0");
}

/**
 * Computes Hamming distance between two 64-bit perceptual hex hashes
 */
export function computeHammingDistance(hashA: string, hashB: string): number {
  if (hashA.length !== hashB.length) {
    return 64; // maximum distance
  }

  let distance = 0;
  for (let i = 0; i < hashA.length; i++) {
    const binA = parseInt(hashA[i], 16).toString(2).padStart(4, "0");
    const binB = parseInt(hashB[i], 16).toString(2).padStart(4, "0");
    for (let j = 0; j < 4; j++) {
      if (binA[j] !== binB[j]) {
        distance += 1;
      }
    }
  }

  return distance;
}

/**
 * Checks if two documents are duplicate files based on SHA-256 or perceptual hash distance (EC-05, EC-50)
 */
export function isDuplicateDocument(
  docA: { sha256: string; perceptualHash: string },
  docB: { sha256: string; perceptualHash: string },
  maxHammingDistance = 10
): { isDuplicate: boolean; reason?: "exact_sha256" | "near_perceptual"; distance?: number } {
  if (docA.sha256 === docB.sha256) {
    return { isDuplicate: true, reason: "exact_sha256", distance: 0 };
  }

  const dist = computeHammingDistance(docA.perceptualHash, docB.perceptualHash);
  if (dist <= maxHammingDistance) {
    return { isDuplicate: true, reason: "near_perceptual", distance: dist };
  }

  return { isDuplicate: false, distance: dist };
}
