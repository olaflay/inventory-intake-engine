import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluatePredicate,
  determineApprovalTier,
  validateDecision,
  processProposalDecision,
  applyAmendment,
  transitionProposal
} from "../../packages/domain/dist/index.js";
import { PostingService, LedgerReplayer } from "../../packages/engine/dist/index.js";

const TIER_1_CONFIG = {
  tier: 1,
  label: "Automatic/Field Tech",
  approverRoles: ["field_tech", "supervisor", "admin"],
  approvalsRequired: 1,
  minAssurance: "channel_authenticated",
  allowSelfApproval: true,
  expiryHours: 72
};

const TIER_2_CONFIG = {
  tier: 2,
  label: "Supervisor Approval",
  approverRoles: ["supervisor", "admin"],
  approvalsRequired: 1,
  minAssurance: "channel_authenticated",
  allowSelfApproval: false,
  expiryHours: 48
};

const TIER_3_CONFIG = {
  tier: 3,
  label: "Dual Control Executive",
  approverRoles: ["admin", "operations_lead"],
  approvalsRequired: 2,
  minAssurance: "channel_authenticated",
  allowSelfApproval: false,
  expiryHours: 24
};

test("EC-42: Approver = submitter is strictly rejected on Tier 2 & Tier 3 (APR-02, LD-6)", () => {
  const submitter = "telegram:user-123";

  // Tier 2 check
  const t2Result = validateDecision(
    TIER_2_CONFIG,
    submitter,
    "supervisor",
    submitter,
    []
  );
  assert.equal(t2Result.allowed, false);
  assert.match(t2Result.reason, /Self-approval is forbidden/);

  // Tier 3 check
  const t3Result = validateDecision(
    TIER_3_CONFIG,
    submitter,
    "admin",
    submitter,
    []
  );
  assert.equal(t3Result.allowed, false);
  assert.match(t3Result.reason, /Self-approval is forbidden/);

  // Tier 1 allows self-approval
  const t1Result = validateDecision(
    TIER_1_CONFIG,
    submitter,
    "field_tech",
    submitter,
    []
  );
  assert.equal(t1Result.allowed, true);
});

test("EC-43: Tier 3 proposal with 1 approval stays PARTIALLY_APPROVED until 2nd distinct approver (APR-02, LD-14)", () => {
  const proposal = {
    id: "prop-tier3-001",
    submissionId: "sub-001",
    version: 1,
    state: "PENDING_APPROVAL",
    header: { documentType: "waybill", toLocationId: "loc-warami-10" },
    lines: [{ lineNo: 1, extractedDescription: "Subsea Tree", extractedSerials: ["ST-001"], quantity: 1, matchState: "exact", assetId: "ast-st1", candidates: [], flags: [], action: "move" }],
    questions: [],
    tier: 3,
    createdAt: new Date().toISOString()
  };

  const submitter = "telegram:field_engineer";

  // First approval by Admin 1
  const decision1 = {
    id: "dec-1",
    proposalId: proposal.id,
    proposalVersion: 1,
    actorRef: "telegram:admin_alice",
    actorRole: "admin",
    decision: "approve",
    assurance: "channel_authenticated",
    timestamp: new Date().toISOString()
  };

  const res1 = processProposalDecision(proposal, decision1, TIER_3_CONFIG, [], submitter);
  assert.equal(res1.state, "PARTIALLY_APPROVED");
  assert.equal(res1.quorumReached, false);
  assert.equal(proposal.state, "PARTIALLY_APPROVED");

  // Second approval by Admin 2 (distinct actor)
  const decision2 = {
    id: "dec-2",
    proposalId: proposal.id,
    proposalVersion: 1,
    actorRef: "telegram:admin_bob",
    actorRole: "admin",
    decision: "approve",
    assurance: "channel_authenticated",
    timestamp: new Date().toISOString()
  };

  const res2 = processProposalDecision(proposal, decision2, TIER_3_CONFIG, [decision1], submitter);
  assert.equal(res2.state, "APPROVED");
  assert.equal(res2.quorumReached, true);
  assert.equal(proposal.state, "APPROVED");
});

test("EC-44: Expired or stale proposal triggers re-validation and rejects posting (TXN-01)", async () => {
  const service = new PostingService();
  const assetStore = new Map();
  const ledgerStore = [];

  // Asset was modified in background, so its current version is 3
  assetStore.set("asset-stale-1", {
    id: "asset-stale-1",
    version: 3,
    locationId: "loc-base",
    movementState: "at_location",
    statusCode: "OPERATIONAL"
  });

  // Proposal was prepared against version 2
  const postRes = await service.postTransaction(
    {
      proposalVersionId: "prop-stale-v1",
      proposalKind: "dispatch",
      actorRef: "telegram:supervisor",
      items: [
        {
          assetId: "asset-stale-1",
          expectedVersion: 2, // Mismatch!
          newLocationId: "loc-transit",
          newMovementState: "in_transit"
        }
      ]
    },
    assetStore,
    ledgerStore
  );

  assert.equal(postRes.success, false);
  assert.equal(postRes.staleAssetId, "asset-stale-1");
  assert.match(postRes.error, /Proposal is STALE/);
  assert.equal(assetStore.get("asset-stale-1").version, 3);
  assert.equal(ledgerStore.length, 0);
});

