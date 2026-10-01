import test from "node:test";
import assert from "node:assert/strict";
import {
  matchLine,
  IntentResolver,
  runValidationPipeline,
  ManifestReconciler
} from "../../packages/domain/dist/index.js";
import {
  LocationService,
  ProposalService
} from "../../packages/engine/dist/index.js";

const sampleConfig = {
  fuzzyMinLength: 8,
  fuzzyMaxDistance: 0.9,
  shortNumericExactOnly: true,
  ignorableChars: ["-", " ", "."],
  separators: ["/"],
  partMinLength: 3,
  candidateMinScore: 0.7,
  maxCandidates: 5,
  descriptionSimilarityMin: 0.6,
  confusionPairs: [{ a: "O", b: "0", cost: 0.3 }],
  distinguishingTokens: [["HP", "DELL", "LG"]],
  nullSerialTokens: ["N/A", "NIL", "NSN", "NONE"]
};

test("EC-22: Waybill with no items creates open dispatch awaiting itemization", () => {
  const locService = new LocationService([
    { id: "loc-base", name: "Base Store", type: "store", aliases: [], isDestination: false },
    { id: "loc-jetty", name: "FOT Jetty", type: "yard", aliases: [], isDestination: true }
  ]);

  const proposal = ProposalService.assembleProposal({
    submissionId: "sub-ec22",
    actorRole: "dispatcher",
    actorRef: "telegram:user1",
    documents: [
      {
        documentType: "waybill",
        documentNo: "WB-EC22",
        fromLocation: "Base Store",
        toLocation: "FOT Jetty",
        lines: [] // No items on waybill
      }
    ],
    assets: [],
    locationService: locService,
    matchingConfig: sampleConfig,
    approvalRules: [{ priority: 99, name: "default", predicate: "always", tier: 1 }]
  });

  assert.strictEqual(proposal.header.kind, "dispatch_unitemized");
  assert.strictEqual(proposal.lines.length, 0);
  assert.ok(proposal.header.notes?.includes("awaiting itemization"));
});

test("EC-23: Manifest without waybill asks intent (default reconcile-only)", () => {
  const intent = IntentResolver.resolveIntent({
    documentTypes: ["loadout_list"]
  });

  assert.strictEqual(intent.kind, "assertion");
  assert.strictEqual(intent.requiresQuestion, true);
  assert.strictEqual(intent.question?.questionKey, "manifest_intent");
});

test("EC-26: Serials 1 character apart flagged as exact_with_neighbor or possible", () => {
  // Two real serials 1 character apart in database
  const assets = [
    { id: "a1", internalRef: "R1", serials: ["CNC42316R1"], description: "Monitor", locationId: "loc-1", statusCode: "OPERATIONAL" },
    { id: "a2", internalRef: "R2", serials: ["CNC42316R2"], description: "Monitor", locationId: "loc-1", statusCode: "OPERATIONAL" }
  ];

  const res = matchLine("CNC42316R1", "Monitor", assets, sampleConfig);
  assert.strictEqual(res.state, "exact_with_neighbor");
  assert.ok(res.flags.includes("neighbor_serial_detected"));
});

test("EC-27: No serial and no asset number falls back to candidate description search", () => {
  const assets = [
    { id: "a-ups1", internalRef: "UPS-01", serials: [], description: "APC Smart-UPS 1500VA", locationId: "loc-1", statusCode: "OPERATIONAL" },
    { id: "a-ups2", internalRef: "UPS-02", serials: [], description: "APC Smart-UPS 1500VA", locationId: "loc-1", statusCode: "OPERATIONAL" }
  ];

  const res = matchLine("", "APC Smart-UPS 1500VA", assets, sampleConfig);
  assert.strictEqual(res.state, "unknown");
  assert.ok(res.flags.includes("no_serial"));
});

