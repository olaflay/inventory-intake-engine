import test from "node:test";
import assert from "node:assert/strict";
import { ShadowComparator, runCli } from "../../packages/engine/dist/index.js";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("E2E Phase 11: Shadow-Mode Pilot Telemetry & Cutover Exit Criteria Gate (PRD §52, LD-15)", async (t) => {
  const comparator = new ShadowComparator();

  // Synthetic 2-week pilot dataset based on Appendix D loadouts & dispatches
  const simulatedPilotData = {
    proposals: [
      // Week 1 movements (10 lines, 2 human corrections = 20% correction rate)
      { id: "p-01", serialNumber: "CNC42316RB", destinationLocation: "Warami 10", week: 1, humanCorrected: false },
      { id: "p-02", serialNumber: "CNC42316R2", destinationLocation: "Warami 10", week: 1, humanCorrected: false },
      { id: "p-03", serialNumber: "8709", destinationLocation: "Warami 10", week: 1, humanCorrected: true, correctionReason: "Location conflict reviewed" },
      { id: "p-04", serialNumber: "6CR5420WK4", destinationLocation: "Warami 10", week: 1, humanCorrected: false },
      { id: "p-05", serialNumber: "01.42.935", destinationLocation: "Warami 10", week: 1, humanCorrected: false },
      { id: "p-06", serialNumber: "734668", destinationLocation: "Warami 10", week: 1, humanCorrected: false },
      { id: "p-07", serialNumber: "883214", destinationLocation: "Warami 10", week: 1, humanCorrected: false },
      { id: "p-08", serialNumber: "24027", destinationLocation: "Warami 10", week: 1, humanCorrected: false },
      { id: "p-09", internalRef: "GOSL/SE/101", destinationLocation: "Warami 10", week: 1, humanCorrected: true, correctionReason: "Non-serial asset match confirmed" },
      { id: "p-10", internalRef: "GOSL/SE/102", destinationLocation: "Warami 10", week: 1, humanCorrected: false },

      // Week 2 movements (10 lines, 1 human correction = 10% correction rate, falling from 20%)
      { id: "p-11", serialNumber: "SN-IT-501", destinationLocation: "FOT Jetty", week: 2, humanCorrected: false },
      { id: "p-12", serialNumber: "SN-IT-502", destinationLocation: "FOT Jetty", week: 2, humanCorrected: false },
      { id: "p-13", serialNumber: "SN-IT-503", destinationLocation: "FOT Jetty", week: 2, humanCorrected: false },
      { id: "p-14", serialNumber: "SN-SURV-201", destinationLocation: "Warri Base", week: 2, humanCorrected: false },
      { id: "p-15", serialNumber: "SN-SURV-202", destinationLocation: "Warri Base", week: 2, humanCorrected: false },
      { id: "p-16", serialNumber: "SN-SURV-203", destinationLocation: "Warri Base", week: 2, humanCorrected: false },
      { id: "p-17", serialNumber: "SN-SURV-204", destinationLocation: "Warri Base", week: 2, humanCorrected: false },
      { id: "p-18", serialNumber: "SN-SURV-205", destinationLocation: "Warri Base", week: 2, humanCorrected: false },
      { id: "p-19", serialNumber: "SN-SURV-206", destinationLocation: "Warri Base", week: 2, humanCorrected: false },
      { id: "p-20", serialNumber: "SN-SURV-207", destinationLocation: "Warri Base", week: 2, humanCorrected: true, correctionReason: "Typo in destination fixed" }
    ],
    actualChanges: [
      // 20 actual movements matching proposals (19 exact matching destination = 95% agreement)
      { serialNumber: "CNC42316RB", destinationLocation: "Warami 10", viaBotSubmission: true },
      { serialNumber: "CNC42316R2", destinationLocation: "Warami 10", viaBotSubmission: true },
      { serialNumber: "8709", destinationLocation: "Warami 10", viaBotSubmission: true },
      { serialNumber: "6CR5420WK4", destinationLocation: "Warami 10", viaBotSubmission: true },
      { serialNumber: "01.42.935", destinationLocation: "Warami 10", viaBotSubmission: true },
      { serialNumber: "734668", destinationLocation: "Warami 10", viaBotSubmission: true },
      { serialNumber: "883214", destinationLocation: "Warami 10", viaBotSubmission: true },
      { serialNumber: "24027", destinationLocation: "Warami 10", viaBotSubmission: true },
      { internalRef: "GOSL/SE/101", destinationLocation: "Warami 10", viaBotSubmission: true },
      { internalRef: "GOSL/SE/102", destinationLocation: "Warami 10", viaBotSubmission: true },
      { serialNumber: "SN-IT-501", destinationLocation: "FOT Jetty", viaBotSubmission: true },
      { serialNumber: "SN-IT-502", destinationLocation: "FOT Jetty", viaBotSubmission: true },
      { serialNumber: "SN-IT-503", destinationLocation: "FOT Jetty", viaBotSubmission: true },
      { serialNumber: "SN-SURV-201", destinationLocation: "Warri Base", viaBotSubmission: true },
      { serialNumber: "SN-SURV-202", destinationLocation: "Warri Base", viaBotSubmission: true },
      { serialNumber: "SN-SURV-203", destinationLocation: "Warri Base", viaBotSubmission: true },
      { serialNumber: "SN-SURV-204", destinationLocation: "Warri Base", viaBotSubmission: true },
      { serialNumber: "SN-SURV-205", destinationLocation: "Warri Base", viaBotSubmission: false }, // Manual walk-in
      { serialNumber: "SN-SURV-206", destinationLocation: "Warri Base", viaBotSubmission: false }, // Manual walk-in
      { serialNumber: "SN-SURV-207", destinationLocation: "Warri Base", viaBotSubmission: true }
    ],
    restoreDrillPassed: true,
    adminUnaidedConfigPassed: true,
    unresolvedWrongMatchesCount: 0,
    invariantViolationsCount: 0
  };

  // 1. Evaluate baseline passing pilot
  const scorecard = comparator.evaluatePilot(simulatedPilotData);

  assert.equal(scorecard.allCriteriaMet, true);
  assert.equal(scorecard.readyForCutover, true);
  assert.ok(scorecard.agreementRatePct >= 95.0, `Agreement rate was ${scorecard.agreementRatePct}`);
  assert.equal(scorecard.humanCorrectionWeek1Pct, 20.0);
  assert.equal(scorecard.humanCorrectionWeek2Pct, 10.0);
  assert.ok(scorecard.humanCorrectionWeek2Pct < scorecard.humanCorrectionWeek1Pct);
  assert.ok(scorecard.botCoveragePct >= 80.0, `Bot coverage was ${scorecard.botCoveragePct}`);

  // 2. Validate individual exit criteria
  const criterionMap = new Map(scorecard.criteria.map(c => [c.code, c]));
  assert.equal(criterionMap.get("a")?.met, true);
  assert.equal(criterionMap.get("b")?.met, true);
  assert.equal(criterionMap.get("c")?.met, true);
  assert.equal(criterionMap.get("d")?.met, true);
  assert.equal(criterionMap.get("e")?.met, true);
  assert.equal(criterionMap.get("f")?.met, true);

  // 3. Negative case: Failing agreement rate blocks cutover
  const failingAgreementData = {
    ...simulatedPilotData,
    actualChanges: simulatedPilotData.actualChanges.map((act, i) =>
      i < 5 ? { ...act, destinationLocation: "Wrong Yard" } : act
    )
  };
  const failingScorecard = comparator.evaluatePilot(failingAgreementData);
  assert.equal(failingScorecard.allCriteriaMet, false);
  assert.equal(failingScorecard.readyForCutover, false);
  assert.equal(failingScorecard.criteria.find(c => c.code === "a")?.met, false);

  // 4. Negative case: Invariant violation strictly blocks cutover
  const violatingData = {
    ...simulatedPilotData,
    invariantViolationsCount: 1
  };
  const violationScorecard = comparator.evaluatePilot(violatingData);
  assert.equal(violationScorecard.readyForCutover, false);
  assert.equal(violationScorecard.criteria.find(c => c.code === "b")?.met, false);

  // 5. Test CLI integration
  const tempPath = join(tmpdir(), `pilot_data_${Date.now()}.json`);
  writeFileSync(tempPath, JSON.stringify(simulatedPilotData));

  try {
    const cliRes = await runCli(["shadow-compare", tempPath]);
    assert.equal(cliRes.code, 0);
    assert.match(cliRes.stdout, /ReadyForCutover=YES/);
    assert.match(cliRes.stdout, /Agreement=100%/);
  } finally {
    unlinkSync(tempPath);
  }
});
