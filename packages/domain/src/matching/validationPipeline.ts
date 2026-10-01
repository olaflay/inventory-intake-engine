import type { MatchState } from "../types.js";

export interface ValidationPipelineConfig {
  terminalStatuses?: string[];
  unrecordedLocationId?: string;
  distinguishingTokens?: string[][];
  constraintKeywords?: string[];
}

export interface ValidationLineInput {
  lineNo: number;
  extractedDescription: string;
  extractedSerials: string[];
  quantity: number;
  unread: boolean;
  remarks?: string;
  matchedAsset?: {
    id: string;
    description: string;
    locationId: string | null;
    statusCode: string;
  } | null;
  matchState: MatchState;
  existingFlags?: string[];
}

export interface ValidationResult {
  flags: string[];
  isTerminal: boolean;
  canAutoPost: boolean;
}

/**
 * Implements FR-VAL-01 Validation Pipeline in strict execution order:
 * 1. Structural checks
 * 2. Identity checks
 * 3. Asset state (terminal, in transit)
 * 4. Location consistency (skipped when stored location is unrecorded)
 * 5. Duplicate serials in submission
 * 6. Policy flags (remark constraints, description conflict)
 */
export function runValidationPipeline(
  line: ValidationLineInput,
  context: {
    sourceLocationId?: string | null;
    destinationLocationId?: string | null;
    submissionSerialsSeen?: Set<string>;
    config?: ValidationPipelineConfig;
  } = {}
): ValidationResult {
  const flags = new Set<string>(line.existingFlags || []);
  const config = context.config || {};
  const terminalStatuses = new Set(
    (config.terminalStatuses || ["SCRAPPED", "OBSOLETE", "LOST", "SOLD", "WRITTEN_OFF"]).map(s => s.toUpperCase())
  );
  const constraintKeywords = config.constraintKeywords || [
    "do not move", "hold", "quarantine", "reserved", "calibration due", "damaged", "repair"
  ];

  // 1. Structural Checks
  if (line.quantity <= 0) {
    flags.add("invalid_quantity");
  }
  if (line.unread) {
    flags.add("unread_serial");
  }

  // 2. Identity Checks
  if (line.extractedSerials.length > 0 && line.quantity > line.extractedSerials.length) {
    flags.add("qty_serial_mismatch");
  }

  // 3. Asset State Checks (EC-29)
  let isTerminal = false;
  if (line.matchedAsset) {
    const statusUpper = (line.matchedAsset.statusCode || "").toUpperCase();
    if (terminalStatuses.has(statusUpper)) {
      flags.add("terminal_status");
      isTerminal = true;
    }
    if (statusUpper === "IN_TRANSIT") {
      flags.add("asset_in_transit");
    }

    // 4. Location Consistency Checks (EC-30, EC-31, EC-41)
    const assetLoc = line.matchedAsset.locationId;
    const isUnrecorded = !assetLoc || assetLoc === "unrecorded" || assetLoc === config.unrecordedLocationId;

    // EC-30: Check if asset is already at declared destination
    if (context.destinationLocationId && assetLoc === context.destinationLocationId) {
      flags.add("already_at_destination");
    }

    // EC-31 / EC-41: Check source mismatch only if asset location is recorded
    if (context.sourceLocationId && !isUnrecorded) {
      if (assetLoc !== context.sourceLocationId) {
        flags.add("location_conflict");
      }
    }
    // Note: If isUnrecorded is true, EC-41 dictates: skip source-mismatch check; first movement sets it.
  }

  // 5. Duplicate Serials in Submission (EC-28)
  if (context.submissionSerialsSeen) {
    for (const s of line.extractedSerials) {
      const norm = s.trim().toUpperCase();
      if (norm.length > 0) {
        if (context.submissionSerialsSeen.has(norm)) {
          flags.add("duplicate_serial_in_source");
        } else {
          context.submissionSerialsSeen.add(norm);
        }
      }
    }
  }

  // 6. Policy Flags: Remark Constraints (EC-39)
  if (line.remarks && line.remarks.trim().length > 0) {
    const lowerRemarks = line.remarks.toLowerCase();
    const hasConstraint = constraintKeywords.some(kw => lowerRemarks.includes(kw));
    if (hasConstraint) {
      flags.add("remark_constraint");
    }
  }

  const canAutoPost = !isTerminal &&
    !flags.has("location_conflict") &&
    !flags.has("unread_serial") &&
    !flags.has("description_conflict") &&
    !flags.has("remark_constraint");

  return {
    flags: Array.from(flags),
    isTerminal,
    canAutoPost
  };
}
