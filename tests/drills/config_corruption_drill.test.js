import test from "node:test";
import assert from "node:assert/strict";
import { ConfigManager, EventHub } from "../../packages/engine/dist/index.js";

const VALID_OPS_CONFIG = {
  meta: {
    schema_version: "1.0",
    org_name: "Test Corp",
    timezone: "Africa/Lagos",
    date_locale: "DD/MM/YYYY",
    language: "en"
  },
  limits: {
    max_files_per_submission: 10,
    draft_quiet_seconds: 90,
    proposal_expiry_hours: 48
  },
  tiers: [
    {
      tier: 1,
      label: "Worker Dispatch",
      approverRoles: ["Worker", "Supervisor"],
      approvalsRequired: 1,
      minAssurance: "channel",
      allowSelfApproval: true,
      expiryHours: 24
    },
    {
      tier: 2,
      label: "Supervisor Approval",
      approverRoles: ["Supervisor"],
      approvalsRequired: 1,
      minAssurance: "channel",
      allowSelfApproval: false,
      expiryHours: 48
    },
    {
      tier: 3,
      label: "Dual Control Admin",
      approverRoles: ["Admin"],
      approvalsRequired: 2,
      minAssurance: "channel",
      allowSelfApproval: false,
      expiryHours: 72
    }
  ],
  actors: [
    { actorRef: "telegram:12345", displayName: "Alice Worker", role: "Worker", active: true },
    { actorRef: "telegram:67890", displayName: "Bob Admin", role: "Admin", active: true }
  ],
  roles: [
    { role: "Worker", permission: "submit" },
    { role: "Admin", permission: "approve:tier:3" }
  ],
  approvalRules: [
    { priority: 1, name: "terminal", when: "status_to:terminal", tier: 3 },
    { priority: 99, name: "default", when: "always", tier: 1 }
  ],
  statuses: [
    { code: "AVAILABLE", label: "Available", terminal: false, blocksMove: false, aliases: ["GOOD"] },
    { code: "SCRAPPED", label: "Scrapped", terminal: true, blocksMove: true, aliases: [] }
  ],
  categories: [
    { code: "SURVEY", label: "Survey Equipment", interchangeable: false, exportSheet: "SURVEY EQUIPMENT" }
  ],
  locationTypes: [
    { code: "store", label: "Base Store", canBeDestination: true, exportColumnKey: "store" }
  ]
};

test("Chaos Drill: Config corruption keeps last-good snapshot and emits config.invalid (PRD §45, §49.9, EC-53)", () => {
  const eventHub = new EventHub();
  const manager = new ConfigManager(eventHub);

  // 1. Initial valid config load
  const initialSnapshot = manager.loadInitialConfig(VALID_OPS_CONFIG);
  assert.ok(initialSnapshot.valid);
  assert.equal(manager.getActiveSnapshot()?.sha256, initialSnapshot.sha256);

  // 2. Corrupt config attempt A: Missing required meta key
  const corruptConfigA = {
    ...VALID_OPS_CONFIG,
    meta: {
      ...VALID_OPS_CONFIG.meta,
      org_name: "" // missing required key
    }
  };

  const resultA = manager.reloadConfig(corruptConfigA);
  assert.equal(resultA.success, false);
  assert.match(resultA.error, /Missing required Meta key 'org_name'/);
  // Last good snapshot strictly preserved
  assert.equal(manager.getActiveSnapshot()?.sha256, initialSnapshot.sha256);

  // 3. Corrupt config attempt B: Tier 2 allowing self-approval (LD-6 violation)
  const corruptConfigB = {
    ...VALID_OPS_CONFIG,
    tiers: VALID_OPS_CONFIG.tiers.map(t => (t.tier === 2 ? { ...t, allowSelfApproval: true } : t))
  };

  const resultB = manager.reloadConfig(corruptConfigB);
  assert.equal(resultB.success, false);
  assert.match(resultB.error, /Tier 2 must forbid self-approval/);
  assert.equal(manager.getActiveSnapshot()?.sha256, initialSnapshot.sha256);

  // 4. Verify config.invalid events emitted
  const events = eventHub.getAllEvents();
  const invalidEvents = events.filter(e => e.type === "config.invalid");
  assert.equal(invalidEvents.length, 2);
  assert.equal(invalidEvents[0].payload.lastGoodSnapshotId, initialSnapshot.id);
  assert.match(invalidEvents[0].payload.reason, /org_name/);
  assert.match(invalidEvents[1].payload.reason, /self-approval/);

  // 5. Subsequent valid update succeeds
  const updatedValidConfig = {
    ...VALID_OPS_CONFIG,
    meta: {
      ...VALID_OPS_CONFIG.meta,
      org_name: "Updated Corp"
    }
  };

  const resultC = manager.reloadConfig(updatedValidConfig);
  assert.equal(resultC.success, true);
  assert.notEqual(resultC.snapshot.sha256, initialSnapshot.sha256);
  assert.equal(manager.getActiveSnapshot()?.bundle.meta.org_name, "Updated Corp");

  const reloadedEvent = eventHub.getAllEvents().find(e => e.type === "config.reloaded");
  assert.ok(reloadedEvent);
  assert.equal(reloadedEvent.payload.orgName, "Updated Corp");
});
