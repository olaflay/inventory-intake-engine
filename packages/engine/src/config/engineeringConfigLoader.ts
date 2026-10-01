import crypto from "node:crypto";

export interface ModelDefinition {
  provider: string;
  model_id: string;
  temperature: number;
  max_output_tokens: number;
  timeout_ms: number;
  endpoint?: string;
  endpoint_base?: string;
  description?: string;
}

export interface ModelPricingItem {
  promptTokenUsd: number;
  candidateTokenUsd: number;
}

export interface CostLimitsDefinition {
  max_tokens_per_submission: number;
  monthly_spend_alert_usd: number;
  monthly_spend_hard_cap_usd: number;
  model_pricing?: Record<string, ModelPricingItem>;
}

export interface ModelsConfig {
  version: string;
  primary_model: ModelDefinition;
  escalation_model: ModelDefinition;
  escalation_triggers: string[];
  cost_limits: CostLimitsDefinition;
}

export interface MatchingEngineConfig {
  version: string;
  fuzzy: {
    min_length: number;
    max_distance: number;
    short_numeric_exact_only: boolean;
  };
  penalties: {
    confusion_pair_cost: number;
    standard_edit_cost: number;
  };
  serial: {
    ignorable_chars: string[];
    separators: string[];
    part_min_length: number;
  };
  thresholds: {
    candidate_min_score: number;
    max_candidates: number;
    description_similarity_min: number;
  };
  distinguishing_tokens?: string[][];
  null_serial_tokens?: string[];
}

export interface DocumentsEngineConfig {
  version: string;
  allowed_mime: string[];
  caps: {
    max_file_bytes: number;
    max_pixels: number;
    max_pdf_pages: number;
    working_max_edge_px: number;
    pdf_dpi: number;
  };
  quality_thresholds: {
    min_laplacian_variance: number;
    min_brightness: number;
    max_brightness: number;
    phash_max_distance: number;
  };
}

export interface ExportTemplateColumnConfig {
  key: string;
  column: string;
}

export interface ExportTemplateSheetConfig {
  sheet_name: string;
  category_code: string;
  first_data_row: number;
  totals_column: string;
  totals_label_column: string;
  totals_label: string;
  columns: ExportTemplateColumnConfig[];
}

export interface LocationExportRuleConfig {
  location_type?: string;
  location_name?: string;
  mark_column: string;
  remark_column: string;
  mark_value: string;
  remark_template?: string;
}

export interface ExportSummarySheetConfig {
  sheet_name: string;
  first_data_row: number;
  label_column: string;
  total_column: string;
  totals_label: string;
}

export interface ExportEngineConfig {
  version: string;
  filename_pattern: string;
  serial_separator: string;
  sheets: ExportTemplateSheetConfig[];
  summary: ExportSummarySheetConfig;
  location_export_rules: LocationExportRuleConfig[];
}

export interface EngineeringConfigBundle {
  models: ModelsConfig;
  matching: MatchingEngineConfig;
  documents: DocumentsEngineConfig;
  export?: ExportEngineConfig;
}

export interface ValidatedEngineeringSnapshot {
  id: string;
  sha256: string;
  bundle: EngineeringConfigBundle;
  valid: boolean;
  createdAt: string;
}

/** A single spreadsheet column letter, e.g. 'A' or 'AA'. Case-insensitive. */
const SPREADSHEET_COLUMN_PATTERN = /^[A-Za-z]{1,3}$/;

/**
 * Excel forbids these characters in a worksheet name and caps the length at 31.
 * Validating here means a template rename is a load-time failure, not a
 * silently renamed sheet in the produced file.
 */
const EXPORT_SHEET_NAME_PATTERN = /^[^\\/?*[\]:]{1,31}$/;

/** Reject a duplicated identifier instead of letting one silently overwrite another. */
function assertDistinct(scope: string, label: string, values: string[]): void {
  const seen = new Set<string>();
  for (const value of values) {
    const key = value.toUpperCase();
    if (seen.has(key)) {
      throw new Error(`EngineeringConfig Invalid (LD-5): Export ${scope} declares a duplicate ${label} '${value}'`);
    }
    seen.add(key);
  }
}

/**
 * EngineeringConfigLoader (LD-5: No defaults in code)
 * Enforces strict validation of engineering configurations.
 * If any required key is missing, validation fails immediately.
 */
