import test from "node:test";
import assert from "node:assert/strict";
import {
  IntentResolver,
  runValidationPipeline,
  ManifestReconciler
} from "../../packages/domain/dist/index.js";
import {
  LocationService,
  ProposalService
} from "../../packages/engine/dist/index.js";

test("IntentResolver (FR-PRO-01): maps waybill + manifest to dispatch without questions", () => {
  const res = IntentResolver.resolveIntent({
    documentTypes: ["waybill", "loadout_list"]
  });
  assert.strictEqual(res.kind, "dispatch");
  assert.strictEqual(res.requiresQuestion, false);
});

test("IntentResolver (FR-PRO-01, FR-PRO-06, EC-22): waybill only maps to dispatch_unitemized", () => {
  const res = IntentResolver.resolveIntent({
    documentTypes: ["waybill"]
  });
  assert.strictEqual(res.kind, "dispatch_unitemized");
  assert.strictEqual(res.requiresQuestion, false);
});

test("IntentResolver (FR-PRO-01, EC-23): manifest only maps to assertion with intent question", () => {
  const res = IntentResolver.resolveIntent({
    documentTypes: ["loadout_list"]
  });
  assert.strictEqual(res.kind, "assertion");
  assert.strictEqual(res.requiresQuestion, true);
  assert.strictEqual(res.question?.questionKey, "manifest_intent");
});

test("IntentResolver (FR-PRO-01): receipt signals map to receive proposal", () => {
  const res = IntentResolver.resolveIntent({
    documentTypes: ["waybill"],
    receiverFieldsPresent: true
  });
  assert.strictEqual(res.kind, "receive");
});

test("IntentResolver (FR-PRO-02): resolves destination precedence between waybill and manifest", () => {
  // Case 1: manifest location matches waybill To -> vessel takes precedence
  const r1 = IntentResolver.resolveDestination({
    waybillTo: "FOT Jetty",
    manifestLocation: "FOT Jetty",
    manifestVessel: "Warami 10"
  });
  assert.strictEqual(r1.resolvedDestination, "Warami 10");
  assert.strictEqual(r1.transitContext, "FOT Jetty");
  assert.strictEqual(r1.requiresQuestion, false);

  // Case 2: waybill To and manifest vessel conflict -> asks clarifying question
  const r2 = IntentResolver.resolveDestination({
    waybillTo: "Shore Base",
    manifestVessel: "Vessel Alpha"
  });
  assert.strictEqual(r2.requiresQuestion, true);
  assert.strictEqual(r2.question?.questionKey, "destination_choice");
});

test("ValidationPipeline (FR-VAL-01): verifies checks in fixed execution order", () => {
  const mockAsset = {
    id: "asset-1",
    description: "Centrifugal Pump",
    locationId: "loc-yard",
    statusCode: "OPERATIONAL"
  };

  // Normal valid move
  const v1 = runValidationPipeline(
    {
      lineNo: 1,
      extractedDescription: "Centrifugal Pump",
      extractedSerials: ["SN-8821"],
      quantity: 1,
      unread: false,
      matchedAsset: mockAsset,
      matchState: "exact"
    },
    {
      sourceLocationId: "loc-yard",
      destinationLocationId: "loc-site"
    }
  );
  assert.strictEqual(v1.canAutoPost, true);
  assert.strictEqual(v1.flags.length, 0);

  // Location conflict (asset recorded at yard, but submission asserts moving from base)
  const v2 = runValidationPipeline(
    {
      lineNo: 2,
      extractedDescription: "Centrifugal Pump",
      extractedSerials: ["SN-8821"],
      quantity: 1,
      unread: false,
      matchedAsset: mockAsset,
      matchState: "exact"
    },
    {
      sourceLocationId: "loc-base", // Mismatch with loc-yard!
      destinationLocationId: "loc-site"
    }
  );
  assert.ok(v2.flags.includes("location_conflict"));
  assert.strictEqual(v2.canAutoPost, false);
});