test("EC-29: Item Scrapped/Obsolete blocks movement (terminal_status)", () => {
  const scrapped = { id: "a-scrap", description: "Winch", locationId: "loc-1", statusCode: "SCRAPPED" };
  const val = runValidationPipeline(
    {
      lineNo: 1,
      extractedDescription: "Winch",
      extractedSerials: ["W-01"],
      quantity: 1,
      unread: false,
      matchedAsset: scrapped,
      matchState: "exact"
    },
    { sourceLocationId: "loc-1", destinationLocationId: "loc-2" }
  );

  assert.strictEqual(val.isTerminal, true);
  assert.ok(val.flags.includes("terminal_status"));
});

test("EC-30: Item already at destination flagged with already_at_destination", () => {
  const assetAtDest = { id: "a-dest", description: "Echo", locationId: "loc-warami", statusCode: "OPERATIONAL" };
  const val = runValidationPipeline(
    {
      lineNo: 1,
      extractedDescription: "Echo",
      extractedSerials: ["E-01"],
      quantity: 1,
      unread: false,
      matchedAsset: assetAtDest,
      matchState: "exact"
    },
    { sourceLocationId: "loc-base", destinationLocationId: "loc-warami" }
  );

  assert.ok(val.flags.includes("already_at_destination"));
});

test("EC-31: Location conflict with database flagged with location_conflict", () => {
  const assetElsewhere = { id: "a-else", description: "Meridian Gyro", locationId: "loc-eg-project", statusCode: "OPERATIONAL" };
  const val = runValidationPipeline(
    {
      lineNo: 1,
      extractedDescription: "Meridian Gyro",
      extractedSerials: ["8709"],
      quantity: 1,
      unread: false,
      matchedAsset: assetElsewhere,
      matchState: "exact"
    },
    { sourceLocationId: "loc-base", destinationLocationId: "loc-warami" }
  );

  assert.ok(val.flags.includes("location_conflict"));
});

test("EC-32: Unknown item matches nothing and remains unknown", () => {
  const res = matchLine("UNKNOWN-SN-9999", "Special Drone", [], sampleConfig);
  assert.strictEqual(res.state, "unknown");
  assert.strictEqual(res.assetId, null);
});

test("EC-33: Unknown location becomes provisional candidate with decision options", () => {
  const locService = new LocationService();
  const res = locService.resolveLocation("Mystery Pier 42");

  assert.strictEqual(res.state, "unknown");
  assert.ok(res.provisionalCandidate);
  assert.strictEqual(res.provisionalCandidate.rawText, "Mystery Pier 42");
});

test("EC-34: Description variance allows serial to win", () => {
  const assets = [
    { id: "a-tms", internalRef: "SE-106", serials: ["01.42.935"], description: "Survey Dongle", locationId: "loc-1", statusCode: "OPERATIONAL" }
  ];

  // Serial matches, description is slightly different ("TMS Dongle" vs "Survey Dongle")
  const res = matchLine("01.42.935", "TMS Dongle", assets, sampleConfig);
  assert.strictEqual(res.assetId, "a-tms");
  assert.strictEqual(res.state, "exact");
});

test("EC-35: Different make on serial hit produces description_conflict", () => {
  const assets = [
    { id: "a-dell", internalRef: "SE-105", serials: ["CN-0V048Y-72872"], description: "DELL Monitor", locationId: "loc-1", statusCode: "OPERATIONAL" }
  ];

  // Document states "HP Monitor" but matched asset is "DELL Monitor"
  const res = matchLine("CN-0V048Y-72872", "HP Monitor", assets, sampleConfig);
  assert.ok(res.flags.includes("description_conflict"));
});

