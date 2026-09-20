import test from "node:test";
import assert from "node:assert/strict";
import {
  matchLine,
  determineApprovalTier
} from "../../packages/domain/dist/index.js";

test("Company-B Portability Test (LD-5): Verifies engine executes against alternative schema with zero domain literals", () => {
  // Company-B has completely different status vocabulary and location types
  const companyBInventory = [
    {
      id: "cb-asset-1",
      internalRef: "CO-B/EQ/999",
      serials: ["SN-RIG-100234"],
      description: "Drill Pressure Gauge",
      locationId: "loc-rig-alpha",
      statusCode: "IN_SERVICE"
    }
  ];

  // Company-B configuration: shorter min length (6), higher max distance (1.2), different separators
  const companyBMatchingConfig = {
    fuzzyMinLength: 6,
    fuzzyMaxDistance: 1.2,
    shortNumericExactOnly: true,
    ignorableChars: ["-", " "],
    separators: [";", "|"],
    partMinLength: 2,
    candidateMinScore: 0.65,
    maxCandidates: 3,
    descriptionSimilarityMin: 0.5,
    confusionPairs: [{ a: "Z", b: "2", cost: 0.25 }]
  };

  // Match test under Company-B
  const res = matchLine(
    "SN-RIG-100Z34", // Z instead of 2 -> distance 0.25 with Company-B pair
    "Pressure Gauge",
    companyBInventory,
    companyBMatchingConfig
  );

  assert.equal(res.state, "possible");
  assert.equal(res.assetId, "cb-asset-1");
  assert.equal(res.candidates[0].statusCode, "IN_SERVICE");

  // Company-B Approval Rules (custom priorities)
  const companyBRules = [
    { priority: 1, name: "custom_decommission", predicate: "status_to:DECOMMISSIONED", tier: 3 },
    { priority: 10, name: "large_move", predicate: "lines>5", tier: 2 },
    { priority: 99, name: "default", predicate: "always", tier: 1 }
  ];

  const ctxNormal = {
    submitterRole: "field_tech",
    submitterRef: "telegram:tech99",
    lineCount: 2,
    flags: [],
    lineStates: ["exact"],
    statusChanges: [],
    isTerminalStatus: false,
    isCreateAsset: false
  };

  assert.equal(determineApprovalTier(companyBRules, ctxNormal), 1);

  const ctxLarge = {
    ...ctxNormal,
    lineCount: 8
  };
  assert.equal(determineApprovalTier(companyBRules, ctxLarge), 2);
});