export class EngineeringConfigLoader {
  validateModelsConfig(config: any): ModelsConfig {
    if (!config) throw new Error("EngineeringConfig Invalid (LD-5): Models config cannot be null or undefined");
    if (!config.version) throw new Error("EngineeringConfig Invalid (LD-5): Models config missing 'version'");

    // Primary model validation
    const primary = config.primary_model;
    if (!primary) throw new Error("EngineeringConfig Invalid (LD-5): Models config missing 'primary_model'");
    if (!primary.provider) throw new Error("EngineeringConfig Invalid (LD-5): primary_model missing 'provider'");
    if (!primary.model_id) throw new Error("EngineeringConfig Invalid (LD-5): primary_model missing 'model_id'");
    if (primary.temperature === undefined || primary.temperature === null) throw new Error("EngineeringConfig Invalid (LD-5): primary_model missing 'temperature'");
    if (!primary.max_output_tokens) throw new Error("EngineeringConfig Invalid (LD-5): primary_model missing 'max_output_tokens'");
    if (!primary.timeout_ms) throw new Error("EngineeringConfig Invalid (LD-5): primary_model missing 'timeout_ms'");

    // Escalation model validation
    const esc = config.escalation_model;
    if (!esc) throw new Error("EngineeringConfig Invalid (LD-5): Models config missing 'escalation_model'");
    if (!esc.provider) throw new Error("EngineeringConfig Invalid (LD-5): escalation_model missing 'provider'");
    if (!esc.model_id) throw new Error("EngineeringConfig Invalid (LD-5): escalation_model missing 'model_id'");
    if (esc.temperature === undefined || esc.temperature === null) throw new Error("EngineeringConfig Invalid (LD-5): escalation_model missing 'temperature'");
    if (!esc.max_output_tokens) throw new Error("EngineeringConfig Invalid (LD-5): escalation_model missing 'max_output_tokens'");
    if (!esc.timeout_ms) throw new Error("EngineeringConfig Invalid (LD-5): escalation_model missing 'timeout_ms'");

    // Escalation triggers
    if (!Array.isArray(config.escalation_triggers) || config.escalation_triggers.length === 0) {
      throw new Error("EngineeringConfig Invalid (LD-5): Models config missing non-empty 'escalation_triggers'");
    }

    // Cost limits
    const costs = config.cost_limits;
    if (!costs) throw new Error("EngineeringConfig Invalid (LD-5): Models config missing 'cost_limits'");
    if (!costs.max_tokens_per_submission) throw new Error("EngineeringConfig Invalid (LD-5): cost_limits missing 'max_tokens_per_submission'");
    if (!costs.monthly_spend_alert_usd) throw new Error("EngineeringConfig Invalid (LD-5): cost_limits missing 'monthly_spend_alert_usd'");
    if (!costs.monthly_spend_hard_cap_usd) throw new Error("EngineeringConfig Invalid (LD-5): cost_limits missing 'monthly_spend_hard_cap_usd'");

    return config as ModelsConfig;
  }

  validateMatchingConfig(config: any): MatchingEngineConfig {
    if (!config) throw new Error("EngineeringConfig Invalid (LD-5): Matching config cannot be null or undefined");
    if (!config.version) throw new Error("EngineeringConfig Invalid (LD-5): Matching config missing 'version'");

    // Fuzzy
    const fuzzy = config.fuzzy;
    if (!fuzzy) throw new Error("EngineeringConfig Invalid (LD-5): Matching config missing 'fuzzy'");
    if (fuzzy.min_length === undefined) throw new Error("EngineeringConfig Invalid (LD-5): fuzzy missing 'min_length'");
    if (fuzzy.max_distance === undefined) throw new Error("EngineeringConfig Invalid (LD-5): fuzzy missing 'max_distance'");
    if (fuzzy.short_numeric_exact_only === undefined) throw new Error("EngineeringConfig Invalid (LD-5): fuzzy missing 'short_numeric_exact_only'");

    // Penalties
    const penalties = config.penalties;
    if (!penalties) throw new Error("EngineeringConfig Invalid (LD-5): Matching config missing 'penalties'");
    if (penalties.confusion_pair_cost === undefined) throw new Error("EngineeringConfig Invalid (LD-5): penalties missing 'confusion_pair_cost'");
    if (penalties.standard_edit_cost === undefined) throw new Error("EngineeringConfig Invalid (LD-5): penalties missing 'standard_edit_cost'");

    // Serial
    const serial = config.serial;
    if (!serial) throw new Error("EngineeringConfig Invalid (LD-5): Matching config missing 'serial'");
    if (!Array.isArray(serial.ignorable_chars)) throw new Error("EngineeringConfig Invalid (LD-5): serial missing 'ignorable_chars'");
    if (!Array.isArray(serial.separators)) throw new Error("EngineeringConfig Invalid (LD-5): serial missing 'separators'");
    if (serial.part_min_length === undefined) throw new Error("EngineeringConfig Invalid (LD-5): serial missing 'part_min_length'");

    // Thresholds
    const thresholds = config.thresholds;
    if (!thresholds) throw new Error("EngineeringConfig Invalid (LD-5): Matching config missing 'thresholds'");
    if (thresholds.candidate_min_score === undefined) throw new Error("EngineeringConfig Invalid (LD-5): thresholds missing 'candidate_min_score'");
    if (thresholds.max_candidates === undefined) throw new Error("EngineeringConfig Invalid (LD-5): thresholds missing 'max_candidates'");
    if (thresholds.description_similarity_min === undefined) throw new Error("EngineeringConfig Invalid (LD-5): thresholds missing 'description_similarity_min'");

    return config as MatchingEngineConfig;
  }