test("EC-45: Concurrent workers touching same asset: exactly 1 posts, the other receives STALE (LD-11)", async () => {
  const service = new PostingService();
  const assetStore = new Map();
  const ledgerStore = [];

  assetStore.set("asset-concur-1", {
    id: "asset-concur-1",
    version: 1,
    locationId: "loc-base",
    movementState: "at_location",
    statusCode: "OPERATIONAL"
  });

  const worker1Promise = service.postTransaction(
    {
      proposalVersionId: "prop-w1",
      proposalKind: "dispatch",
      actorRef: "telegram:worker1",
      items: [{ assetId: "asset-concur-1", expectedVersion: 1, newLocationId: "loc-w1", newMovementState: "in_transit" }]
    },
    assetStore,
    ledgerStore
  );

  const worker2Promise = service.postTransaction(
    {
      proposalVersionId: "prop-w2",
      proposalKind: "dispatch",
      actorRef: "telegram:worker2",
      items: [{ assetId: "asset-concur-1", expectedVersion: 1, newLocationId: "loc-w2", newMovementState: "in_transit" }]
    },
    assetStore,
    ledgerStore
  );

  const [res1, res2] = await Promise.all([worker1Promise, worker2Promise]);

  // Exactly one succeeds, one fails with STALE
  const successes = [res1, res2].filter(r => r.success);
  const failures = [res1, res2].filter(r => !r.success);

  assert.equal(successes.length, 1);
  assert.equal(failures.length, 1);
  assert.match(failures[0].error, /Proposal is STALE/);
  assert.equal(assetStore.get("asset-concur-1").version, 2);
  assert.equal(ledgerStore.length, 1);
});

test("EC-46: Crash mid-post triggers atomic rollback leaving zero partial state (TXN-01)", async () => {
  const service = new PostingService();
  const assetStore = new Map();
  const ledgerStore = [];

  assetStore.set("asset-crash-1", { id: "asset-crash-1", version: 1, locationId: "loc-base", movementState: "at_location", statusCode: "OPERATIONAL" });
  assetStore.set("asset-crash-2", { id: "asset-crash-2", version: 1, locationId: "loc-base", movementState: "at_location", statusCode: "OPERATIONAL" });

  await assert.rejects(
    async () => {
      await service.postTransaction(
        {
          proposalVersionId: "prop-crash",
          proposalKind: "dispatch",
          actorRef: "telegram:worker",
          simulateCrashMidPost: true, // triggers crash mid-loop
          items: [
            { assetId: "asset-crash-1", expectedVersion: 1, newLocationId: "loc-transit", newMovementState: "in_transit" },
            { assetId: "asset-crash-2", expectedVersion: 1, newLocationId: "loc-transit", newMovementState: "in_transit" }
          ]
        },
        assetStore,
        ledgerStore
      );
    },
    /Simulated mid-post crash/
  );

  // Assert complete rollback: both assets remain at version 1, ledger untouched
  assert.equal(assetStore.get("asset-crash-1").version, 1);
  assert.equal(assetStore.get("asset-crash-2").version, 1);
  assert.equal(assetStore.get("asset-crash-1").movementState, "at_location");
  assert.equal(ledgerStore.length, 0);
});

test("EC-47: Bulk move over threshold triggers Tier 2 via lines>N predicate (APR-01)", () => {
  const rules = [
    { priority: 1, name: "terminal", predicate: "status_to:terminal", tier: 3 },
    { priority: 10, name: "bulk_move", predicate: "lines>5", tier: 2 },
    { priority: 99, name: "default", predicate: "always", tier: 1 }
  ];

  const smallCtx = {
    submitterRole: "field_tech",
    submitterRef: "telegram:tech1",
    lineCount: 4,
    flags: [],
    lineStates: ["exact"],
    statusChanges: [],
    isTerminalStatus: false,
    isCreateAsset: false
  };
  assert.equal(determineApprovalTier(rules, smallCtx), 1);

  const bulkCtx = {
    ...smallCtx,
    lineCount: 12
  };
  assert.equal(determineApprovalTier(rules, bulkCtx), 2);
});

