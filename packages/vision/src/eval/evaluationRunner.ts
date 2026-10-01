import type { ExtractionResult, ExtractedLine } from "../types.js";

export interface GroundTruthLine {
  itemDescription: string;
  serials: string[];
  legible: boolean;
}

export interface GroundTruthDocument {
  documentId: string;
  expectedDocumentType: string;
  expectedHeader: {
    documentNo?: string;
    fromLocation?: string;
    toLocation?: string;
    vesselName?: string;
  };
  expectedLines: GroundTruthLine[];
}

export interface EvaluationReport {
  totalDocuments: number;
  totalSerialsEvaluated: number;
  exactSerialReadRate: number;
  fabricatedSerialCount: number;
  headerAccuracy: number;
  costPerTransactionEst: number;
  phase0GatePassed: boolean;
  failures: string[];
}

/**
 * Phase 0 Evaluation Harness (PRD §34)
 * Evaluates vision model outputs against hand-labelled ground truth.
 * - Exact serial read rate on legible serials >= 95%
 * - Fabricated/guessed serials on illegible serials = strictly 0
 */
export function evaluateExtractions(
  testCases: { groundTruth: GroundTruthDocument; extraction: ExtractionResult }[]
): EvaluationReport {
  let totalLegibleSerials = 0;
  let correctSerials = 0;
  let fabricatedSerials = 0;
  let headerChecksTotal = 0;
  let headerChecksPassed = 0;
  let totalCostEst = 0;
  const failures: string[] = [];

  for (const { groundTruth, extraction } of testCases) {
    totalCostEst += extraction.costUsdEst;

    // Header check
    headerChecksTotal += 1;
    if (extraction.header.documentType === groundTruth.expectedDocumentType) {
      headerChecksPassed += 1;
    } else {
      failures.push(`Doc ${groundTruth.documentId}: Type mismatch (${extraction.header.documentType} vs ${groundTruth.expectedDocumentType})`);
    }

    // Lines & serial evaluation
    const extractedSerials = new Set(
      extraction.lines.flatMap((l: ExtractedLine) => {
        const serials = Array.isArray(l.serials) ? l.serials : [];
        return serials.map((s: any) => {
          if (typeof s === "string") return s.trim().toUpperCase();
          if (s && typeof s.value === "string") return s.value.trim().toUpperCase();
          return "";
        }).filter(Boolean);
      })
    );

    for (const expLine of groundTruth.expectedLines) {
      for (const expectedSerial of expLine.serials) {
        const normExp = expectedSerial.trim().toUpperCase();

        if (expLine.legible) {
          totalLegibleSerials += 1;
          if (extractedSerials.has(normExp)) {
            correctSerials += 1;
          } else {
            failures.push(`Doc ${groundTruth.documentId}: Missed legible serial ${normExp}`);
          }
        } else {
          // If illegible, the model must NOT guess or invent characters
          if (extractedSerials.has(normExp)) {
            fabricatedSerials += 1;
            failures.push(`Doc ${groundTruth.documentId}: Fabricated illegible serial ${normExp}`);
          }
        }
      }
    }
  }

  const exactSerialReadRate = totalLegibleSerials > 0 ? correctSerials / totalLegibleSerials : 1.0;
  const headerAccuracy = headerChecksTotal > 0 ? headerChecksPassed / headerChecksTotal : 1.0;
  const costPerTransactionEst = testCases.length > 0 ? totalCostEst / testCases.length : 0.0;

  const phase0GatePassed =
    exactSerialReadRate >= 0.95 &&
    fabricatedSerials === 0 &&
    headerAccuracy >= 0.95;

  return {
    totalDocuments: testCases.length,
    totalSerialsEvaluated: totalLegibleSerials,
    exactSerialReadRate,
    fabricatedSerialCount: fabricatedSerials,
    headerAccuracy,
    costPerTransactionEst,
    phase0GatePassed,
    failures
  };
}
