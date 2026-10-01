import type {
  Proposal,
  ProposalVersionState,
  ProposalDecision,
  ProposalAmendment,
  ApprovalTierConfig
} from "../types.js";
import { validateDecision } from "./evaluator.js";

const VALID_PROPOSAL_TRANSITIONS: Record<ProposalVersionState, ProposalVersionState[]> = {
  "DRAFT": ["READY", "PENDING_APPROVAL", "SUPERSEDED"],
  "READY": ["PENDING_APPROVAL", "SUPERSEDED"],
  "PENDING_APPROVAL": ["PARTIALLY_APPROVED", "APPROVED", "REJECTED", "AMENDED", "STALE", "EXPIRED", "SUPERSEDED"],
  "PARTIALLY_APPROVED": ["APPROVED", "REJECTED", "AMENDED", "STALE", "EXPIRED", "SUPERSEDED"],
  "APPROVED": ["POSTED", "STALE", "EXPIRED", "SUPERSEDED"],
  "POSTED": [],
  "REJECTED": [],
  "AMENDED": ["SUPERSEDED"],
  "STALE": ["PENDING_APPROVAL", "SUPERSEDED"],
  "EXPIRED": ["PENDING_APPROVAL", "SUPERSEDED"],
  "SUPERSEDED": []
};

export class IllegalProposalTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Illegal proposal transition: cannot transition from ${from} to ${to}`);
    this.name = "IllegalProposalTransitionError";
  }
}

export function transitionProposal(
  currentState: ProposalVersionState,
  targetState: ProposalVersionState
): ProposalVersionState {
  const allowed = VALID_PROPOSAL_TRANSITIONS[currentState] || [];
  if (!allowed.includes(targetState)) {
    throw new IllegalProposalTransitionError(currentState, targetState);
  }
  return targetState;
}

export interface ProcessDecisionResult {
  proposal: Proposal;
  decision: ProposalDecision;
  state: ProposalVersionState;
  quorumReached: boolean;
  isDuplicate: boolean;
}

/**
 * Processes an incoming decision on a proposal (FR-APR-02, FR-APR-03, EC-42, EC-43, EC-51).
 */
export function processProposalDecision(
  proposal: Proposal,
  decision: ProposalDecision,
  tierConfig: ApprovalTierConfig,
  existingDecisions: ProposalDecision[] = [],
  submitterRef: string = ""
): ProcessDecisionResult {
  // 1. Verify proposal version matches expected decision version (FR-APR-02)
  if (decision.proposalVersion !== proposal.version) {
    throw new Error(`Expected proposal version ${decision.proposalVersion} but current version is ${proposal.version}`);
  }

  // 2. Reject immediately if decision is "reject"
  if (decision.decision === "reject") {
    proposal.state = transitionProposal(proposal.state, "REJECTED");
    return {
      proposal,
      decision,
      state: proposal.state,
      quorumReached: false,
      isDuplicate: false
    };
  }

  // 3. Amend flow (FR-APR-03): creates version N+1
  if (decision.decision === "amend") {
    if (!decision.amendment) {
      throw new Error("Amend decision requires amendment details.");
    }
    const amended = applyAmendment(proposal, decision.amendment);
    return {
      proposal: amended,
      decision,
      state: amended.state,
      quorumReached: false,
      isDuplicate: false
    };
  }

  // 4. Approve decision validation (FR-APR-02, EC-42, EC-43, EC-51)
  const existingApprovals = existingDecisions.filter(
    d => d.decision === "approve" && d.proposalVersion === proposal.version
  );

  const val = validateDecision(
    tierConfig,
    decision.actorRef,
    decision.actorRole,
    submitterRef,
    existingApprovals,
    decision.assurance
  );

  if (!val.allowed) {
    throw new Error(`Approval rejected: ${val.reason}`);
  }

  // If duplicate tap, acknowledge idempotently (EC-51)
  if (val.isDuplicate) {
    return {
      proposal,
      decision,
      state: proposal.state,
      quorumReached: val.quorumReached ?? false,
      isDuplicate: true
    };
  }

  // Determine state change based on quorum (EC-43)
  if (val.quorumReached) {
    proposal.state = transitionProposal(proposal.state, "APPROVED");
  } else {
    proposal.state = transitionProposal(proposal.state, "PARTIALLY_APPROVED");
  }

  return {
    proposal,
    decision,
    state: proposal.state,
    quorumReached: val.quorumReached ?? false,
    isDuplicate: false
  };
}

/**
 * Applies amendment to a proposal, generating version N+1 (FR-APR-03).
 */
export function applyAmendment(
  proposal: Proposal,
  amendment: ProposalAmendment
): Proposal {
  const nextVersion = proposal.version + 1;
  const updatedLines = [...proposal.lines];

  // 1. Drop lines if specified
  let filteredLines = updatedLines;
  if (amendment.droppedLineNos && amendment.droppedLineNos.length > 0) {
    filteredLines = updatedLines.filter(l => !amendment.droppedLineNos!.includes(l.lineNo));
  }

  // 2. Override candidate asset selections
  if (amendment.candidateOverrides) {
    for (const [lineNoStr, assetId] of Object.entries(amendment.candidateOverrides)) {
      const lineNo = parseInt(lineNoStr, 10);
      const line = filteredLines.find(l => l.lineNo === lineNo);
      if (line) {
        line.assetId = assetId;
        line.matchState = "exact";
        line.action = "move";
      }
    }
  }

  // 3. Override serials
  if (amendment.serialOverrides) {
    for (const [lineNoStr, serials] of Object.entries(amendment.serialOverrides)) {
      const lineNo = parseInt(lineNoStr, 10);
      const line = filteredLines.find(l => l.lineNo === lineNo);
      if (line) {
        line.extractedSerials = serials;
      }
    }
  }

  // 4. Override destination location
  const updatedHeader = { ...proposal.header };
  if (amendment.locationOverride) {
    updatedHeader.destinationLocationId = amendment.locationOverride;
    for (const line of filteredLines) {
      if (line.action === "move") {
        line.targetLocationId = amendment.locationOverride;
      }
    }
  }

  return {
    ...proposal,
    version: nextVersion,
    state: "PENDING_APPROVAL",
    header: updatedHeader,
    lines: filteredLines
  };
}
