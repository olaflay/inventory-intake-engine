import test from "node:test";
import assert from "node:assert/strict";
import { OpsWorkbookLoader } from "../../packages/engine/dist/index.js";

const validWorkbook = {
  meta: {
    schema_version: "1.0.0",
    org_name: "Apex Drilling Equipment",
    timezone: "UTC",
    date_locale: "en-US",
    language: "en"
  },
  actors: [
    { actorRef: "telegram:ops_lead", displayName: "Alice Lead", role: "operations_lead", active: true },
    { actorRef: "telegram:field_tech", displayName: "Bob Tech", role: "field_technician", active: true }
  ],
  roles: [
    { role: "operations_lead", permission: "approve_tier_3" },
    { role: "field_technician", permission: "submit_draft" }
  ],
  tiers: [
    { tier: 1, label: "Auto / Submitter", approverRoles: ["field_technician"], approvalsRequired: 1, minAssurance: "low", allowSelfApproval: true, expiryHours: 24 },
    { tier: 2, label: "Peer Approval", approverRoles: ["field_technician"], approvalsRequired: 1, minAssurance: "medium", allowSelfApproval: false, expiryHours: 48 },
    { tier: 3, label: "Lead Dual Control", approverRoles: ["operations_lead"], approvalsRequired: 1, minAssurance: "high", allowSelfApproval: false, expiryHours: 72 }
  ],
  approvalRules: [
    { priority: 1, name: "decommission_rule", when: "status_to:DECOMMISSIONED", tier: 3 },
    { priority: 99, name: "routine_rule", when: "always", tier: 1 }
  ],
  limits: {
    max_files_per_submission: 10,
    draft_quiet_seconds: 30,
    proposal_expiry_hours: 48
  },
  statuses: [
    { code: "AVAILABLE", label: "Available in Yard", terminal: false, blocksMove: false, aliases: ["in_stock"] },
    { code: "DECOMMISSIONED", label: "Scrapped / Retired", terminal: true, blocksMove: true, aliases: ["retired"] }
  ],
  categories: [
    { code: "DRILL_BIT", label: "PDC Drill Bit", interchangeable: false, exportSheet: "DrillBits" }
  ],
  locationTypes: [
    { code: "YARD", label: "Base Yard", canBeDestination: true, exportColumnKey: "yard_loc" }
  ]
};

test("OpsWorkbookLoader: Generates valid snapshot with SHA-256 for valid configuration", () => {
  const loader = new OpsWorkbookLoader();
  const snapshot = loader.validateAndCreateSnapshot(validWorkbook);

  assert.equal(snapshot.valid, true);
  assert.ok(snapshot.sha256 && snapshot.sha256.length === 64);
  assert.ok(snapshot.id.startsWith("cfg-"));
  assert.equal(snapshot.bundle.meta.org_name, "Apex Drilling Equipment");
  assert.ok(snapshot.createdAt);
});

test("OpsWorkbookLoader: Rejects configuration when required Meta key is missing (LD-5)", () => {
  const loader = new OpsWorkbookLoader();
  const invalid = JSON.parse(JSON.stringify(validWorkbook));
  delete invalid.meta.schema_version;

  assert.throws(
    () => loader.validateAndCreateSnapshot(invalid),
    /Missing required Meta key 'schema_version'/
  );
});

test("OpsWorkbookLoader: Rejects configuration when required Limit key is missing (LD-5)", () => {
  const loader = new OpsWorkbookLoader();
  const invalid = JSON.parse(JSON.stringify(validWorkbook));
  delete invalid.limits.draft_quiet_seconds;

  assert.throws(
    () => loader.validateAndCreateSnapshot(invalid),
    /Missing required Limit key 'draft_quiet_seconds'/
  );
});

test("OpsWorkbookLoader: Rejects configuration violating LD-6 dual control self-approval rule", () => {
  const loader = new OpsWorkbookLoader();
  const invalid = JSON.parse(JSON.stringify(validWorkbook));
  invalid.tiers[1].allowSelfApproval = true; // Tier 2 allowSelfApproval = true is forbidden

  assert.throws(
    () => loader.validateAndCreateSnapshot(invalid),
    /Tier 2 must forbid self-approval/
  );
});

test("OpsWorkbookLoader: Rejects configuration with empty actors list", () => {
  const loader = new OpsWorkbookLoader();
  const invalid = JSON.parse(JSON.stringify(validWorkbook));
  invalid.actors = [];

  assert.throws(
    () => loader.validateAndCreateSnapshot(invalid),
    /Actors list cannot be empty/
  );
});
