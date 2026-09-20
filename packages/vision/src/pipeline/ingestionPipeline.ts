import { detectMimeFromBytes, DetectedMime } from "./magicBytes.js";
import { computeSha256, computePerceptualHash, isDuplicateDocument } from "./hashing.js";
import { evaluateQuality } from "./qualityGate.js";
import { PdfPageRenderer } from "./pdfRenderer.js";

export interface IngestionConfig {
  maxFileBytes: number;
  maxPixels: number;
  minPixels: number;
  workingMaxEdgePx: number;
  minLaplacianVariance: number;
  phashMaxDistance: number;
  maxPdfPages: number;
}

export const DEFAULT_INGESTION_CONFIG: IngestionConfig = {
  maxFileBytes: 20 * 1024 * 1024, // 20 MB (PRD §21.2)
  maxPixels: 40_000_000,          // 40 MP decompression bomb cap (PRD §9.2)
  minPixels: 10_000,
  workingMaxEdgePx: 2048,
  minLaplacianVariance: 100.0,    // PRD §9.2
  phashMaxDistance: 10,
  maxPdfPages: 20
};

export interface PriorDocumentReference {
  id: string;
  submissionId: string;
  sha256: string;
  perceptualHash: string;
}

export interface IngestionInput {
  filename: string;
  buffer: Uint8Array;
  declaredWidth?: number;
  declaredHeight?: number;
  estimatedLaplacianVariance?: number;
  useAnyway?: boolean;
}

export interface ProcessedPageArtifact {
  pageNumber: number;
  width: number;
  height: number;
  rotationNeeded: 0 | 90 | 180 | 270;
  buffer: Uint8Array;
}

export interface IngestionResult {
  success: boolean;
  documentId: string;
  sha256: string;
  perceptualHash: string;
  mime: string;
  detectedType: DetectedMime;
  pages: ProcessedPageArtifact[];
  qualityPassed: boolean;
  flags: string[];
  reasons: string[];
  duplicateMatch?: {
    priorSubmissionId: string;
    reason: string;
  };
}

/**
 * Document Ingestion Pipeline (PRD §9.2, §19)
 * Orchestrates the 7 intake steps from raw bytes to normalized working copy.
 */
export class IngestionPipeline {
  private config: IngestionConfig;
  private pdfRenderer: PdfPageRenderer;

  constructor(config: Partial<IngestionConfig> = {}) {
    this.config = { ...DEFAULT_INGESTION_CONFIG, ...config };
    this.pdfRenderer = new PdfPageRenderer({
      maxPdfPages: this.config.maxPdfPages,
      pdfDpi: 150
    });
  }