  validateDocumentsConfig(config: any): DocumentsEngineConfig {
    if (!config) throw new Error("EngineeringConfig Invalid (LD-5): Documents config cannot be null or undefined");
    if (!config.version) throw new Error("EngineeringConfig Invalid (LD-5): Documents config missing 'version'");
    if (!Array.isArray(config.allowed_mime) || config.allowed_mime.length === 0) {
      throw new Error("EngineeringConfig Invalid (LD-5): Documents config missing non-empty 'allowed_mime'");
    }

    // Caps
    const caps = config.caps;
    if (!caps) throw new Error("EngineeringConfig Invalid (LD-5): Documents config missing 'caps'");
    if (!caps.max_file_bytes) throw new Error("EngineeringConfig Invalid (LD-5): caps missing 'max_file_bytes'");
    if (!caps.max_pixels) throw new Error("EngineeringConfig Invalid (LD-5): caps missing 'max_pixels'");
    if (!caps.max_pdf_pages) throw new Error("EngineeringConfig Invalid (LD-5): caps missing 'max_pdf_pages'");
    if (!caps.working_max_edge_px) throw new Error("EngineeringConfig Invalid (LD-5): caps missing 'working_max_edge_px'");
    if (!caps.pdf_dpi) throw new Error("EngineeringConfig Invalid (LD-5): caps missing 'pdf_dpi'");

    // Quality thresholds
    const qt = config.quality_thresholds;
    if (!qt) throw new Error("EngineeringConfig Invalid (LD-5): Documents config missing 'quality_thresholds'");
    if (qt.min_laplacian_variance === undefined) throw new Error("EngineeringConfig Invalid (LD-5): quality_thresholds missing 'min_laplacian_variance'");
    if (qt.min_brightness === undefined) throw new Error("EngineeringConfig Invalid (LD-5): quality_thresholds missing 'min_brightness'");
    if (qt.max_brightness === undefined) throw new Error("EngineeringConfig Invalid (LD-5): quality_thresholds missing 'max_brightness'");
    if (qt.phash_max_distance === undefined) throw new Error("EngineeringConfig Invalid (LD-5): quality_thresholds missing 'phash_max_distance'");

    return config as DocumentsEngineConfig;
  }

