import type { ApprovalRule, TransactionContext, ApprovalTierConfig } from "../types.js";

export function evaluatePredicate(predicate: string, ctx: TransactionContext): boolean {
  if (predicate === "always") return true;

  if (predicate === "status_to:terminal") {
    return ctx.isTerminalStatus;
  }

  if (predicate === "op:create_asset") {
    return ctx.isCreateAsset;
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

export function determineApprovalTier(
  rules: ApprovalRule[],
  ctx: TransactionContext
): number {
  // Sort by priority ascending (1 is highest priority)
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);

  for (const rule of sorted) {
    if (evaluatePredicate(rule.predicate, ctx)) {
      return rule.tier;
    }
  }

  return 1;
}

export function validateDecision(
  tierConfig: ApprovalTierConfig,
  approverRef: string,
  submitterRef: string,
  existingApprovals: { actorRef: string }[]
): { allowed: boolean; reason?: string } {
  // Self approval check (Tiers 2 & 3 forbid self-approval)
  if (!tierConfig.allowSelfApproval && approverRef === submitterRef) {
    return {
      allowed: false,
      reason: "Self-approval is forbidden for this tier."
    };
  }

  // Duplicate approval check
  if (existingApprovals.some(a => a.actorRef === approverRef)) {
    return {
      allowed: false,
      reason: "Approver has already approved this version."
    };
  }

  return { allowed: true };
}