  public process(
    input: IngestionInput,
    priorDocuments: PriorDocumentReference[] = []
  ): IngestionResult {
    const reasons: string[] = [];
    const flags: string[] = [];

    // Step 1: Magic-Byte MIME Validation (FR-DOC-01, EC-15)
    const detected = detectMimeFromBytes(input.buffer);
    if (detected.isExecutable) {
      return {
        success: false,
        documentId: "",
        sha256: "",
        perceptualHash: "",
        mime: detected.mime,
        detectedType: detected,
        pages: [],
        qualityPassed: false,
        flags: ["executable_rejected"],
        reasons: ["Security violation: Executable files are strictly forbidden (EC-15)"]
      };
    }

    if (!detected.isSupported) {
      return {
        success: false,
        documentId: "",
        sha256: "",
        perceptualHash: "",
        mime: detected.mime,
        detectedType: detected,
        pages: [],
        qualityPassed: false,
        flags: ["unsupported_mime"],
        reasons: [`Unsupported file format '${detected.mime}' (${detected.extension}). Only JPG, PNG, WebP, and PDF are allowed.`]
      };
    }

    // Step 2: Size & Decompression Bomb Limits (FR-DOC-01, EC-13)
    if (input.buffer.length > this.config.maxFileBytes) {
      return {
        success: false,
        documentId: "",
        sha256: "",
        perceptualHash: "",
        mime: detected.mime,
        detectedType: detected,
        pages: [],
        qualityPassed: false,
        flags: ["file_too_large"],
        reasons: [`File size (${input.buffer.length} bytes) exceeds maximum limit (${this.config.maxFileBytes} bytes).`]
      };
    }

    const width = input.declaredWidth || 1920;
    const height = input.declaredHeight || 1080;
    const pixelCount = width * height;

    if (pixelCount > this.config.maxPixels) {
      return {
        success: false,
        documentId: "",
        sha256: "",
        perceptualHash: "",
        mime: detected.mime,
        detectedType: detected,
        pages: [],
        qualityPassed: false,
        flags: ["decompression_bomb_rejected"],
        reasons: [`Decompression bomb hazard: pixel dimensions (${pixelCount} px) exceed ${this.config.maxPixels} px cap (EC-13).`]
      };
    }

    // Step 3: Hashing (SHA-256 + 64-bit dHash) (FR-DOC-01, FR-DOC-05)
    const sha256 = computeSha256(input.buffer);
    const perceptualHash = computePerceptualHash(input.buffer);
    const docId = `doc-${sha256.slice(0, 16)}`;

    // Step 4: Duplicate Detection (FR-DOC-05, EC-05, EC-50)
    let duplicateMatch: { priorSubmissionId: string; reason: string } | undefined;
    for (const prior of priorDocuments) {
      const dupCheck = isDuplicateDocument(
        { sha256, perceptualHash },
        prior,
        this.config.phashMaxDistance
      );
      if (dupCheck.isDuplicate) {
        flags.push("possible_duplicate_file");
        duplicateMatch = {
          priorSubmissionId: prior.submissionId,
          reason: dupCheck.reason!
        };
        break;
      }
    }

    // Step 5: PDF Page Processing (FR-DOC-03)
    let pagesToProcess: Array<{ pageNumber: number; buffer: Uint8Array }> = [];
    if (detected.mime === "application/pdf") {
      const pdfRes = this.pdfRenderer.renderPdf(input.buffer);
      if (pdfRes.exceededMaxPages) {
        flags.push("pdf_pages_capped");
      }
      pagesToProcess = pdfRes.pages.map(p => ({
        pageNumber: p.pageNumber,
        buffer: p.imageBuffer
      }));
    } else {
      pagesToProcess = [{ pageNumber: 1, buffer: input.buffer }];
    }

    // Step 6: Pre-AI Quality Gate (FR-DOC-02, EC-01)
    const variance = input.estimatedLaplacianVariance !== undefined ? input.estimatedLaplacianVariance : 150.0;
    const qualityResult = evaluateQuality(width, height, variance, {
      maxPixels: this.config.maxPixels,
      minPixels: this.config.minPixels,
      minLaplacianVariance: this.config.minLaplacianVariance
    });

    if (!qualityResult.passed) {
      if (input.useAnyway) {
        flags.push("low_quality"); // Overridden: forces at least Tier 2 per PRD FR-DOC-02
      } else {
        return {
          success: false,
          documentId: docId,
          sha256,
          perceptualHash,
          mime: detected.mime,
          detectedType: detected,
          pages: [],
          qualityPassed: false,
          flags: ["needs_retake"],
          reasons: qualityResult.reasons
        };
      }
    }

    // Step 7: Working Copy Normalization (FR-DOC-01, FR-DOC-04)
    // Scale dimensions so max edge <= workingMaxEdgePx
    const scale = Math.min(1.0, this.config.workingMaxEdgePx / Math.max(width, height));
    const workingWidth = Math.round(width * scale);
    const workingHeight = Math.round(height * scale);

    const pages: ProcessedPageArtifact[] = pagesToProcess.map(p => ({
      pageNumber: p.pageNumber,
      width: workingWidth,
      height: workingHeight,
      rotationNeeded: qualityResult.rotationNeeded,
      buffer: p.buffer
    }));

    return {
      success: true,
      documentId: docId,
      sha256,
      perceptualHash,
      mime: detected.mime,
      detectedType: detected,
      pages,
      qualityPassed: qualityResult.passed || !!input.useAnyway,
      flags,
      reasons,
      duplicateMatch
    };
  }
}