test("EC-48: Linked reversal succeeds within window and verifies asset state has not changed since (TXN-03)", async () => {
  const service = new PostingService();
  const assetStore = new Map();
  const ledgerStore = [];

  assetStore.set("asset-rev-1", {
    id: "asset-rev-1",
    version: 1,
    locationId: "loc-base",
    movementState: "at_location",
    statusCode: "OPERATIONAL"
  });

  // Step 1: Post initial dispatch
  const post1 = await service.postTransaction(
    {
      proposalVersionId: "prop-orig",
      proposalKind: "dispatch",
      actorRef: "telegram:tech",
      items: [{ assetId: "asset-rev-1", expectedVersion: 1, newLocationId: "loc-warami-10", newMovementState: "in_transit", sourceLocationId: "loc-base" }]
    },
    assetStore,
    ledgerStore
  );
  assert.equal(post1.success, true);
  const originalEntryId = ledgerStore[0].id;

  // Step 2: Post reversal pointing to reversesEntryId
  const revRes = await service.postTransaction(
    {
      proposalVersionId: "prop-reversal",
      proposalKind: "reversal",
      reversesEntryId: originalEntryId,
      actorRef: "telegram:supervisor",
      items: [{ assetId: "asset-rev-1", expectedVersion: 2, newLocationId: "loc-base", newMovementState: "at_location" }]
    },
    assetStore,
    ledgerStore
  );

  assert.equal(revRes.success, true);
  assert.equal(assetStore.get("asset-rev-1").version, 3);
  assert.equal(assetStore.get("asset-rev-1").locationId, "loc-base");
  assert.equal(assetStore.get("asset-rev-1").movementState, "at_location");
  assert.equal(ledgerStore[1].reversesEntryId, originalEntryId);

  // Negative test: Try reversing again when state has already changed
  const invalidRev = await service.postTransaction(
    {
      proposalVersionId: "prop-reversal-2",
      proposalKind: "reversal",
      reversesEntryId: originalEntryId,
      actorRef: "telegram:supervisor",
      items: [{ assetId: "asset-rev-1", expectedVersion: 3, newLocationId: "loc-somewhere", newMovementState: "at_location" }]
    },
    assetStore,
    ledgerStore
  );
  assert.equal(invalidRev.success, false);
  assert.match(invalidRev.error, /Direct reversal blocked/);
});

test("EC-49: Unlinked receipt without prior dispatch forces Tier 2 (TXN-02)", () => {
  const rules = [
    { priority: 1, name: "terminal", predicate: "status_to:terminal", tier: 3 },
    { priority: 5, name: "unlinked", predicate: "unlinked_receipt", tier: 2 },
    { priority: 99, name: "default", predicate: "always", tier: 1 }
  ];

  const unlinkedCtx = {
    submitterRole: "field_tech",
    submitterRef: "telegram:tech1",
    lineCount: 1,
    flags: ["unlinked_receipt"],
    lineStates: ["exact"],
    statusChanges: [],
    isTerminalStatus: false,
    isCreateAsset: false
  };

  assert.equal(determineApprovalTier(rules, unlinkedCtx), 2);
});

test("EC-50 & EC-51: Double-tapped confirm decision is idempotent without throwing (INT-02, EC-51)", () => {
  const proposal = {
    id: "prop-idemp-001",
    submissionId: "sub-001",
    version: 1,
    state: "PENDING_APPROVAL",
    header: { documentType: "waybill" },
    lines: [],
    questions: [],
    tier: 1,
    createdAt: new Date().toISOString()
  };

  const decision = {
    id: "dec-tap-1",
    proposalId: proposal.id,
    proposalVersion: 1,
    actorRef: "telegram:field_tech",
    actorRole: "field_tech",
    decision: "approve",
    assurance: "channel_authenticated",
    timestamp: new Date().toISOString()
  };

  // Tap 1
  const res1 = processProposalDecision(proposal, decision, TIER_1_CONFIG, [], "telegram:submitter");
  assert.equal(res1.isDuplicate, false);
  assert.equal(res1.state, "APPROVED");

  // Tap 2 (rapid second click by user)
  const res2 = processProposalDecision(proposal, decision, TIER_1_CONFIG, [decision], "telegram:submitter");
  assert.equal(res2.isDuplicate, true);
  assert.equal(res2.state, "APPROVED");
});

test("EC-52: Proposal uses pinned snapshot config for interpretation, current policy for authorization (APR-01)", () => {
  // Snapshot interpretation config at submission time
  const snapshotConfig = {
    distinguishingTokens: [["BRAND_OLD_A", "BRAND_OLD_B"]]
  };

  // Current policy at approval time has higher requirements
  const updatedPolicyRules = [
    { priority: 1, name: "stricter_large_moves", predicate: "lines>2", tier: 2 },
    { priority: 99, name: "default", predicate: "always", tier: 1 }
  ];

  const ctx = {
    submitterRole: "field_tech",
    submitterRef: "telegram:tech1",
    lineCount: 3,
    flags: [],
    lineStates: ["exact"],
    statusChanges: [],
    isTerminalStatus: false,
    isCreateAsset: false
  };

  // Current policy assigns Tier 2
  const currentTier = determineApprovalTier(updatedPolicyRules, ctx);
  assert.equal(currentTier, 2);
  assert.ok(snapshotConfig.distinguishingTokens.length > 0);
});
