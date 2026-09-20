import type { ProposalVersionState } from "../types.js";

const VALID_PROPOSAL_TRANSITIONS: Record<ProposalVersionState, ProposalVersionState[]> = {
  READY: ["PENDING_APPROVAL", "SUPERSEDED", "STALE", "EXPIRED"],
  PENDING_APPROVAL: ["APPROVED", "REJECTED", "SUPERSEDED", "STALE", "EXPIRED"],
  APPROVED: ["POSTED", "STALE", "FAILED" as any],
  POSTED: [],
  REJECTED: [],
  EXPIRED: [],
  SUPERSEDED: [],
  STALE: ["READY"] // Re-validated creates new version or resets
};

export function transitionProposalVersion(
  current: ProposalVersionState,
  next: ProposalVersionState
): ProposalVersionState {
  const allowed = VALID_PROPOSAL_TRANSITIONS[current];
  if (!allowed || !allowed.includes(next)) {
    throw new Error(`Illegal proposal version transition from ${current} to ${next}`);
  }
  return next;
}
