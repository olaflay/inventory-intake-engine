export interface ModelPricing {
  promptTokenUsd: number; // per token
  candidateTokenUsd: number; // per token
}

export interface CostLimitsConfig {
  maxTokensPerSubmission: number;
  monthlySpendAlertUsd: number;
  monthlySpendHardCapUsd: number;
  modelPricing: Record<string, ModelPricing>;
  defaultPricing?: ModelPricing;
}

export class AiSpendLimitExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiSpendLimitExceededError";
  }
}

export class SubmissionTokenCeilingExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubmissionTokenCeilingExceededError";
  }
}

export class CostTracker {
  private maxTokensPerSubmission: number;
  private monthlySpendAlertUsd: number;
  private monthlySpendHardCapUsd: number;
  private accumulatedSpendUsd: number = 0;
  private totalTokensUsed: number = 0;
  private isAlertTriggered: boolean = false;
  private isHardCapTripped: boolean = false;

  // Pricing loaded dynamically from configuration bundle
  private pricing: Record<string, ModelPricing>;
  private defaultPricing?: ModelPricing;

  constructor(config: CostLimitsConfig) {
    if (!config) {
      throw new Error("CostTracker requires configuration (LD-5: no defaults in code).");
    }
    if (config.maxTokensPerSubmission === undefined || config.maxTokensPerSubmission === null) {
      throw new Error("CostTracker requires maxTokensPerSubmission in configuration (LD-5: no defaults in code).");
    }
    if (config.monthlySpendAlertUsd === undefined || config.monthlySpendAlertUsd === null) {
      throw new Error("CostTracker requires monthlySpendAlertUsd in configuration (LD-5: no defaults in code).");
    }
    if (config.monthlySpendHardCapUsd === undefined || config.monthlySpendHardCapUsd === null) {
      throw new Error("CostTracker requires monthlySpendHardCapUsd in configuration (LD-5: no defaults in code).");
    }
    if (!config.modelPricing && !config.defaultPricing) {
      throw new Error("CostTracker requires modelPricing in configuration (LD-5: no defaults in code).");
    }

    this.maxTokensPerSubmission = config.maxTokensPerSubmission;
    this.monthlySpendAlertUsd = config.monthlySpendAlertUsd;
    this.monthlySpendHardCapUsd = config.monthlySpendHardCapUsd;
    this.pricing = config.modelPricing ? { ...config.modelPricing } : {};
    this.defaultPricing = config.defaultPricing;
  }

  registerModelPricing(modelId: string, pricing: ModelPricing): void {
    this.pricing[modelId] = pricing;
  }

  /**
   * Pre-call check to ensure submission doesn't violate limits.
   */
  checkPreCallLimits(estimatedTokens: number): void {
    if (this.isHardCapTripped || this.accumulatedSpendUsd >= this.monthlySpendHardCapUsd) {
      this.isHardCapTripped = true;
      throw new AiSpendLimitExceededError(
        `Monthly AI spend limit of $${this.monthlySpendHardCapUsd.toFixed(2)} reached. AI extraction is paused.`
      );
    }

    if (estimatedTokens > this.maxTokensPerSubmission) {
      throw new SubmissionTokenCeilingExceededError(
        `Estimated tokens (${estimatedTokens}) exceeds per-submission ceiling (${this.maxTokensPerSubmission}).`
      );
    }
  }

  /**
   * Calculates cost in USD for a given call based on model pricing.
   */
  calculateCost(tokensIn: number, tokensOut: number, modelId: string): number {
    const p = this.pricing[modelId] || this.defaultPricing;
    if (!p) {
      throw new Error(`CostTracker: missing pricing configuration for model '${modelId}' (LD-5: no defaults in code).`);
    }
    return (tokensIn * p.promptTokenUsd) + (tokensOut * p.candidateTokenUsd);
  }

  /**
   * Records usage after a call and returns calculated cost.
   */
  recordUsage(tokensIn: number, tokensOut: number, modelId: string): {
    callCostUsd: number;
    totalSpendUsd: number;
    alertTriggered: boolean;
    hardCapTripped: boolean;
  } {
    const callCost = this.calculateCost(tokensIn, tokensOut, modelId);
    this.accumulatedSpendUsd += callCost;
    this.totalTokensUsed += (tokensIn + tokensOut);

    if (this.accumulatedSpendUsd >= this.monthlySpendAlertUsd && !this.isAlertTriggered) {
      this.isAlertTriggered = true;
    }

    if (this.accumulatedSpendUsd >= this.monthlySpendHardCapUsd) {
      this.isHardCapTripped = true;
    }

    return {
      callCostUsd: callCost,
      totalSpendUsd: this.accumulatedSpendUsd,
      alertTriggered: this.isAlertTriggered,
      hardCapTripped: this.isHardCapTripped
    };
  }

  getMetrics() {
    return {
      accumulatedSpendUsd: this.accumulatedSpendUsd,
      totalTokensUsed: this.totalTokensUsed,
      isAlertTriggered: this.isAlertTriggered,
      isHardCapTripped: this.isHardCapTripped,
      maxTokensPerSubmission: this.maxTokensPerSubmission,
      monthlySpendAlertUsd: this.monthlySpendAlertUsd,
      monthlySpendHardCapUsd: this.monthlySpendHardCapUsd
    };
  }

  reset() {
    this.accumulatedSpendUsd = 0;
    this.totalTokensUsed = 0;
    this.isAlertTriggered = false;
    this.isHardCapTripped = false;
  }
}