test("ValidationPipeline (EC-29): terminal asset status blocks move", () => {
  const scrappedAsset = {
    id: "asset-scrap",
    description: "Old Generator",
    locationId: "loc-yard",
    statusCode: "SCRAPPED"
  };

  const res = runValidationPipeline(
    {
      lineNo: 1,
      extractedDescription: "Old Generator",
      extractedSerials: ["GEN-001"],
      quantity: 1,
      unread: false,
      matchedAsset: scrappedAsset,
      matchState: "exact"
    },
    {
      sourceLocationId: "loc-yard",
      destinationLocationId: "loc-site"
    }
  );

  assert.strictEqual(res.isTerminal, true);
  assert.ok(res.flags.includes("terminal_status"));
  assert.strictEqual(res.canAutoPost, false);
});

test("ValidationPipeline (EC-39): remark constraint flag detected", () => {
  const res = runValidationPipeline(
    {
      lineNo: 1,
      extractedDescription: "Pressure Gauge",
      extractedSerials: ["PG-101"],
      quantity: 1,
      unread: false,
      remarks: "DO NOT MOVE - Reserved for Project Warami",
      matchState: "exact"
    }
  );

  assert.ok(res.flags.includes("remark_constraint"));
});

test("ValidationPipeline (EC-41): unrecorded stored location skips mismatch check", () => {
  const unrecordedAsset = {
    id: "asset-unrec",
    description: "Unrecorded Tool",
    locationId: "loc-unrecorded",
    statusCode: "OPERATIONAL"
  };

  const res = runValidationPipeline(
    {
      lineNo: 1,
      extractedDescription: "Unrecorded Tool",
      extractedSerials: ["TOOL-99"],
      quantity: 1,
      unread: false,
      matchedAsset: unrecordedAsset,
      matchState: "exact"
    },
    {
      sourceLocationId: "loc-base",
      destinationLocationId: "loc-site",
      config: { unrecordedLocationId: "loc-unrecorded" }
    }
  );

  assert.strictEqual(res.flags.includes("location_conflict"), false, "Unrecorded location must skip mismatch check");
});

test("ManifestReconciler (FR-PRO-04, EC-40): categorizes manifest lines and detects missing_from_list", () => {
  const allLocationAssets = [
    { id: "a1", description: "Monitor 1", serials: ["SN1"], locationId: "loc-warami", statusCode: "OPERATIONAL" },
    { id: "a2", description: "Monitor 2", serials: ["SN2"], locationId: "loc-base", statusCode: "OPERATIONAL" },
    { id: "a3", description: "Cable Drum", serials: ["SN3"], locationId: "loc-warami", statusCode: "OPERATIONAL" } // Not in manifest!
  ];

  const manifestLines = [
    // Line 1: Matches asset a1 at loc-warami => verify
    {
      lineNo: 1,
      matchResult: { state: "exact", assetId: "a1", candidates: [], flags: [] },
      matchedAsset: allLocationAssets[0]
    },
    // Line 2: Matches asset at base store => conflicting location
    {
      lineNo: 2,
      matchResult: { state: "exact", assetId: "a-other", candidates: [], flags: [] },
      matchedAsset: { id: "a-other", description: "Radio", serials: ["RAD1"], locationId: "loc-base", statusCode: "OPERATIONAL" }
    },
    // Line 3: Unknown asset
    {
      lineNo: 3,
      matchResult: { state: "unknown", assetId: null, candidates: [], flags: [] },
      matchedAsset: null
    }
  ];

  const recon = ManifestReconciler.reconcile(manifestLines, "loc-warami", allLocationAssets);

  assert.strictEqual(recon.verifiedLines.length, 1);
  assert.strictEqual(recon.verifiedLines[0].lineNo, 1);
  assert.strictEqual(recon.conflictingLines.length, 1);
  assert.strictEqual(recon.conflictingLines[0].lineNo, 2);
  assert.strictEqual(recon.unknownLines.length, 1);
  assert.strictEqual(recon.unknownLines[0].lineNo, 3);

  // EC-40: Cable Drum (a3) is at loc-warami but missing from manifest
  assert.strictEqual(recon.missingFromList.length, 1);
  assert.strictEqual(recon.missingFromList[0].assetId, "a3");
  assert.strictEqual(recon.missingFromList[0].description, "Cable Drum");
});

