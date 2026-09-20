import crypto from "node:crypto";

export interface OpsWorkbookSheets {
  meta: Record<string, string>;
  actors: Array<{ actorRef: string; displayName: string; role: string; active: boolean }>;
  roles: Array<{ role: string; permission: string }>;
  tiers: Array<{ tier: number; label: string; approverRoles: string[]; approvalsRequired: number; minAssurance: string; allowSelfApproval: boolean; expiryHours: number }>;
  approvalRules: Array<{ priority: number; name: string; when: string; tier: number }>;
  limits: Record<string, number>;
  statuses: Array<{ code: string; label: string; terminal: boolean; blocksMove: boolean; aliases: string[] }>;
  categories: Array<{ code: string; label: string; interchangeable: boolean; exportSheet: string }>;
  locationTypes: Array<{ code: string; label: string; canBeDestination: boolean; exportColumnKey: string }>;
}

export interface ConfigSnapshot {
  id: string;
  sha256: string;
  bundle: OpsWorkbookSheets;
  valid: boolean;
  createdAt: string;
}

const REQUIRED_META_KEYS = ["schema_version", "org_name", "timezone", "date_locale", "language"];
const REQUIRED_LIMIT_KEYS = ["max_files_per_submission", "draft_quiet_seconds", "proposal_expiry_hours"];

/**
 * Ops Workbook Loader (LD-5, Appendix A)
 * Validates the non-developer Ops Workbook.
 * Rule: NO DEFAULTS IN CODE. A missing required key makes the config invalid.
 */
export class OpsWorkbookLoader {
  validateAndCreateSnapshot(sheets: OpsWorkbookSheets): ConfigSnapshot {
    // 1. Validate Meta sheet
    for (const key of REQUIRED_META_KEYS) {
      if (!sheets.meta[key]) {
        throw new Error(`Config Invalid (LD-5): Missing required Meta key '${key}'`);
      }
    }

    // 2. Validate Limits sheet
    for (const key of REQUIRED_LIMIT_KEYS) {
      if (sheets.limits[key] === undefined || sheets.limits[key] === null) {
        throw new Error(`Config Invalid (LD-5): Missing required Limit key '${key}'`);
      }
    }

    // 3. Validate Tiers: Tier 2 and Tier 3 must have allowSelfApproval = false (LD-6)
    for (const tier of sheets.tiers) {
      if ((tier.tier === 2 || tier.tier === 3) && tier.allowSelfApproval) {
        throw new Error(`Config Invalid (LD-6): Tier ${tier.tier} must forbid self-approval`);
      }
    }

    // 4. Validate Actors and Roles
    if (!sheets.actors || sheets.actors.length === 0) {
      throw new Error("Config Invalid: Actors list cannot be empty");
    }

    // 5. Serialize and compute SHA-256
    const serialized = JSON.stringify(sheets);
    const sha256 = crypto.createHash("sha256").update(serialized).digest("hex");

    return {
      id: `cfg-${sha256.slice(0, 16)}`,
      sha256,
      bundle: sheets,
      valid: true,
      createdAt: new Date().toISOString()
    };
  }
}