test("EC-36: Quantity surplus creates placeholders requiring a decision", () => {
  const locService = new LocationService([
    { id: "loc-1", name: "Base", type: "store", aliases: [], isDestination: false }
  ]);

  const proposal = ProposalService.assembleProposal({
    submissionId: "sub-ec36",
    actorRole: "dispatcher",
    actorRef: "user",
    documents: [
      {
        documentType: "loadout_list",
        lines: [
          { lineNo: 1, description: "Toolbox", serials: ["TB-01"], quantity: 3 }
        ]
      }
    ],
    assets: [{ id: "a-tb", internalRef: "TB1", serials: ["TB-01"], description: "Toolbox", locationId: "loc-1", statusCode: "OPERATIONAL" }],
    locationService: locService,
    matchingConfig: sampleConfig,
    approvalRules: [{ priority: 99, name: "default", predicate: "always", tier: 1 }]
  });

  const placeholders = proposal.lines.filter(l => l.isPlaceholder);
  assert.strictEqual(placeholders.length, 2);
  const q = proposal.questions.find(q => q.questionKey === "surplus_placeholder");
  assert.ok(q);
});

test("EC-37: Null tokens (N/A, NIL, NSN) are normalized to empty and never matched", () => {
  for (const token of ["N/A", "NIL", "NSN", "NONE"]) {
    const res = matchLine(token, "Equipment", [], sampleConfig);
    assert.strictEqual(res.state, "unknown");
    assert.ok(res.flags.includes("no_serial"));
  }
});

test("EC-38: Composite serial parts hitting different assets flagged as ambiguous", () => {
  const assets = [
    { id: "a1", internalRef: "A1", serials: ["SN-PART-A"], description: "Assembly A", locationId: "loc-1", statusCode: "OPERATIONAL" },
    { id: "a2", internalRef: "A2", serials: ["SN-PART-B"], description: "Assembly B", locationId: "loc-1", statusCode: "OPERATIONAL" }
  ];

  // Extracted composite serial containing parts from two different assets
  const res = matchLine("SN-PART-A / SN-PART-B", "Dual Unit", assets, sampleConfig);
  assert.strictEqual(res.state, "ambiguous");
  assert.ok(res.flags.includes("composite_parts_conflict"));
});

test("EC-39: Free-text constraint remark is preserved on the proposal line", () => {
  const val = runValidationPipeline(
    {
      lineNo: 1,
      extractedDescription: "Cable",
      extractedSerials: ["C-01"],
      quantity: 1,
      unread: false,
      remarks: "HOLD - Awaiting inspection",
      matchState: "exact"
    }
  );

  assert.ok(val.flags.includes("remark_constraint"));
});

test("EC-40: Items at location missing from manifest listed in informational section without change", () => {
  const allLocationAssets = [
    { id: "a1", description: "Tool A", serials: ["T1"], locationId: "loc-site", statusCode: "OPERATIONAL" },
    { id: "a2", description: "Tool B", serials: ["T2"], locationId: "loc-site", statusCode: "OPERATIONAL" }
  ];

  // Manifest only contains Tool A
  const manifestLines = [
    { lineNo: 1, matchResult: { state: "exact", assetId: "a1", candidates: [], flags: [] }, matchedAsset: allLocationAssets[0] }
  ];

  const recon = ManifestReconciler.reconcile(manifestLines, "loc-site", allLocationAssets);
  assert.strictEqual(recon.missingFromList.length, 1);
  assert.strictEqual(recon.missingFromList[0].assetId, "a2");
});

test("EC-41: Stored location unrecorded skips source-mismatch check", () => {
  const unrecorded = { id: "a-unrec", description: "Sensor", locationId: "unrecorded", statusCode: "OPERATIONAL" };
  const val = runValidationPipeline(
    {
      lineNo: 1,
      extractedDescription: "Sensor",
      extractedSerials: ["S-01"],
      quantity: 1,
      unread: false,
      matchedAsset: unrecorded,
      matchState: "exact"
    },
    { sourceLocationId: "loc-base", destinationLocationId: "loc-vessel" }
  );

  assert.strictEqual(val.flags.includes("location_conflict"), false);
});
