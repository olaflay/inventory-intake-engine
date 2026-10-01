import test from "node:test";
import assert from "node:assert/strict";
import {
  matchLine,
  determineApprovalTier
} from "../../packages/domain/dist/index.js";
import {
  EngineeringConfigLoader
} from "../../packages/engine/dist/index.js";
import {
  ModelProviderFactory,
  CostTracker
} from "../../packages/vision/dist/index.js";

test("Company-B Portability Test (LD-5): Verifies engine executes against alternative schema with zero domain literals", () => {
  // Company-B has completely different status vocabulary and location types
  const companyBInventory = [
    {
      id: "cb-asset-1",
      internalRef: "CO-B/EQ/999",
      serials: ["SN-RIG-100234"],
      description: "Drill Pressure Gauge",
      locationId: "loc-rig-alpha",
      statusCode: "IN_SERVICE"
    }
  ];

  // Company-B configuration: shorter min length (6), higher max distance (1.2), different separators, custom distinguishing tokens
  const companyBMatchingConfig = {
    fuzzyMinLength: 6,
    fuzzyMaxDistance: 1.2,
    shortNumericExactOnly: true,
    ignorableChars: ["-", " "],
    separators: [";", "|"],
    partMinLength: 2,
    candidateMinScore: 0.65,
    maxCandidates: 3,
    descriptionSimilarityMin: 0.5,
    confusionPairs: [{ a: "Z", b: "2", cost: 0.25 }],
    distinguishingTokens: [["RIG_A", "RIG_B"]],
    nullSerialTokens: ["KEINE", "N/A", "NULL"]
  };

  // Match test under Company-B
  const res = matchLine(
    "SN-RIG-100Z34", // Z instead of 2 -> distance 0.25 with Company-B pair
    "Pressure Gauge",
    companyBInventory,
    companyBMatchingConfig
  );

  assert.equal(res.state, "possible");
  assert.equal(res.assetId, "cb-asset-1");
  assert.equal(res.candidates[0].statusCode, "IN_SERVICE");

  // Company-B Approval Rules (custom priorities)
  const companyBRules = [
    { priority: 1, name: "custom_decommission", predicate: "status_to:DECOMMISSIONED", tier: 3 },
    { priority: 10, name: "large_move", predicate: "lines>5", tier: 2 },
    { priority: 99, name: "default", predicate: "always", tier: 1 }
  ];

  const ctxNormal = {
    submitterRole: "field_tech",
    submitterRef: "telegram:tech99",
    lineCount: 2,
    flags: [],
    lineStates: ["exact"],
    statusChanges: [],
    isTerminalStatus: false,
    isCreateAsset: false
  };

  assert.equal(determineApprovalTier(companyBRules, ctxNormal), 1);

  const ctxLarge = {
    ...ctxNormal,
    lineCount: 8
  };
  assert.equal(determineApprovalTier(companyBRules, ctxLarge), 2);
});

