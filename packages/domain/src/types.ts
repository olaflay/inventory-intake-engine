export type UUID = string;

export interface NormalizedText {
  raw: string;
  normalized: string;
}

export interface ConfusionPair {
  a: string;
  b: string;
  cost: number;
}

export interface MatchingConfig {
  fuzzyMinLength: number;
  fuzzyMaxDistance: number;
  shortNumericExactOnly: boolean;
  ignorableChars: string[];
  separators: string[];
  partMinLength: number;
  candidateMinScore: number;
  maxCandidates: number;
  descriptionSimilarityMin: number;
  confusionPairs: ConfusionPair[];
}

export type MatchState =
  | "exact"
  | "exact_with_neighbor"
  | "possible"
  | "ambiguous"
  | "unknown"
  | "classification";

export interface SerialMatchCandidate {
  assetId: UUID;
  internalRef: string;
  serialRaw: string;
  serialNorm: string;
  score: number;
  distance: number;
  description: string;
  locationId: UUID | null;
  statusCode: string;
  flags: string[];
}

export interface MatchResult {
  state: MatchState;
  assetId: UUID | null;
  candidates: SerialMatchCandidate[];
  flags: string[];
  evidenceText?: string;
  resolution?: {
    action: "move" | "reconcile" | "create_unknown" | "skip";
    destinationLocationId?: UUID;
  };
}

export interface ApprovalTierConfig {
  tier: number;
  label: string;
  approverRoles: string[];
  approvalsRequired: number;
  minAssurance: string;
  allowSelfApproval: boolean;
  expiryHours: number;
}

export interface ApprovalRule {
  priority: number;
  name: string;
  predicate: string; // e.g. "status_to:terminal", "flag:location_conflict", "lines>10"
  tier: number;
}

export interface TransactionContext {
  submitterRole: string;
  submitterRef: string;
  lineCount: number;
  flags: string[];
  lineStates: MatchState[];
  statusChanges: { from?: string; to?: string }[];
  isTerminalStatus: boolean;
  isCreateAsset: boolean;
  reversalDays?: number;
}

export type SubmissionState =
  | "DRAFT"
  | "CLOSED"
  | "PROCESSING"
  | "NEEDS_INPUT"
  | "PROPOSED"
  | "AWAITING_APPROVAL"
  | "APPROVED"
  | "POSTING"
  | "POSTED"
  | "CANCELLED"
  | "REJECTED"
  | "EXPIRED"
  | "NEEDS_REVIEW"
  | "FAILED";

export type ProposalVersionState =
  | "READY"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "POSTED"
  | "REJECTED"
  | "EXPIRED"
  | "SUPERSEDED"
  | "STALE";

export type DispatchState =
  | "open"
  | "received"
  | "partially_received"
  | "cancelled";

export type MovementState = "at_location" | "in_transit";