test("ProposalService (FR-PRO-03): assembles complete proposal with surplus placeholders (EC-36) and provisional location (EC-33)", () => {
  const locService = new LocationService([
    { id: "loc-base", name: "Base Store", type: "store", aliases: ["main base"], isDestination: false },
    { id: "loc-warami", name: "Warami 10", type: "vessel", aliases: ["w10"], isDestination: true }
  ]);

  const mockAssets = [
    { id: "a-gen", internalRef: "GEN-01", serials: ["SN-GEN-100"], description: "50kVA Generator", locationId: "loc-base", statusCode: "OPERATIONAL" }
  ];

  const matchingConfig = {
    fuzzyMinLength: 8,
    fuzzyMaxDistance: 0.9,
    shortNumericExactOnly: true,
    ignorableChars: ["-", " "],
    separators: ["/"],
    partMinLength: 3,
    candidateMinScore: 0.7,
    maxCandidates: 5,
    descriptionSimilarityMin: 0.6,
    confusionPairs: [{ a: "O", b: "0", cost: 0.3 }]
  };

  const approvalRules = [
    { priority: 1, name: "terminal", predicate: "status_to:terminal", tier: 3 },
    { priority: 5, name: "possible", predicate: "line_state:possible", tier: 2 },
    { priority: 6, name: "conflict", predicate: "flag:location_conflict", tier: 2 },
    { priority: 99, name: "default", predicate: "always", tier: 1 }
  ];

  // Submission with:
  // - Line 1: Generator (exact match)
  // - Line 2: Air Conditioner (Qty 3 with 1 serial -> 1 line + 2 placeholders per EC-36)
  const documents = [
    {
      documentType: "waybill",
      documentNo: "WB-991",
      fromLocation: "Base Store",
      toLocation: "Unknown Pier 9", // EC-33: unrecorded location
      lines: []
    },
    {
      documentType: "loadout_list",
      documentNo: "MAN-991",
      lines: [
        {
          lineNo: 1,
          description: "50kVA Generator",
          serials: ["SN-GEN-100"],
          quantity: 1
        },
        {
          lineNo: 2,
          description: "Portable Air Conditioner",
          serials: ["AC-01"],
          quantity: 3 // Qty 3 with 1 serial
        }
      ]
    }
  ];

  const proposal = ProposalService.assembleProposal({
    submissionId: "sub-123",
    actorRole: "dispatcher",
    actorRef: "telegram:user42",
    documents,
    assets: mockAssets,
    locationService: locService,
    matchingConfig,
    approvalRules
  });

  assert.strictEqual(proposal.version, 1);
  assert.strictEqual(proposal.header.kind, "dispatch");
  assert.strictEqual(proposal.header.sourceLocationId, "loc-base");

  // Check lines: 1 generator + 1 AC unit + 2 AC placeholders = 4 lines total
  assert.strictEqual(proposal.lines.length, 4);
  assert.strictEqual(proposal.lines[0].matchState, "exact");
  assert.strictEqual(proposal.lines[0].assetId, "a-gen");

  // Check placeholders (EC-36)
  const placeholders = proposal.lines.filter(l => l.isPlaceholder);
  assert.strictEqual(placeholders.length, 2);
  assert.ok(placeholders[0].flags.includes("unidentified_placeholder"));

  // Questions generated:
  // 1. Provisional location question for 'Unknown Pier 9' (EC-33)
  // 2. Surplus placeholder question for Line 2 (EC-36)
  assert.strictEqual(proposal.questions.length, 2);
  const qLoc = proposal.questions.find(q => q.questionKey === "provisional_location");
  assert.ok(qLoc);
  const qSurplus = proposal.questions.find(q => q.questionKey === "surplus_placeholder");
  assert.ok(qSurplus);
});
