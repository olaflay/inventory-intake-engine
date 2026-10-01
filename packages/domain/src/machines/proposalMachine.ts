import type { ProposalVersionState } from "../types.js";

const VALID_PROPOSAL_TRANSITIONS: Record<ProposalVersionState, ProposalVersionState[]> = {
  DRAFT: ["READY", "PENDING_APPROVAL", "SUPERSEDED"],
  READY: ["PENDING_APPROVAL", "SUPERSEDED", "STALE", "EXPIRED"],
  PENDING_APPROVAL: ["PARTIALLY_APPROVED", "APPROVED", "REJECTED", "AMENDED", "SUPERSEDED", "STALE", "EXPIRED"],
  PARTIALLY_APPROVED: ["APPROVED", "REJECTED", "AMENDED", "SUPERSEDED", "STALE", "EXPIRED"],
  APPROVED: ["POSTED", "STALE", "SUPERSEDED", "EXPIRED"],
  POSTED: [],
  REJECTED: [],
  AMENDED: ["SUPERSEDED"],
  EXPIRED: ["PENDING_APPROVAL", "SUPERSEDED"],
  SUPERSEDED: [],
  STALE: ["READY", "PENDING_APPROVAL", "SUPERSEDED"]
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
