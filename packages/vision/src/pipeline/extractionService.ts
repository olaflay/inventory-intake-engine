import type { ExtractionResult, IVisionProvider, IReasoningProvider } from "../types.js";
import { PromptBuilder, type PromptBuilderOptions } from "../prompts/promptBuilder.js";
import { EvidenceValidator, type EvidenceValidatorOptions } from "./evidenceValidator.js";
import { CostTracker, type CostLimitsConfig } from "./costTracker.js";

export interface ExtractionServiceConfig {
  primaryVisionProvider: IVisionProvider;
  escalationReasoningProvider?: IReasoningProvider;
  costLimits: CostLimitsConfig;
  evidenceOptions?: EvidenceValidatorOptions;
}

export interface ExtractionInput {
  imageBuffer: Buffer;
  mimeType: string;
  userText?: string;
  promptOptions?: PromptBuilderOptions;
  estimatedTokens?: number;
}

export class ExtractionService {
  private primaryProvider: IVisionProvider;
  private escalationProvider?: IReasoningProvider;
  private evidenceValidator: EvidenceValidator;
  private costTracker: CostTracker;

  constructor(config: ExtractionServiceConfig) {
    if (!config || !config.primaryVisionProvider) {
      throw new Error("ExtractionService requires primaryVisionProvider configured (LD-5: no defaults in code).");
    }
    this.primaryProvider = config.primaryVisionProvider;
    this.escalationProvider = config.escalationReasoningProvider;
    this.evidenceValidator = new EvidenceValidator(config.evidenceOptions);
    this.costTracker = new CostTracker(config.costLimits);
  }

  getCostTracker(): CostTracker {
    return this.costTracker;
  }

  getEvidenceValidator(): EvidenceValidator {
    return this.evidenceValidator;
  }

  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    const startTime = Date.now();
    const estTokens = input.estimatedTokens || 1500;

    // 1. Pre-call budget and token ceiling enforcement (FR-EXT-05)
    this.costTracker.checkPreCallLimits(estTokens);

    // 2. Build structured prompt with stable prefix (FR-EXT-01, PRD §15.5)
    const { promptText, hasInjectionRisk } = PromptBuilder.buildPrompt({
      ...input.promptOptions,
      userMessage: input.userText
    });

    let rawExtraction: any;
    let modelUsed = this.primaryProvider.modelId || "primary-model";
    let tokensIn = 0;
    let tokensOut = 0;

    try {
      // 3. Invoke Primary Multimodal Vision Model
      const primaryRes = await this.primaryProvider.extractDocument(
        input.imageBuffer,
        input.mimeType,
        promptText
      );

      rawExtraction = primaryRes.rawJson;
      modelUsed = primaryRes.modelUsed || modelUsed;
      tokensIn = primaryRes.tokensIn || 1200;
      tokensOut = primaryRes.tokensOut || 400;
    } catch (primaryErr: any) {
      const errMessage = String(primaryErr.message || "");
      
      // If primary output was malformed JSON or failed schema, escalate to reasoning repair
      if ((errMessage.includes("JSON") || errMessage.includes("SyntaxError") || errMessage.includes("repair")) && this.escalationProvider) {
        try {
          const repaired = await this.escalationProvider.repairJson(
            errMessage,
            "Structured extraction result matching PRD §17 schema"
          );
          rawExtraction = repaired;
          const escModel = this.escalationProvider.modelId || "escalation-model";
          modelUsed = `${modelUsed}+${escModel}`;
          tokensIn += 1000;
          tokensOut += 500;
        } catch (repairErr) {
          // Both models failed; mark for human review per FR-EXT-01
          return {
            schema_version: "1.0",
            doc_type_key: "other",
            header: { documentType: "unknown" },
            lines: [],
            rotationNeeded: 0,
            warnings: ["Extraction syntax error: failed primary and escalation repair. Marked NEEDS_REVIEW."],
            injection_suspected: hasInjectionRisk,
            costUsdEst: 0.001,
            latencyMs: Date.now() - startTime
          };
        }
      } else {
        throw primaryErr;
      }
    }

    // 4. Record usage and calculate cost (FR-EXT-05)
    const usage = this.costTracker.recordUsage(tokensIn, tokensOut, modelUsed);

    // 5. Post-process and enforce Evidence Rule (FR-EXT-02)
    const latencyMs = Date.now() - startTime;
    rawExtraction.tokensIn = tokensIn;
    rawExtraction.tokensOut = tokensOut;
    rawExtraction.modelUsed = modelUsed;
    rawExtraction.costUsdEst = usage.callCostUsd;
    rawExtraction.latencyMs = latencyMs;

    return this.evidenceValidator.validateExtractionResult(rawExtraction, {
      hasInjectionRisk
    });
  }
}
