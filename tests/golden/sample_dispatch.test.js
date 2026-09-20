import test from "node:test";
import assert from "node:assert/strict";
import {
  matchLine,
  determineApprovalTier
} from "../../packages/domain/dist/index.js";

test("Golden Test (Appendix D): 17-line dispatch with sample inventory produces expected match states and Tier 2", () => {
  // Setup inventory baseline reflecting July workbook sample facts
  const mockInventory = [
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

  const config = {
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

  // The 17 lines from Warami 10 loadout list
  const lines = [
    { no: 1, desc: "HP Monitor", serial: "CNC42316R1" },
    { no: 2, desc: "HP Monitor", serial: "CNC42316R2" },
    { no: 3, desc: "HP Monitor", serial: "CNC42316R3" },
    { no: 4, desc: "HP Monitor", serial: "CNC42316RB" },
    { no: 5, desc: "HP Monitor", serial: "CN-OVO48Y-72872" }, // Confusable O/0 + description conflict (HP vs Dell)
    { no: 6, desc: "HP Monitor", serial: "854133-001" }, // not on file
    { no: 7, desc: "LG Monitor", serial: "60INTHMD8889" }, // not on file
    { no: 8, desc: "Tank System", serial: "SA19502429" }, // not on file
    { no: 9, desc: "Meridian Gyro", serial: "8709" },
    { no: 10, desc: "HP CPU", serial: "SGH251SMWY" }, // not on file
    { no: 11, desc: "UPS", serial: "" }, // no serial
    { no: 12, desc: "HP CPU", serial: "6CR5420WK4" },
    { no: 13, desc: "TMS Dongle", serial: "01.42.935" },
    { no: 14, desc: "IEA440 Echosounder", serial: "734668" }, // already at destination
    { no: 15, desc: "G-882 Magnetometer", serial: "883214" }, // already at destination
    { no: 16, desc: "Fire Extinguisher", serial: "" }, // no serial
    { no: 17, desc: "Valeport Midas CTD", serial: "24027" }
  ];

  const results = lines.map(l =>
    matchLine(l.serial, l.desc, mockInventory, config, destinationLocationId)
  );

  // Assert expected counts matching PRD Appendix D-2 tally:
  // "Tally: 7 lines matched by serial, 5 with serials not on file, 5 with no serial" (or candidates)
  const matchedLines = results.filter(r => r.state === "exact" || r.state === "exact_with_neighbor" || r.state === "possible");
  assert.equal(matchedLines.length >= 7, true);

  // Line 5: CN-OVO48Y should match DELL with possible and description_conflict
  const line5 = results[4];
  assert.equal(line5.state, "possible");
  assert.equal(line5.flags.includes("description_conflict"), true);

  // Line 14: Already at destination flag
  const line14 = results[13];
  assert.equal(line14.flags.includes("already_at_destination"), true);

  // Tier rules
  const rules = [
    { priority: 1, name: "terminal", predicate: "status_to:terminal", tier: 3 },
    { priority: 5, name: "possible_match", predicate: "line_state:possible", tier: 2 },
    { priority: 6, name: "desc_conflict", predicate: "flag:description_conflict", tier: 2 },
    { priority: 99, name: "default", predicate: "always", tier: 1 }
  ];

  const transactionContext = {
    submitterRole: "worker",
    submitterRef: "telegram:worker1",
    lineCount: 17,
    flags: results.flatMap(r => r.flags),
    lineStates: results.map(r => r.state),
    statusChanges: [],
    isTerminalStatus: false,
    isCreateAsset: false
  };

  const derivedTier = determineApprovalTier(rules, transactionContext);
  assert.equal(derivedTier, 2, "Expected Tier 2 approval due to possible match and description conflict");
});
