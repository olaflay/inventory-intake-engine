import type { UUID, DispatchRecord, Proposal } from "@inventory/domain";

export interface DailyDigestConfig {
  overdueDispatchDays: number;
  agingApprovalHours: number;
}

export interface OverdueDispatchItem {
  dispatchId: UUID;
  fromLocationId: UUID;
  toLocationId: UUID;
  assetCount: number;
  daysOpen: number;
  createdAt: string;
}

export interface AgingApprovalItem {
  proposalId: UUID;
  tier: number;
  hoursOpen: number;
  state: string;
  createdAt: string;
}

export interface DailyDigestResult {
  digestType: "daily";
  date: string;
  timestamp: string;
  counts: {
    overdueDispatches: number;
    agingApprovals: number;
    unresolvedQuestions: number;
    unlinkedReceipts: number;
  };
  overdueDispatches: OverdueDispatchItem[];
  agingApprovals: AgingApprovalItem[];
  unlinkedReceipts: string[];
  fallbackText: string;
}

/**
 * DailyDigestService (FR-OPS-01, PRD §9.8, §28)
 * Compiles daily operational summary of overdue dispatches, aging approvals,
 * unresolved questions, and unlinked receipts.
 */
export class DailyDigestService {
  private config: DailyDigestConfig;

  constructor(config: DailyDigestConfig) {
    if (!config) {
      throw new Error("DailyDigestService requires configuration (LD-5: no defaults in code).");
    }
    if (config.overdueDispatchDays === undefined || config.overdueDispatchDays === null) {
      throw new Error("DailyDigestService requires overdueDispatchDays in configuration (LD-5: no defaults in code).");
    }
    if (config.agingApprovalHours === undefined || config.agingApprovalHours === null) {
      throw new Error("DailyDigestService requires agingApprovalHours in configuration (LD-5: no defaults in code).");
    }
    this.config = config;
  }

  generateDigest(
    dateStr: string,
    openDispatches: DispatchRecord[],
    proposals: Proposal[],
    currentTime: Date = new Date()
  ): DailyDigestResult {
    const overdueMs = this.config.overdueDispatchDays * 24 * 60 * 60 * 1000;
    const agingMs = this.config.agingApprovalHours * 60 * 60 * 1000;
    const now = currentTime.getTime();

    // 1. Overdue Dispatches (EC-22, EC-49)
    const overdueDispatches: OverdueDispatchItem[] = [];
    for (const d of openDispatches) {
      if (d.status === "open") {
        const createdMs = new Date(d.createdAt).getTime();
        const ageMs = now - createdMs;
        if (ageMs >= overdueMs) {
          overdueDispatches.push({
            dispatchId: d.id,
            fromLocationId: d.fromLocationId,
            toLocationId: d.toLocationId,
            assetCount: d.assetIds.length,
            daysOpen: Math.floor(ageMs / (24 * 60 * 60 * 1000)),
            createdAt: d.createdAt
          });
        }
      }
    }

    // 2. Aging Approvals & Unresolved Questions
    const agingApprovals: AgingApprovalItem[] = [];
    let unresolvedQuestionsCount = 0;
    const unlinkedReceipts: string[] = [];

    for (const p of proposals) {
      if (p.state === "PENDING_APPROVAL" || p.state === "PARTIALLY_APPROVED") {
        const createdMs = new Date(p.createdAt).getTime();
        const ageMs = now - createdMs;
        if (ageMs >= agingMs) {
          agingApprovals.push({
            proposalId: p.id,
            tier: p.tier,
            hoursOpen: Math.floor(ageMs / (60 * 60 * 1000)),
            state: p.state,
            createdAt: p.createdAt
          });
        }
      }

      if (p.questions && p.questions.length > 0) {
        unresolvedQuestionsCount += p.questions.length;
      }

      // Check unlinked receipts
      for (const line of p.lines) {
        if (line.flags.includes("unlinked_receipt")) {
          unlinkedReceipts.push(`Proposal ${p.id} Line ${line.lineNo}: ${line.extractedDescription}`);
        }
      }
    }

    const fallbackText = [
      `Daily Operations Digest (${dateStr})`,
      `• Overdue Dispatches: ${overdueDispatches.length}`,
      `• Aging Approvals: ${agingApprovals.length}`,
      `• Unresolved Questions: ${unresolvedQuestionsCount}`,
      `• Unlinked Receipts: ${unlinkedReceipts.length}`
    ].join("\n");

    return {
      digestType: "daily",
      date: dateStr,
      timestamp: currentTime.toISOString(),
      counts: {
        overdueDispatches: overdueDispatches.length,
        agingApprovals: agingApprovals.length,
        unresolvedQuestions: unresolvedQuestionsCount,
        unlinkedReceipts: unlinkedReceipts.length
      },
      overdueDispatches,
      agingApprovals,
      unlinkedReceipts,
      fallbackText
    };
  }
}
