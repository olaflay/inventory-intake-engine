import type { QualityCheckResult } from "../types.js";

export interface QualityGateConfig {
  maxPixels: number;
  minPixels: number;
  minLaplacianVariance: number;
}

const DEFAULT_CONFIG: QualityGateConfig = {
  maxPixels: 40_000_000,
  minPixels: 10_000,
  minLaplacianVariance: 100.0
};

/**
 * Validates image quality prior to expensive vision AI calls.
 * Fails fast if image is corrupted, too small, or completely unreadable.
 */
export function evaluateQuality(
  width: number,
  height: number,
  estimatedVariance: number,
  config: QualityGateConfig = DEFAULT_CONFIG
): QualityCheckResult {
  const reasons: string[] = [];
  const pixels = width * height;

  if (pixels < config.minPixels) {
    reasons.push("Resolution too low to reliably resolve serial numbers.");
  }

  if (pixels > config.maxPixels) {
    reasons.push("Image exceeds maximum allowed dimensions.");
  }

  if (estimatedVariance < config.minLaplacianVariance) {
    reasons.push("Image is severely blurred or out of focus.");
  }

  return {
    passed: reasons.length === 0,
    blurVariance: estimatedVariance,
    width,
    height,
    reasons,
    rotationNeeded: 0
  };
}