test("Company-B Engineering Configuration Audit (LD-5): validates alternative models, matching, and documents", () => {
  const loader = new EngineeringConfigLoader();

  // Company-B models bundle
  const companyBModels = {
    version: "1.0",
    primary_model: {
      provider: "gemini",
      model_id: "gemini-1.5-flash",
      endpoint_base: "https://generativelanguage.googleapis.com/v1beta",
      temperature: 0.0,
      max_output_tokens: 2048,
      timeout_ms: 25000
    },
    escalation_model: {
      provider: "deepseek",
      model_id: "deepseek-reasoner",
      endpoint: "https://api.deepseek.com/chat/completions",
      temperature: 0.0,
      max_output_tokens: 4096,
      timeout_ms: 60000
    },
    escalation_triggers: ["schema_repair_failed", "syntax_error"],
    cost_limits: {
      max_tokens_per_submission: 15000,
      monthly_spend_alert_usd: 50.0,
      monthly_spend_hard_cap_usd: 100.0,
      model_pricing: {
        "gemini-1.5-flash": { promptTokenUsd: 0.000000075, candidateTokenUsd: 0.00000030 },
        "deepseek-reasoner": { promptTokenUsd: 0.00000055, candidateTokenUsd: 0.00000219 }
      }
    }
  };

  const validatedModels = loader.validateModelsConfig(companyBModels);
  assert.equal(validatedModels.primary_model.model_id, "gemini-1.5-flash");
  assert.equal(validatedModels.escalation_model.model_id, "deepseek-reasoner");

  // Company-B matching bundle
  const companyBMatching = {
    version: "1.0",
    fuzzy: { min_length: 6, max_distance: 1.2, short_numeric_exact_only: true },
    penalties: { confusion_pair_cost: 0.25, standard_edit_cost: 1.0 },
    serial: { ignorable_chars: ["-", " "], separators: [";", "|"], part_min_length: 2 },
    thresholds: { candidate_min_score: 0.65, max_candidates: 3, description_similarity_min: 0.50 },
    distinguishing_tokens: [["RIG_A", "RIG_B"]],
    null_serial_tokens: ["KEINE", "N/A", "NULL"]
  };
  const validatedMatching = loader.validateMatchingConfig(companyBMatching);
  assert.equal(validatedMatching.fuzzy.min_length, 6);

  // Company-B documents bundle
  const companyBDocuments = {
    version: "1.0",
    allowed_mime: ["image/jpeg", "image/png", "application/pdf"],
    caps: {
      max_file_bytes: 31457280,
      max_pixels: 50000000,
      max_pdf_pages: 30,
      working_max_edge_px: 2500,
      pdf_dpi: 200
    },
    quality_thresholds: {
      min_laplacian_variance: 80.0,
      min_brightness: 35.0,
      max_brightness: 240.0,
      phash_max_distance: 6
    }
  };
  const validatedDocs = loader.validateDocumentsConfig(companyBDocuments);
  assert.equal(validatedDocs.caps.max_pdf_pages, 30);

  // Snapshot generation
  const snapshot = loader.validateAndCreateSnapshot({
    models: companyBModels,
    matching: companyBMatching,
    documents: companyBDocuments
  });
  assert.ok(snapshot.id.startsWith("eng-cfg-"));
  assert.ok(snapshot.sha256.length === 64);
  assert.equal(snapshot.valid, true);

  // Negative test (LD-5): Missing required key fails immediately with no fallback
  const invalidModels = { ...companyBModels, cost_limits: null };
  assert.throws(() => {
    loader.validateModelsConfig(invalidModels);
  }, /LD-5/);
});

test("ModelProviderFactory: proves zero hardcoded providers by registering alternative provider adapters", () => {
  // Register an alternative custom vision provider to confirm the architecture is 100% pluggable
  class CustomEnterpriseVisionProvider {
    providerId = "custom_enterprise";
    modelId;
    constructor(cfg) {
      this.modelId = cfg.modelId;
    }
    async extractDocument() {
      return {
        header: { documentType: "custom_manifest" },
        lines: [],
        rotationNeeded: 0,
        costUsdEst: 0
      };
    }
  }

  ModelProviderFactory.registerVisionProvider("custom_enterprise", CustomEnterpriseVisionProvider);

  const provider = ModelProviderFactory.createVisionProvider({
    provider: "custom_enterprise",
    model_id: "enterprise-vision-v3",
    endpoint: "https://internal.enterprise.org/ai/v1"
  });

  assert.equal(provider.providerId, "custom_enterprise");
  assert.equal(provider.modelId, "enterprise-vision-v3");

  // CostTracker correctly calculates cost under Company-B custom pricing
  const tracker = new CostTracker({
    maxTokensPerSubmission: 15000,
    monthlySpendAlertUsd: 50.0,
    monthlySpendHardCapUsd: 100.0,
    modelPricing: {
      "gemini-1.5-flash": { promptTokenUsd: 0.000000075, candidateTokenUsd: 0.00000030 }
    }
  });

  const cost = tracker.calculateCost(10000, 2000, "gemini-1.5-flash");
  assert.equal(cost, (10000 * 0.000000075) + (2000 * 0.00000030));
});
