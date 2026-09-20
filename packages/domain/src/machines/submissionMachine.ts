import type { SubmissionState } from "../types.js";

const VALID_TRANSITIONS: Record<SubmissionState, SubmissionState[]> = {
  DRAFT: ["CLOSED", "CANCELLED"],
  CLOSED: ["PROCESSING", "CANCELLED", "FAILED"],
  PROCESSING: ["NEEDS_INPUT", "PROPOSED", "NEEDS_REVIEW", "FAILED"],
  NEEDS_INPUT: ["PROCESSING", "NEEDS_REVIEW", "CANCELLED", "EXPIRED"],
  PROPOSED: ["AWAITING_APPROVAL", "NEEDS_INPUT", "CANCELLED", "EXPIRED"],
  AWAITING_APPROVAL: ["APPROVED", "REJECTED", "EXPIRED", "PROPOSED"],
  APPROVED: ["POSTING", "FAILED"],
  POSTING: ["POSTED", "FAILED", "PROPOSED"], // can revert to proposed if stale
  POSTED: [],
  CANCELLED: [],
  REJECTED: [],
  EXPIRED: [],
  NEEDS_REVIEW: ["PROCESSING", "CANCELLED"],
  FAILED: []
};

export function transitionSubmission(
  current: SubmissionState,
  next: SubmissionState
): SubmissionState {
  const allowed = VALID_TRANSITIONS[current];
  if (!allowed || !allowed.includes(next)) {
    throw new Error(`Illegal submission transition from ${current} to ${next}`);
  }
  return next;
}