  /**
   * Export template profile (FR-EXP-01, LD-5).
   * Every column letter, sheet name and filename token is validated so a
   * renamed sheet or column in the controlled form is caught at load time
   * rather than producing a silently misaligned export.
   */
  validateExportConfig(config: any): ExportEngineConfig {
    if (!config) throw new Error("EngineeringConfig Invalid (LD-5): Export config cannot be null or undefined");
    if (!config.version) throw new Error("EngineeringConfig Invalid (LD-5): Export config missing 'version'");
    if (!config.filename_pattern) throw new Error("EngineeringConfig Invalid (LD-5): Export config missing 'filename_pattern'");
    if (!config.filename_pattern.includes("{date}")) {
      throw new Error("EngineeringConfig Invalid (LD-5): Export filename_pattern must contain '{date}' so exports never overwrite");
    }
    if (config.serial_separator === undefined || config.serial_separator === null) {
      throw new Error("EngineeringConfig Invalid (LD-5): Export config missing 'serial_separator'");
    }

    if (!Array.isArray(config.sheets) || config.sheets.length === 0) {
      throw new Error("EngineeringConfig Invalid (LD-5): Export config missing non-empty 'sheets'");
    }
    for (const sheet of config.sheets) {
      if (!sheet.sheet_name) throw new Error("EngineeringConfig Invalid (LD-5): Export sheet missing 'sheet_name'");
      if (!sheet.category_code) throw new Error(`EngineeringConfig Invalid (LD-5): Export sheet '${sheet.sheet_name}' missing 'category_code'`);
      if (sheet.first_data_row === undefined || sheet.first_data_row < 1) {
        throw new Error(`EngineeringConfig Invalid (LD-5): Export sheet '${sheet.sheet_name}' missing 'first_data_row'`);
      }
      if (!sheet.totals_column) throw new Error(`EngineeringConfig Invalid (LD-5): Export sheet '${sheet.sheet_name}' missing 'totals_column'`);
      if (!sheet.totals_label_column) throw new Error(`EngineeringConfig Invalid (LD-5): Export sheet '${sheet.sheet_name}' missing 'totals_label_column'`);
      if (!sheet.totals_label) throw new Error(`EngineeringConfig Invalid (LD-5): Export sheet '${sheet.sheet_name}' missing 'totals_label'`);
      if (!Array.isArray(sheet.columns) || sheet.columns.length === 0) {
        throw new Error(`EngineeringConfig Invalid (LD-5): Export sheet '${sheet.sheet_name}' missing 'columns'`);
      }
      if (!EXPORT_SHEET_NAME_PATTERN.test(sheet.sheet_name)) {
        throw new Error(
          `EngineeringConfig Invalid (LD-5): Export sheet name '${sheet.sheet_name}' contains characters Excel forbids in a worksheet name`
        );
      }
      for (const column of sheet.columns) {
        if (!column.key) throw new Error(`EngineeringConfig Invalid (LD-5): Export sheet '${sheet.sheet_name}' has a column with no 'key'`);
        if (!column.column) throw new Error(`EngineeringConfig Invalid (LD-5): Export sheet '${sheet.sheet_name}' column '${column.key}' missing 'column'`);
        if (!SPREADSHEET_COLUMN_PATTERN.test(column.column)) {
          throw new Error(
            `EngineeringConfig Invalid (LD-5): Export sheet '${sheet.sheet_name}' column '${column.key}' uses '${column.column}', which is not a spreadsheet column letter`
          );
        }
      }
      if (!sheet.columns.some((c: ExportTemplateColumnConfig) => c.key === "internal_ref")) {
        throw new Error(`EngineeringConfig Invalid (LD-5): Export sheet '${sheet.sheet_name}' must declare an 'internal_ref' column`);
      }
      assertDistinct(sheet.sheet_name, "column key", sheet.columns.map((c: ExportTemplateColumnConfig) => c.key));
      assertDistinct(sheet.sheet_name, "column letter", sheet.columns.map((c: ExportTemplateColumnConfig) => c.column.toUpperCase()));

      // Totals must not land on an item column or the totals row would corrupt data.
      const itemColumns = new Set(sheet.columns.map((c: ExportTemplateColumnConfig) => c.column.toUpperCase()));
      if (!SPREADSHEET_COLUMN_PATTERN.test(sheet.totals_column)) {
        throw new Error(
          `EngineeringConfig Invalid (LD-5): Export sheet '${sheet.sheet_name}' totals column '${sheet.totals_column}' is not a spreadsheet column letter`
        );
      }
      if (!SPREADSHEET_COLUMN_PATTERN.test(sheet.totals_label_column)) {
        throw new Error(
          `EngineeringConfig Invalid (LD-5): Export sheet '${sheet.sheet_name}' totals label column '${sheet.totals_label_column}' is not a spreadsheet column letter`
        );
      }
      if (sheet.totals_column.toUpperCase() === sheet.totals_label_column.toUpperCase()) {
        throw new Error(
          `EngineeringConfig Invalid (LD-5): Export sheet '${sheet.sheet_name}' uses column '${sheet.totals_column}' for both the totals value and its label`
        );
      }
      for (const totalsCol of [sheet.totals_column, sheet.totals_label_column]) {
        if (itemColumns.has(totalsCol.toUpperCase())) {
          throw new Error(
            `EngineeringConfig Invalid (LD-5): Export sheet '${sheet.sheet_name}' puts totals in column '${totalsCol}', which is also an item column`
          );
        }
      }
    }

    assertDistinct("config", "sheet name", config.sheets.map((s: ExportTemplateSheetConfig) => s.sheet_name));
    assertDistinct(
      "config",
      "category code",
      config.sheets.map((s: ExportTemplateSheetConfig) => s.category_code)
    );

    const summary = config.summary;
    if (!summary) throw new Error("EngineeringConfig Invalid (LD-5): Export config missing 'summary'");
    if (!summary.sheet_name) throw new Error("EngineeringConfig Invalid (LD-5): Export summary missing 'sheet_name'");
    if (summary.first_data_row === undefined || summary.first_data_row < 1) {
      throw new Error("EngineeringConfig Invalid (LD-5): Export summary missing 'first_data_row'");
    }
    if (!summary.label_column) throw new Error("EngineeringConfig Invalid (LD-5): Export summary missing 'label_column'");
    if (!summary.total_column) throw new Error("EngineeringConfig Invalid (LD-5): Export summary missing 'total_column'");
    if (!summary.totals_label) throw new Error("EngineeringConfig Invalid (LD-5): Export summary missing 'totals_label'");
    if (!EXPORT_SHEET_NAME_PATTERN.test(summary.sheet_name)) {
      throw new Error(
        `EngineeringConfig Invalid (LD-5): Export summary sheet name '${summary.sheet_name}' contains characters Excel forbids in a worksheet name`
      );
    }
    for (const summaryCol of [summary.label_column, summary.total_column]) {
      if (!SPREADSHEET_COLUMN_PATTERN.test(summaryCol)) {
        throw new Error(
          `EngineeringConfig Invalid (LD-5): Export summary column '${summaryCol}' is not a spreadsheet column letter`
        );
      }
    }
    if (summary.label_column.toUpperCase() === summary.total_column.toUpperCase()) {
      throw new Error(
        "EngineeringConfig Invalid (LD-5): Export summary uses one column for both the label and the total"
      );
    }
    // A summary sheet that shadows a category sheet would send its grand-total
    // formula onto the wrong sheet.
    const clash = config.sheets.find((s: ExportTemplateSheetConfig) => s.sheet_name === summary.sheet_name);
    if (clash) {
      throw new Error(
        `EngineeringConfig Invalid (LD-5): Export summary sheet name '${summary.sheet_name}' is already used by category '${clash.category_code}'`
      );
    }

    if (!Array.isArray(config.location_export_rules) || config.location_export_rules.length === 0) {
      throw new Error("EngineeringConfig Invalid (LD-5): Export config missing non-empty 'location_export_rules'");
    }
    for (const rule of config.location_export_rules) {
      if (!rule.location_type && !rule.location_name) {
        throw new Error("EngineeringConfig Invalid (LD-5): Export location rule must declare 'location_type' or 'location_name'");
      }
      if (!rule.mark_column) throw new Error("EngineeringConfig Invalid (LD-5): Export location rule missing 'mark_column'");
      if (!rule.remark_column) throw new Error("EngineeringConfig Invalid (LD-5): Export location rule missing 'remark_column'");
      if (rule.mark_value === undefined || rule.mark_value === null) {
        throw new Error("EngineeringConfig Invalid (LD-5): Export location rule missing 'mark_value'");
      }
      for (const ruleCol of [rule.mark_column, rule.remark_column]) {
        if (!SPREADSHEET_COLUMN_PATTERN.test(ruleCol)) {
          throw new Error(
            `EngineeringConfig Invalid (LD-5): Export location rule column '${ruleCol}' is not a spreadsheet column letter`
          );
        }
      }
      if (rule.mark_column.toUpperCase() === rule.remark_column.toUpperCase()) {
        throw new Error(
          "EngineeringConfig Invalid (LD-5): Export location rule uses one column for both the mark and the remark"
        );
      }
    }
    assertDistinct(
      "location rule",
      "location_name",
      config.location_export_rules
        .filter((r: LocationExportRuleConfig) => r.location_name !== undefined)
        .map((r: LocationExportRuleConfig) => r.location_name as string)
    );
    // Resolution takes the first match, so two rules for one type would make
    // the mark depend on declaration order.
    assertDistinct(
      "location rule",
      "location_type",
      config.location_export_rules
        .filter((r: LocationExportRuleConfig) => r.location_type !== undefined)
        .map((r: LocationExportRuleConfig) => r.location_type as string)
    );

    return config as ExportEngineConfig;
  }

  validateAndCreateSnapshot(bundle: EngineeringConfigBundle): ValidatedEngineeringSnapshot {
    this.validateModelsConfig(bundle.models);
    this.validateMatchingConfig(bundle.matching);
    this.validateDocumentsConfig(bundle.documents);
    if (bundle.export) {
      this.validateExportConfig(bundle.export);
    }

    const serialized = JSON.stringify(bundle);
    const sha256 = crypto.createHash("sha256").update(serialized).digest("hex");

    return {
      id: `eng-cfg-${sha256.slice(0, 16)}`,
      sha256,
      bundle,
      valid: true,
      createdAt: new Date().toISOString()
    };
  }
}
