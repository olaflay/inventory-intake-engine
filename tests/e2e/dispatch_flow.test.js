import test from "node:test";
import assert from "node:assert/strict";

import {
  matchLine,
  determineApprovalTier,
  validateDecision,
  transitionSubmission,
  transitionProposalVersion
} from "../../packages/domain/dist/index.js";

import {
  evaluateQuality
} from "../../packages/vision/dist/index.js";

import {
  PostingService,
  ExcelFormExporter
} from "../../packages/engine/dist/index.js";

import {
  renderIntent
} from "../../adapters/telegram/dist/index.js";

test("E2E Journey J1: Complete Dispatch Flow with Waybill and Manifest (Appendix D)", async () => {
  // =========================================================================
  // Step 1: Worker initiates draft submission via Telegram Adapter
  // =========================================================================
  const workerActor = { ref: "telegram:field_worker_42", role: "worker" };
  const supervisorActor = { ref: "telegram:supervisor_99", role: "supervisor" };

  let submissionState = "DRAFT";
  const submission = {
    id: "sub-j1-1001",
    actorRef: workerActor.ref,
    caption: "going to Onne today",
    documents: []
  };

  assert.equal(submissionState, "DRAFT");

  // =========================================================================
  // Step 2: Intake 2 documents & evaluate Pre-AI Quality Gate (PRD §9.2, DOC-02)
  // =========================================================================
  // Doc 1: Photographed Waybill No. 001434
  const waybillQuality = evaluateQuality(1920, 1080, 240.0);
  assert.equal(waybillQuality.passed, true);
  assert.equal(waybillQuality.reasons.length, 0);

  // Doc 2: Photographed Warami 10 Loadout List (Manifest)
  const manifestQuality = evaluateQuality(2048, 1536, 185.0);
  assert.equal(manifestQuality.passed, true);

  submission.documents.push(
    { id: "doc-waybill-1", kind: "waybill", quality: waybillQuality },
    { id: "doc-manifest-1", kind: "loadout_list", quality: manifestQuality }
  );
  assert.equal(submission.documents.length, 2);

  // Worker sends /done or quiet seconds expire -> submission closes & begins processing
  submissionState = transitionSubmission(submissionState, "CLOSED");
  submissionState = transitionSubmission(submissionState, "PROCESSING");
  assert.equal(submissionState, "PROCESSING");

  // =========================================================================
  // Step 3: Multimodal Vision Extraction Output (Gemini 2.0 Flash schemas)
  // =========================================================================
  const extractedWaybill = {
    header: {
      documentType: "waybill",
      documentNo: "001434",
      date: "10/06/2026",
      fromLocation: "GOSL Base",
      toLocation: "FOT Jetty, Onne",
      dispatcherName: "Worker 42"
    },
    lines: [
      { lineNo: 1, itemDescription: "20 ft container containing survey equipment as attached", quantity: 1, serials: [], unread: false }
    ]
  };

  const extractedManifest = {
    header: {
      documentType: "loadout_list",
      clientName: "SEPNU",
      vesselName: "Warami 10",
      location: "FOT Jetty, Onne",
      date: "10/06/2026"
    },
    lines: [
      { lineNo: 1, itemDescription: "HP Monitor", quantity: 1, serials: ["CNC42316R1"], unread: false },
      { lineNo: 2, itemDescription: "HP Monitor", quantity: 1, serials: ["CNC42316R2"], unread: false },
      { lineNo: 3, itemDescription: "HP Monitor", quantity: 1, serials: ["CNC42316R3"], unread: false },
      { lineNo: 4, itemDescription: "HP Monitor", quantity: 1, serials: ["CNC42316RB"], unread: false },
      { lineNo: 5, itemDescription: "HP Monitor", quantity: 1, serials: ["CN-OVO48Y-72872"], unread: false }, // Confusable O/0 + Dell on file
      { lineNo: 6, itemDescription: "HP Monitor", quantity: 1, serials: ["854133-001"], unread: false }, // Unknown
      { lineNo: 7, itemDescription: "LG Monitor", quantity: 1, serials: ["60INTHMD8889"], unread: false }, // Unknown
      { lineNo: 8, itemDescription: "Tank System", quantity: 1, serials: ["SA19502429"], unread: false }, // Unknown
      { lineNo: 9, itemDescription: "Meridian Gyro", quantity: 1, serials: ["8709"], unread: false },
      { lineNo: 10, itemDescription: "HP CPU", quantity: 1, serials: ["SGH251SMWY"], unread: false }, // Unknown
      { lineNo: 11, itemDescription: "UPS", quantity: 1, serials: [], unread: false }, // No serial
      { lineNo: 12, itemDescription: "HP CPU", quantity: 1, serials: ["6CR5420WK4"], unread: false },
      { lineNo: 13, itemDescription: "TMS Dongle", quantity: 1, serials: ["01.42.935"], unread: false },
      { lineNo: 14, itemDescription: "IEA440 Echosounder", quantity: 1, serials: ["734668"], unread: false },
      { lineNo: 15, itemDescription: "G-882 Magnetometer", quantity: 1, serials: ["883214"], unread: false },
      { lineNo: 16, itemDescription: "Fire Extinguisher", quantity: 1, serials: [], unread: false }, // No serial
      { lineNo: 17, itemDescription: "Valeport Midas CTD", quantity: 1, serials: ["24027"], unread: false }
    ]
  };

  // =========================================================================
  // Step 4: Clarification Loop (Destination Intent Resolution, PRD §9.1, INT-03)
  // =========================================================================
  submissionState = transitionSubmission(submissionState, "NEEDS_INPUT");
  assert.equal(submissionState, "NEEDS_INPUT");

  const destinationIntent = {
    intentId: "int-dest-j1",
    type: "needs_input",
    messageKey: "ask_destination",
    fallbackText: "I found a waybill to FOT Jetty, Onne and a loadout list for vessel Warami 10 with 17 lines.\nWhere should these items be recorded?",
    actions: [
      { id: "1", label: "Warami 10 (vessel), via FOT Jetty, Onne" },
      { id: "2", label: "FOT Jetty, Onne" },
      { id: "3", label: "Cancel" }
    ],
    audience: [workerActor.ref]
  };

  // Adapter renders buttons + numbered text fallbacks for accessibility
  const renderedMessage = renderIntent(destinationIntent);
  assert.match(renderedMessage.text, /Where should these items be recorded\?/);
  assert.match(renderedMessage.text, /1\. Warami 10 \(vessel\), via FOT Jetty, Onne/);
  assert.match(renderedMessage.text, /\(Tap a button or reply with a number\)/);

  // Worker answers "1"
  const workerAnswer = "1";
  assert.equal(workerAnswer, "1");

  submissionState = transitionSubmission(submissionState, "PROCESSING");
  assert.equal(submissionState, "PROCESSING");

  // =========================================================================
  // Step 5: Deterministic Matching against Baseline Inventory (PRD §18)
  // =========================================================================
  const canonicalInventory = [
    { id: "a-hp1", internalRef: "GOSL/SE/101", serials: ["CNC42316R1"], description: "HP Monitor", locationId: "loc-base", statusCode: "OPERATIONAL" },
    { id: "a-hp2", internalRef: "GOSL/SE/102", serials: ["CNC42316R2"], description: "HP Monitor", locationId: "loc-base", statusCode: "OPERATIONAL" },
    { id: "a-hp3", internalRef: "GOSL/SE/103", serials: ["CNC42316R3"], description: "HP Monitor", locationId: "loc-base", statusCode: "OPERATIONAL" },
    { id: "a-hp4", internalRef: "GOSL/SE/104", serials: ["CNC42316RB"], description: "HP Monitor", locationId: "loc-base", statusCode: "OPERATIONAL" },
    { id: "a-dell", internalRef: "GOSL/SE/105", serials: ["CN-0V048Y-72872"], description: "DELL Monitor", locationId: "loc-base", statusCode: "OPERATIONAL" },
    { id: "a-gyro", internalRef: "GOSL/SE/042", serials: ["8709"], description: "Meridian Gyro", locationId: "loc-eg-project", statusCode: "OPERATIONAL" },
    { id: "a-cpu", internalRef: "GOSL/SE/088", serials: ["6CR5420WK4"], description: "HP CPU", locationId: "loc-base", statusCode: "OPERATIONAL" },
    { id: "a-tms", internalRef: "GOSL/SE/106", serials: ["01.42.935"], description: "Survey Dongle", locationId: "loc-base", statusCode: "OPERATIONAL" },
    { id: "a-echo", internalRef: "GOSL/SE/015", serials: ["734668"], description: "IEA440 Echosounder", locationId: "loc-warami-10", statusCode: "OPERATIONAL" },
    { id: "a-mag", internalRef: "GOSL/SE/020", serials: ["883214"], description: "G-882 Magnetometer", locationId: "loc-warami-10", statusCode: "OPERATIONAL" },
    { id: "a-ctd", internalRef: "GOSL/SE/033", serials: ["24027"], description: "Valeport Midas CTD", locationId: null, statusCode: "OPERATIONAL" }
  ];

  const matchingConfig = {
    fuzzyMinLength: 8,
    fuzzyMaxDistance: 0.9,
    shortNumericExactOnly: true,
    ignorableChars: ["-", " ", "."],
    separators: ["/"],
    partMinLength: 3,
    candidateMinScore: 0.7,
    maxCandidates: 5,
    descriptionSimilarityMin: 0.6,
    confusionPairs: [{ a: "O", b: "0", cost: 0.3 }]
  };

  const destinationLocationId = "loc-warami-10";

  const matchResults = extractedManifest.lines.map(line =>
    matchLine(line.serials[0] || "", line.itemDescription, canonicalInventory, matchingConfig, destinationLocationId)
  );

  // Line 5: Possible match + description conflict (HP vs DELL)
  const line5Match = matchResults[4];
  assert.equal(line5Match.state, "possible");
  assert.equal(line5Match.flags.includes("description_conflict"), true);

  // Lines 14 & 15: Already at destination
  assert.equal(matchResults[13].flags.includes("already_at_destination"), true);
  assert.equal(matchResults[14].flags.includes("already_at_destination"), true);

  // =========================================================================
  // Step 6: Policy Engine & Tier Derivation (PRD §9.6, APR-01)
  // =========================================================================
  const approvalRules = [
    { priority: 1, name: "terminal_status", predicate: "status_to:terminal", tier: 3 },
    { priority: 5, name: "possible_match", predicate: "line_state:possible", tier: 2 },
    { priority: 6, name: "description_conflict", predicate: "flag:description_conflict", tier: 2 },
    { priority: 99, name: "default", predicate: "always", tier: 1 }
  ];

  const transactionContext = {
    submitterRole: workerActor.role,
    submitterRef: workerActor.ref,
    lineCount: 17,
    flags: matchResults.flatMap(r => r.flags),
    lineStates: matchResults.map(r => r.state),
    statusChanges: [],
    isTerminalStatus: false,
    isCreateAsset: false
  };

  const derivedTier = determineApprovalTier(approvalRules, transactionContext);
  assert.equal(derivedTier, 2, "Transaction requires Tier 2 approval");

  submissionState = transitionSubmission(submissionState, "PROPOSED");
  submissionState = transitionSubmission(submissionState, "AWAITING_APPROVAL");
  assert.equal(submissionState, "AWAITING_APPROVAL");

  let proposalState = "READY";
  proposalState = transitionProposalVersion(proposalState, "PENDING_APPROVAL");
  assert.equal(proposalState, "PENDING_APPROVAL");

  // =========================================================================
  // Step 7: Dual Control & Approval Verification (PRD §22, LD-6)
  // =========================================================================
  const tier2Policy = {
    tier: 2,
    label: "Supervisor Approval",
    approverRoles: ["supervisor", "admin"],
    approvalsRequired: 1,
    minAssurance: "channel_verified",
    allowSelfApproval: false,
    expiryHours: 48
  };

  // Rule 1: Field worker cannot self-approve Tier 2
  const workerSelfApproval = validateDecision(tier2Policy, workerActor.ref, workerActor.ref, []);
  assert.equal(workerSelfApproval.allowed, false);
  assert.match(workerSelfApproval.reason, /Self-approval is forbidden/);

  // Rule 2: Supervisor approves successfully
  const supervisorApproval = validateDecision(tier2Policy, supervisorActor.ref, workerActor.ref, []);
  assert.equal(supervisorApproval.allowed, true);

  proposalState = transitionProposalVersion(proposalState, "APPROVED");
  submissionState = transitionSubmission(submissionState, "APPROVED");
  assert.equal(proposalState, "APPROVED");

  // =========================================================================
  // Step 8: Atomic Posting via LD-11 Optimistic Versioning (PRD §29)
  // =========================================================================
  submissionState = transitionSubmission(submissionState, "POSTING");
  const postingService = new PostingService();

  const assetStore = new Map();
  for (const item of canonicalInventory) {
    assetStore.set(item.id, {
      id: item.id,
      version: 1,
      locationId: item.locationId,
      movementState: "at_location",
      statusCode: item.statusCode
    });
  }

  const ledgerStore = [];

  // Post the confirmed dispatch items (the 7 matched items)
  const itemsToDispatch = [
    { assetId: "a-hp1", expectedVersion: 1, newLocationId: destinationLocationId, newMovementState: "in_transit" },
    { assetId: "a-hp2", expectedVersion: 1, newLocationId: destinationLocationId, newMovementState: "in_transit" },
    { assetId: "a-hp3", expectedVersion: 1, newLocationId: destinationLocationId, newMovementState: "in_transit" },
    { assetId: "a-hp4", expectedVersion: 1, newLocationId: destinationLocationId, newMovementState: "in_transit" },
    { assetId: "a-gyro", expectedVersion: 1, newLocationId: destinationLocationId, newMovementState: "in_transit" },
    { assetId: "a-cpu", expectedVersion: 1, newLocationId: destinationLocationId, newMovementState: "in_transit" },
    { assetId: "a-tms", expectedVersion: 1, newLocationId: destinationLocationId, newMovementState: "in_transit" }
  ];

  const postResult = await postingService.postTransaction(
    {
      proposalVersionId: "prop-v1-j1",
      proposalKind: "dispatch",
      actorRef: supervisorActor.ref,
      items: itemsToDispatch
    },
    assetStore,
    ledgerStore
  );

  assert.equal(postResult.success, true);
  assert.match(postResult.transactionId, /^txn-/);

  // Verify all touched assets transitioned to in_transit with incremented versions
  for (const item of itemsToDispatch) {
    const updated = assetStore.get(item.assetId);
    assert.equal(updated.version, 2);
    assert.equal(updated.movementState, "in_transit");
  }

  // Verify untouched assets remain version 1
  assert.equal(assetStore.get("a-ctd").version, 1);
  assert.equal(ledgerStore.length, 7);

  proposalState = transitionProposalVersion(proposalState, "POSTED");
  submissionState = transitionSubmission(submissionState, "POSTED");
  assert.equal(proposalState, "POSTED");
  assert.equal(submissionState, "POSTED");

  // =========================================================================
  // Step 9: Dated Excel Form Projection Generation (LD-3, PRD §20.3)
  // =========================================================================
  const exporter = new ExcelFormExporter();
  const exportSheets = [
    {
      categoryCode: "SURVEY",
      sheetName: "SURVEY EQUIPMENT",
      rows: [
        { internalRef: "GOSL/SE/101", description: "HP Monitor", categoryCode: "SURVEY", statusCode: "OPERATIONAL", locationName: "Warami 10 (In Transit)", serialNumbers: ["CNC42316R1"] },
        { internalRef: "GOSL/SE/042", description: "Meridian Gyro", categoryCode: "SURVEY", statusCode: "OPERATIONAL", locationName: "Warami 10 (In Transit)", serialNumbers: ["8709"] }
      ]
    },
    {
      categoryCode: "IT",
      sheetName: "IT EQUIPMENT",
      rows: [
        { internalRef: "GOSL/SE/088", description: "HP CPU", categoryCode: "IT", statusCode: "OPERATIONAL", locationName: "Warami 10 (In Transit)", serialNumbers: ["6CR5420WK4"] }
      ]
    }
  ];

  const exportResult = exporter.generateProjection("GOSL", exportSheets);
  assert.equal(exportResult.selfCheckPassed, true);
  assert.equal(exportResult.totalItems, 3);
  assert.match(exportResult.filename, /^GOSL_INVENTORY_\d{4}_\d{2}_\d{2}\.xlsx$/);
});
