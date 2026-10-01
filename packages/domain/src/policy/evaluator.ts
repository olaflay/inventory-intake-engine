import type { ApprovalRule, TransactionContext, ApprovalTierConfig } from "../types.js";

const ASSURANCE_RANKS: Record<string, number> = {
  "none": 0,
  "channel_authenticated": 1,
  "re_authenticated": 2,
  "dual_signed": 3
};

export function evaluatePredicate(predicate: string, ctx: TransactionContext): boolean {
  if (predicate === "always") return true;

  if (predicate === "status_to:terminal") {
    return ctx.isTerminalStatus;
  }

  if (predicate.startsWith("status_to:")) {
    const targetStatus = predicate.substring(10).toUpperCase();
    if (targetStatus === "TERMINAL") return ctx.isTerminalStatus;
    return (ctx.statusChanges || []).some(
      s => (s.to && s.to.toUpperCase() === targetStatus)
    );
  }

  if (predicate === "op:create_asset") {
    return ctx.isCreateAsset;
  }

  if (predicate === "unlinked_receipt" || predicate === "flag:unlinked_receipt") {
    return ctx.flags.includes("unlinked_receipt");
  }

  if (predicate.startsWith("op:reversal_after_days>")) {
    const threshold = parseInt(predicate.split(">")[1], 10);
    return (ctx.reversalDays ?? 0) > threshold;
  }

  if (predicate.startsWith("lines>")) {
    const threshold = parseInt(predicate.split(">")[1], 10);
    return ctx.lineCount > threshold;
  }

  if (predicate.startsWith("flag:")) {
    const flag = predicate.substring(5);
    return ctx.flags.includes(flag);
  }

  if (predicate.startsWith("line_state:")) {
    const state = predicate.substring(11);
    return ctx.lineStates.includes(state as any);
  }

  // Check compound "or" predicates e.g. "flag:low_quality or flag:injection_suspected"
  if (predicate.includes(" or ")) {
    const subPredicates = predicate.split(" or ");
    return subPredicates.some(p => evaluatePredicate(p.trim(), ctx));
  }

  return false;
}

/**
 * Determines the approval tier for a transaction context.
 * Per FR-APR-01: The tier of a proposal is the maximum tier of all matching approval rules.
 */
export function determineApprovalTier(
  rules: ApprovalRule[],
  ctx: TransactionContext
): number {
  let maxTier = 1;
  let matched = false;

  for (const rule of rules) {
    if (evaluatePredicate(rule.predicate, ctx)) {
      matched = true;
      if (rule.tier > maxTier) {
        maxTier = rule.tier;
      }
    }
  }

  return matched ? maxTier : 1;
}

export interface DecisionValidationResult {
  allowed: boolean;
  reason?: string;
  isDuplicate?: boolean;
  quorumReached?: boolean;
  totalApprovals?: number;
  approvalsRequired?: number;
}

/**
 * Validates a decision against tier configuration and existing approval records (FR-APR-02, EC-42, EC-43, EC-51).
 */
export function validateDecision(
  tierConfig: ApprovalTierConfig,
  approverRef: string,
  approverRoleOrSubmitterRef: string,
  submitterRefOrExistingApprovals: string | { actorRef: string }[],
  existingApprovals?: { actorRef: string }[],
  assurance: string = "channel_authenticated"
): DecisionValidationResult {
  let approverRole = "";
  let submitterRef = "";
  let approvals: { actorRef: string }[] = [];

  if (Array.isArray(submitterRefOrExistingApprovals)) {
    // 4-arg signature: (tierConfig, approverRef, submitterRef, existingApprovals)
    submitterRef = approverRoleOrSubmitterRef;
    approvals = submitterRefOrExistingApprovals;
    approverRole = (tierConfig.approverRoles && tierConfig.approverRoles[0]) || "admin";
  } else {
    // Full signature: (tierConfig, approverRef, approverRole, submitterRef, existingApprovals, assurance)
    approverRole = approverRoleOrSubmitterRef;
    submitterRef = submitterRefOrExistingApprovals;
    approvals = existingApprovals || [];
  }

  // 1. Role validation (only if approverRole was explicitly checked)
  if (tierConfig.approverRoles && tierConfig.approverRoles.length > 0 && approverRole) {
    if (!tierConfig.approverRoles.includes(approverRole)) {
      return {
        allowed: false,
        reason: `Role '${approverRole}' is not authorized to approve Tier ${tierConfig.tier}. Required roles: [${tierConfig.approverRoles.join(", ")}].`
      };
    }
  }

  // 2. Minimum assurance check
  const minRank = ASSURANCE_RANKS[tierConfig.minAssurance] ?? 1;
  const actualRank = ASSURANCE_RANKS[assurance] ?? 1;
  if (actualRank < minRank) {
    return {
      allowed: false,
      reason: `Assurance level '${assurance}' does not meet minimum '${tierConfig.minAssurance}' for Tier ${tierConfig.tier}.`
    };
  }

  // 3. Self-approval check (Tiers 2 & 3 forbid self-approval per LD-6 & EC-42)
  if (!tierConfig.allowSelfApproval && approverRef === submitterRef) {
    return {
      allowed: false,
      reason: `Self-approval is forbidden for Tier ${tierConfig.tier} (LD-6, EC-42).`
    };
  }

  // 4. Duplicate tap idempotency (EC-51)
  const alreadyApproved = approvals.some(a => a.actorRef === approverRef);
  if (alreadyApproved) {
    return {
      allowed: true,
      isDuplicate: true,
      quorumReached: approvals.length >= tierConfig.approvalsRequired,
      totalApprovals: approvals.length,
      approvalsRequired: tierConfig.approvalsRequired
    };
  }

  // 5. Calculate new quorum
  const totalApprovals = approvals.length + 1;
  const quorumReached = totalApprovals >= tierConfig.approvalsRequired;

  return {
    allowed: true,
    isDuplicate: false,
    quorumReached,
    totalApprovals,
    approvalsRequired: tierConfig.approvalsRequired
  };
}
