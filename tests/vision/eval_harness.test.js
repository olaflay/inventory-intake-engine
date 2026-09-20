import test from "node:test";
import assert from "node:assert/strict";
import { evaluateExtractions } from "../../packages/vision/dist/index.js";

test("Phase 0 Evaluation Runner (PRD §34): validates exact read rate and zero hallucinations", () => {
  const mockGroundTruth = {
    documentId: "doc-sample-1",
    expectedDocumentType: "waybill",
    expectedHeader: {
      documentNo: "001434",
      toLocation: "FOT Jetty, Onne"
    },
    expectedLines: [
      { itemDescription: "HP Monitor", serials: ["CNC42316R1"], legible: true },
      { itemDescription: "Smudged Radio", serials: ["UNKNOWN-TAG"], legible: false }
    ]
  };

  // Case 1: Model reads legible serial correctly and marks illegible as unread (does not fabricate)
  const extractionSuccess = {
    header: { documentType: "waybill", documentNo: "001434" },
    lines: [
      { lineNo: 1, itemDescription: "HP Monitor", quantity: 1, serials: ["CNC42316R1"], unread: false },
      { lineNo: 2, itemDescription: "Smudged Radio", quantity: 1, serials: [], unread: true }
    ],
    rotationNeeded: 0,
    rawJson: {},
    tokensIn: 1200,
    tokensOut: 150,
    modelUsed: "gemini-2.0-flash",
    costUsdEst: 0.0015
  };

  const report = evaluateExtractions([
    { groundTruth: mockGroundTruth, extraction: extractionSuccess }
  ]);

  assert.equal(report.exactSerialReadRate >= 0.95, true);
  assert.equal(report.fabricatedSerialCount, 0);
  assert.equal(report.phase0GatePassed, true);

  // Case 2: Model hallucinates / guesses an illegible serial -> Immediate Gate Failure
  const extractionFabricated = {
    ...extractionSuccess,
    lines: [
      { lineNo: 1, itemDescription: "HP Monitor", quantity: 1, serials: ["CNC42316R1"], unread: false },
      { lineNo: 2, itemDescription: "Smudged Radio", quantity: 1, serials: ["UNKNOWN-TAG"], unread: false } // Guessed!
    ]
  };

  const failReport = evaluateExtractions([
    { groundTruth: mockGroundTruth, extraction: extractionFabricated }
  ]);

  assert.equal(failReport.fabricatedSerialCount, 1);
  assert.equal(failReport.phase0GatePassed, false);
});
