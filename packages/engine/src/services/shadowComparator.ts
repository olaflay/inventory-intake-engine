export interface ShadowProposedLine {
  id: string;
  serialNumber?: string;
  internalRef?: string;
  sourceLocation?: string;
  destinationLocation: string;
  proposedStatus?: string;
  week: 1 | 2;
  humanCorrected: boolean;
  correctionReason?: string;
}

export interface ShadowActualChange {
  serialNumber?: string;
  internalRef?: string;
  sourceLocation?: string;
  destinationLocation: string;
  actualStatus?: string;
  viaBotSubmission: boolean;
}

export interface ShadowPilotData {
  proposals: ShadowProposedLine[];
  actualChanges: ShadowActualChange[];
  restoreDrillPassed: boolean;
  adminUnaidedConfigPassed: boolean;
  unresolvedWrongMatchesCount: number;
  invariantViolationsCount: number;
}

export interface ExitCriterionResult {
  code: "a" | "b" | "c" | "d" | "e" | "f";
  target: string;
  actualValue: number | string | boolean;
  met: boolean;
  detail: string;
}

export interface ShadowPilotScorecard {
  generatedAt: string;
  totalProposedLines: number;
  totalActualMovements: number;
  agreementRatePct: number;
  humanCorrectionWeek1Pct: number;
  humanCorrectionWeek2Pct: number;
  botCoveragePct: number;
  criteria: ExitCriterionResult[];
  allCriteriaMet: boolean;
  readyForCutover: boolean;
}

/**
 * ShadowComparator (PRD §52 Phase 11, LD-15)
 * Telemetry and precision comparison engine for the two-week shadow pilot.
 * Compares the engine's autonomous proposals against manual Excel changes
 * to evaluate the 6 product-level exit criteria before cutover.
 */
export class ShadowComparator {
  public evaluatePilot(data: ShadowPilotData): ShadowPilotScorecard {
    const totalProposed = data.proposals.length;
    const totalActual = data.actualChanges.length;

    // (a) Agreement rate: proposed destination and status agree with actual change
    let matchingLinesCount = 0;
    for (const prop of data.proposals) {
      const match = data.actualChanges.find(
        act =>
          (prop.serialNumber && act.serialNumber === prop.serialNumber) ||
          (prop.internalRef && act.internalRef === prop.internalRef)
      );

      if (match && match.destinationLocation === prop.destinationLocation) {
        matchingLinesCount += 1;
      }
    }

    const agreementRatePct = totalProposed > 0 ? (matchingLinesCount / totalProposed) * 100 : 0;
    const criterionA: ExitCriterionResult = {
      code: "a",
      target: "≥ 95% of proposed lines agree with real changes",
      actualValue: Number(agreementRatePct.toFixed(1)),
      met: agreementRatePct >= 95.0,
      detail: `${matchingLinesCount}/${totalProposed} proposed lines agree with actual movements (${agreementRatePct.toFixed(1)}%)`
    };

    // (b) Zero posted violations and zero unresolved wrong matches
    const zeroViolations = data.invariantViolationsCount === 0 && data.unresolvedWrongMatchesCount === 0;
    const criterionB: ExitCriterionResult = {
      code: "b",
      target: "Zero posted violations (I1-I4) and zero unresolved wrong matches",
      actualValue: `violations=${data.invariantViolationsCount}, wrong_matches=${data.unresolvedWrongMatchesCount}`,
      met: zeroViolations,
      detail: zeroViolations
        ? "Clean audit: 0 invariant violations and 0 unresolved wrong matches"
        : `Integrity alert: ${data.invariantViolationsCount} violations, ${data.unresolvedWrongMatchesCount} unresolved wrong matches`
    };

    // (c) Human correction rate falling and <= 30% by week 2
    const week1Props = data.proposals.filter(p => p.week === 1);
    const week2Props = data.proposals.filter(p => p.week === 2);

    const week1Corrections = week1Props.filter(p => p.humanCorrected).length;
    const week2Corrections = week2Props.filter(p => p.humanCorrected).length;

    const rateWeek1 = week1Props.length > 0 ? (week1Corrections / week1Props.length) * 100 : 0;
    const rateWeek2 = week2Props.length > 0 ? (week2Corrections / week2Props.length) * 100 : 0;

    const criterionCMet = rateWeek2 <= 30.0 && rateWeek2 <= rateWeek1;
    const criterionC: ExitCriterionResult = {
      code: "c",
      target: "Human correction rate falling and ≤ 30% by Week 2",
      actualValue: `Week 1: ${rateWeek1.toFixed(1)}%, Week 2: ${rateWeek2.toFixed(1)}%`,
      met: criterionCMet,
      detail: criterionCMet
        ? `Correction rate declined from ${rateWeek1.toFixed(1)}% (W1) to ${rateWeek2.toFixed(1)}% (W2)`
        : `Correction rate target missed: Week 1=${rateWeek1.toFixed(1)}%, Week 2=${rateWeek2.toFixed(1)}%`
    };

    // (d) >= 80% of real movements submitted through bot
    const botSubmitted = data.actualChanges.filter(a => a.viaBotSubmission).length;
    const botCoveragePct = totalActual > 0 ? (botSubmitted / totalActual) * 100 : 0;
    const criterionD: ExitCriterionResult = {
      code: "d",
      target: "≥ 80% of real movements submitted through bot",
      actualValue: Number(botCoveragePct.toFixed(1)),
      met: botCoveragePct >= 80.0,
      detail: `${botSubmitted}/${totalActual} real movements initiated through bot (${botCoveragePct.toFixed(1)}%)`
    };

    // (e) Restore drill done
    const criterionE: ExitCriterionResult = {
      code: "e",
      target: "Restore drill done and verified",
      actualValue: data.restoreDrillPassed,
      met: data.restoreDrillPassed,
      detail: data.restoreDrillPassed
        ? "Restore drill validated with passing LedgerReplayer invariant checks"
        : "Restore drill has not yet passed"
    };

    // (f) Admin adds a user and a location through Ops Workbook unaided
    const criterionF: ExitCriterionResult = {
      code: "f",
      target: "Admin adds user and location through Ops Workbook unaided",
      actualValue: data.adminUnaidedConfigPassed,
      met: data.adminUnaidedConfigPassed,
      detail: data.adminUnaidedConfigPassed
        ? "Admin verified capable of adding users and locations without developer intervention"
        : "Admin unaided configuration test not completed"
    };

    const criteria = [criterionA, criterionB, criterionC, criterionD, criterionE, criterionF];
    const allMet = criteria.every(c => c.met);

    return {
      generatedAt: new Date().toISOString(),
      totalProposedLines: totalProposed,
      totalActualMovements: totalActual,
      agreementRatePct: Number(agreementRatePct.toFixed(1)),
      humanCorrectionWeek1Pct: Number(rateWeek1.toFixed(1)),
      humanCorrectionWeek2Pct: Number(rateWeek2.toFixed(1)),
      botCoveragePct: Number(botCoveragePct.toFixed(1)),
      criteria,
      allCriteriaMet: allMet,
      readyForCutover: allMet
    };
  }
}
