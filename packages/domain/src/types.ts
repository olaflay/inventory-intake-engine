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
  distinguishingTokens?: string[][];
  nullSerialTokens?: string[];
}

export type MatchState =
  | "exact"
  | "exact_with_neighbor"
  | "possible"
  | "ambiguous"
  | "unknown"
  | "non_inventory"
  | "consumable"
  | "new_asset_candidate"
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
  | "DRAFT"
  | "READY"
  | "PENDING_APPROVAL"
  | "PARTIALLY_APPROVED"
  | "APPROVED"
  | "POSTED"
  | "REJECTED"
  | "AMENDED"
  | "EXPIRED"
  | "SUPERSEDED"
  | "STALE";

export type DispatchState =
  | "open"
  | "received"
  | "partially_received"
  | "cancelled";

export type MovementState = "at_location" | "in_transit";

export type ProposalKind =
  | "dispatch"
  | "dispatch_unitemized"
  | "assertion"
  | "receive"
  | "reversal";

export interface ProposalHeader {
  proposalId?: UUID;
  submissionId: UUID;
  kind: ProposalKind;
  sourceLocationId?: UUID | null;
  sourceLocationText?: string | null;
  destinationLocationId?: UUID | null;
  destinationLocationText?: string | null;
  documentReferences: string[];
  waybillNo?: string;
  manifestNo?: string;
  notes?: string;
}

export interface ProposalLine {
  lineNo: number;
  extractedDescription: string;
  extractedSerials: string[];
  quantity: number;
  matchState: MatchState;
  assetId: UUID | null;
  candidates: SerialMatchCandidate[];
  flags: string[];
  action: "move" | "verify" | "placeholder" | "create_unknown" | "skip";
  targetLocationId?: UUID | null;
  targetStatusCode?: string;
  isPlaceholder?: boolean;
  remarks?: string;
}

export interface ProposalQuestion {
  id: string;
  questionKey: string;
  type: "choice" | "text" | "confirm";
  prompt: string;
  options?: { id: string; label: string }[];
  context?: Record<string, any>;
}

export interface Proposal {
  id: UUID;
  submissionId: UUID;
  version: number;
  state: ProposalVersionState;
  header: ProposalHeader;
  lines: ProposalLine[];
  missingFromList?: { assetId: UUID; description: string; serials: string[] }[];
  questions: ProposalQuestion[];
  tier: number;
  configSnapshotId?: string;
  createdAt: string;
  expiresAt?: string;
}

export type ProposalDecisionType = "approve" | "reject" | "amend";

export interface ProposalAmendment {
  candidateOverrides?: Record<number, string>; // lineNo -> assetId
  locationOverride?: UUID | null;
  droppedLineNos?: number[];
  serialOverrides?: Record<number, string[]>;
  targetStatusCode?: string;
}

export interface ProposalDecision {
  id: UUID;
  proposalId: UUID;
  proposalVersion: number;
  actorRef: string;
  actorRole: string;
  decision: ProposalDecisionType;
  assurance: "none" | "channel_authenticated" | "re_authenticated" | "dual_signed" | string;
  note?: string;
  amendment?: ProposalAmendment;
  timestamp: string;
}

export interface LedgerEntry {
  id: UUID;
  transactionId: UUID;
  proposalId: UUID;
  proposalVersion: number;
  assetId: UUID;
  kind?: string;
  before?: any;
  after?: any;
  movementState: "at_location" | "in_transit";
  fromLocationId: UUID | null;
  toLocationId: UUID | null;
  dispatchId?: UUID | null;
  statusCode: string;
  reversesEntryId?: UUID | null;
  actorRef: string;
  timestamp: string;
}

export interface DispatchRecord {
  id: UUID;
  fromLocationId: UUID;
  toLocationId: UUID;
  assetIds: UUID[];
  status: "open" | "received" | "cancelled";
  createdAt: string;
  receivedAt?: string;
}
