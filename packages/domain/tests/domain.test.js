import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSerial,
  normalizeText,
  isShortNumeric,
  confusionWeightedDistance,
  matchLine,
  determineApprovalTier,
  validateDecision,
  transitionSubmission,
  transitionProposalVersion
} from "../dist/index.js";

test("normalizeSerial strips ignorable characters and converts to uppercase", () => {
  assert.equal(normalizeSerial("  cn-ovo48y  "), "CNOVO48Y");
  assert.equal(normalizeSerial("01.42.935"), "0142935");
  assert.equal(normalizeSerial("6CR5420/WK4"), "6CR5420WK4");
});

test("isShortNumeric detects purely numeric short strings", () => {
  assert.equal(isShortNumeric("8709"), true);
  assert.equal(isShortNumeric("734668"), true);
  assert.equal(isShortNumeric("SGH251SMWY"), false);
});

test("confusionWeightedDistance applies discount to OCR confusable pairs", () => {
  const pairs = [
    { a: "O", b: "0", cost: 0.3 },
    { a: "I", b: "1", cost: 0.3 }
  ];

  // Standard substitution cost without pairs would be 1.0
  const standardDist = confusionWeightedDistance("CNOVO", "CNAVO", []);
  assert.equal(standardDist, 1.0);

  // O to 0 with confusable pair should cost 0.3
  const confusableDist = confusionWeightedDistance("CNOVO", "CN0VO", pairs);
  assert.equal(Math.round(confusableDist * 10) / 10, 0.3);
});

test("matchLine handles exact match and flags description conflicts", () => {
  const assets = [
    {
      id: "asset-1",
      internalRef: "GOSL/SE/001",
      serials: ["CN-0V048Y-72872"],
      description: "DELL 24 Monitor",
      locationId: "loc-base",
      statusCode: "OPERATIONAL"
    }
  ];

  const config = {
    fuzzyMinLength: 8,
    fuzzyMaxDistance: 0.9,
    shortNumericExactOnly: true,
    ignorableChars: ["-", " "],
    separators: ["/"],
    partMinLength: 3,
    candidateMinScore: 0.7,
    maxCandidates: 5,
    descriptionSimilarityMin: 0.6,
    confusionPairs: [{ a: "O", b: "0", cost: 0.3 }],
    distinguishingTokens: [["HP", "DELL", "LG"]],
    nullSerialTokens: ["NA", "N/A", "NIL", "NONE", "NSN"]
  };

  // Exact match
  const resExact = matchLine("CN-0V048Y-72872", "DELL Monitor", assets, config);
  assert.equal(resExact.state, "exact");
  assert.equal(resExact.assetId, "asset-1");

  // Description conflict: Document says HP, DB says DELL
  const resConflict = matchLine("CN-0V048Y-72872", "HP Monitor", assets, config);
  assert.equal(resConflict.flags.includes("description_conflict"), true);
});

test("matchLine prevents fuzzy matching on short numerics", () => {
  const assets = [
    {
      id: "asset-gyro",
      internalRef: "GOSL/SE/042",
      serials: ["8709"],
      description: "Meridian Gyro",
      locationId: "loc-base",
      statusCode: "OPERATIONAL"
    }
  ];

  const config = {
    fuzzyMinLength: 8,
    fuzzyMaxDistance: 0.9,
    shortNumericExactOnly: true,
    ignorableChars: [],
    separators: [],
    partMinLength: 3,
    candidateMinScore: 0.7,
    maxCandidates: 5,
    descriptionSimilarityMin: 0.6,
    confusionPairs: []
  };

  // "8708" is distance 1 from "8709", but short numeric fuzzy is strictly disallowed
  const res = matchLine("8708", "Meridian Gyro", assets, config);
  assert.equal(res.state, "unknown");
  assert.equal(res.assetId, null);
});

test("determineApprovalTier derives correct tier based on priority rules", () => {
  const rules = [
    { priority: 1, name: "terminal", predicate: "status_to:terminal", tier: 3 },
    { priority: 5, name: "possible_match", predicate: "line_state:possible", tier: 2 },
    { priority: 6, name: "location_conflict", predicate: "flag:location_conflict", tier: 2 },
    { priority: 99, name: "default", predicate: "always", tier: 1 }
  ];

  // Normal movement
  const normalCtx = {
    submitterRole: "worker",
    submitterRef: "telegram:123",
    lineCount: 3,
    flags: [],
    lineStates: ["exact"],
    statusChanges: [],
    isTerminalStatus: false,
    isCreateAsset: false
  };
  assert.equal(determineApprovalTier(rules, normalCtx), 1);

  // Movement with possible match flag -> Tier 2
  const possibleCtx = {
    ...normalCtx,
    lineStates: ["exact", "possible"]
  };
  assert.equal(determineApprovalTier(rules, possibleCtx), 2);

  // Movement setting item to terminal status -> Tier 3
  const terminalCtx = {
    ...normalCtx,
    isTerminalStatus: true
  };
  assert.equal(determineApprovalTier(rules, terminalCtx), 3);
});

test("validateDecision forbids self-approval on Tier 2 & 3", () => {
  const tier2Config = {
    tier: 2,
    label: "Supervisor Approval",
    approverRoles: ["supervisor", "admin"],
    approvalsRequired: 1,
    minAssurance: "channel_verified",
    allowSelfApproval: false,
    expiryHours: 48
  };

  const selfCheck = validateDecision(tier2Config, "telegram:123", "telegram:123", []);
  assert.equal(selfCheck.allowed, false);
  assert.match(selfCheck.reason, /Self-approval is forbidden/);

  const validCheck = validateDecision(tier2Config, "telegram:456", "telegram:123", []);
  assert.equal(validCheck.allowed, true);
});

test("state machines enforce legal transitions and throw on illegal ones", () => {
  // Legal submission transitions
  assert.equal(transitionSubmission("DRAFT", "CLOSED"), "CLOSED");
  assert.equal(transitionSubmission("CLOSED", "PROCESSING"), "PROCESSING");
  assert.equal(transitionSubmission("PROCESSING", "PROPOSED"), "PROPOSED");

  // Illegal submission transition
  assert.throws(() => {
    transitionSubmission("DRAFT", "POSTED");
  }, /Illegal submission transition/);

  // Legal proposal transitions
  assert.equal(transitionProposalVersion("READY", "PENDING_APPROVAL"), "PENDING_APPROVAL");
  assert.equal(transitionProposalVersion("PENDING_APPROVAL", "APPROVED"), "APPROVED");

  // Illegal proposal transition
  assert.throws(() => {
    transitionProposalVersion("POSTED", "READY");
  }, /Illegal proposal version transition/);
});
