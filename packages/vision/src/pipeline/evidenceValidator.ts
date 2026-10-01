import type { Evidenced, ExtractedLine, ExtractionResult, TextHints } from "../types.js";

export interface EvidenceValidatorOptions {
  nullSerialTokens?: string[];
  ignorableChars?: string[];
  compositeSeparators?: string[];
  minCompositePartLength?: number;
}

export class EvidenceValidator {
  private nullSerialTokens: Set<string>;
  private ignorableRegex: RegExp;
  private compositeSeparators: string[];
  private minCompositePartLength: number;

  constructor(options: EvidenceValidatorOptions = {}) {
    const tokens = options.nullSerialTokens || ["N/A", "NA", "NIL", "NONE", "NSN", "UNKNOWN", "-", "NOT APPLICABLE", "NULL"];
    this.nullSerialTokens = new Set(tokens.map(t => t.trim().toUpperCase()));

    const chars = options.ignorableChars || ["-", ".", "/", " ", "#", "_", ":"];
    const escapedChars = chars.map(c => `\\${c}`).join("");
    this.ignorableRegex = new RegExp(`[${escapedChars}]`, "g");

    this.compositeSeparators = options.compositeSeparators || ["/", "&", ",", ";", "+"];
    this.minCompositePartLength = options.minCompositePartLength || 3;
  }

  normalizeSerial(s: string | null | undefined): string {
    if (!s) return "";
    return s.toUpperCase().replace(this.ignorableRegex, "").trim();
  }

  isNullToken(s: string | null | undefined): boolean {
    if (!s) return true;
    const clean = s.trim().toUpperCase();
    return this.nullSerialTokens.has(clean);
  }

  /**
   * Enforces FR-EXT-02 Evidence Rule on a single Evidenced<string> field.
   * Returns sanitized Evidenced field with value verified against evidence_text.
   */
  validateEvidencedString(
    field: Evidenced<string> | undefined | null
  ): { field: Evidenced<string>; isUnread: boolean } {
    if (!field || !field.legible || !field.evidence_text) {
      return {
        field: { value: null, evidence_text: field?.evidence_text || null, legible: false },
        isUnread: true
      };
    }

    const normVal = this.normalizeSerial(field.value);
    const normEvidence = this.normalizeSerial(field.evidence_text);

    if (this.isNullToken(normEvidence) || this.isNullToken(normVal)) {
      return {
        field: { value: null, evidence_text: field.evidence_text, legible: true },
        isUnread: false
      };
    }

    // FR-EXT-02: Normalized value must equal normalized evidence_text.
    // If they differ, the field is unread and never guessed.
    if (normVal !== normEvidence) {
      return {
        field: { value: null, evidence_text: field.evidence_text, legible: false },
        isUnread: true
      };
    }

    return {
      field: { value: field.value ? field.value.trim() : null, evidence_text: field.evidence_text, legible: true },
      isUnread: false
    };
  }

  /**
   * Splits a composite serial string into individual serial strings
   * if separators exist and each part meets minCompositePartLength.
   */
  splitCompositeSerial(serialStr: string): string[] {
    if (!serialStr) return [];
    
    // Check if any separator exists
    const hasSeparator = this.compositeSeparators.some(sep => serialStr.includes(sep));
    if (!hasSeparator) {
      return [serialStr];
    }

    // Split on separators
    const regex = new RegExp(`[${this.compositeSeparators.map(s => `\\${s}`).join("")}]`, "g");
    const parts = serialStr.split(regex).map(p => p.trim()).filter(Boolean);

    // If any non-empty part is below minCompositePartLength, do not split (keep as single entity)
    const allMeetMin = parts.length > 1 && parts.every(p => p.length >= this.minCompositePartLength);
    return allMeetMin ? parts : [serialStr];
  }

  /**
   * Processes all lines in an ExtractionResult according to FR-EXT-02 and §17 post-processing.
   */
  validateExtractionResult(
    rawResult: Record<string, any>,
    options: { hasInjectionRisk?: boolean } = {}
  ): ExtractionResult {
    const warnings: string[] = Array.isArray(rawResult.warnings) ? [...rawResult.warnings] : [];
    let injectionSuspected = options.hasInjectionRisk || false;

    // Check warnings for injection indications
    for (const w of warnings) {
      if (/injection|instruction|override|malicious/i.test(w)) {
        injectionSuspected = true;
      }
    }

    const rawLines = Array.isArray(rawResult.lines) ? rawResult.lines : [];
    const validatedLines: ExtractedLine[] = [];

    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i];
      let lineUnread = false;

      // Validate description
      const descVal = this.validateEvidencedString(line.description);
      
      // Validate asset_no
      const assetVal = this.validateEvidencedString(line.asset_no);

      // Validate serials (composite handling & evidence check)
      const serialList: Evidenced<string>[] = [];
      const rawSerials = Array.isArray(line.serials) ? line.serials : (line.serials ? [line.serials] : []);

      if (rawSerials.length === 0) {
        // Line has no serial
      } else {
        for (const s of rawSerials) {
          const evidencedObj: Evidenced<string> = typeof s === "string"
            ? { value: s, evidence_text: s, legible: true }
            : (s || { value: null, evidence_text: null, legible: false });

          const validated = this.validateEvidencedString(evidencedObj);

          if (validated.isUnread) {
            lineUnread = true;
            serialList.push(validated.field);
          } else if (validated.field.value) {
            // Check for composite serials in evidence
            const splitSerials = this.splitCompositeSerial(validated.field.value);
            for (const sp of splitSerials) {
              if (!this.isNullToken(sp)) {
                serialList.push({
                  value: sp,
                  evidence_text: validated.field.evidence_text,
                  legible: true
                });
              }
            }
          }
        }
      }

      // Validate quantity
      let validQty: Evidenced<number> = { value: 1, evidence_text: "1", legible: true };
      if (line.qty) {
        const numVal = typeof line.qty.value === "number" ? line.qty.value : parseInt(line.qty.value, 10);
        const evidenceNum = parseInt(line.qty.evidence_text || "", 10);
        const legible = line.qty.legible !== false && !isNaN(numVal) && (isNaN(evidenceNum) || numVal === evidenceNum);
        validQty = {
          value: legible && !isNaN(numVal) ? numVal : null,
          evidence_text: line.qty.evidence_text || null,
          legible
        };
      }

      validatedLines.push({
        line_no: line.line_no ?? (i + 1),
        lineNo: line.line_no ?? (i + 1),
        page: line.page ?? 1,
        description: descVal.field,
        itemDescription: descVal.field.value || "",
        asset_no: assetVal.field,
        serials: serialList,
        qty: validQty,
        quantity: validQty.value ?? 1,
        status_text: line.status_text || { value: null, evidence_text: null, legible: true },
        remark: line.remark || { value: null, evidence_text: null, legible: true },
        remarks: typeof line.remark?.value === "string" ? line.remark.value : undefined,
        unread: lineUnread || !descVal.field.legible,
        sourceBox: line.sourceBox
      });
    }

    // Parse header
    const rawHeader = rawResult.header || {};
    const docType = rawResult.doc_type_key || rawHeader.documentType || "unknown";

    const header = {
      documentType: docType,
      documentNo: rawHeader.documentNo?.value ?? rawHeader.documentNo ?? undefined,
      date: rawHeader.date?.value ?? rawHeader.date ?? undefined,
      fromLocation: rawHeader.fromLocation?.value ?? rawHeader.fromLocation ?? undefined,
      toLocation: rawHeader.toLocation?.value ?? rawHeader.toLocation ?? undefined,
      vesselName: rawHeader.vesselName?.value ?? rawHeader.vesselName ?? undefined,
      issuerName: rawHeader.issuerName?.value ?? rawHeader.issuerName ?? undefined,
      receiverName: rawHeader.receiverName?.value ?? rawHeader.receiverName ?? undefined,
      fields: rawHeader
    };

    // Text hints (FR-EXT-04)
    let textHints: TextHints | null = null;
    if (rawResult.text_hints) {
      textHints = {
        operation_key: rawResult.text_hints.operation_key || null,
        destination_text: rawResult.text_hints.destination_text || null,
        source_text: rawResult.text_hints.source_text || null,
        item_refs: Array.isArray(rawResult.text_hints.item_refs) ? rawResult.text_hints.item_refs : []
      };
    }

    const rotation = (rawResult.rotation_needed ?? rawResult.rotationNeeded ?? 0) as 0 | 90 | 180 | 270;

    return {
      schema_version: rawResult.schema_version || "1.0",
      doc_type_key: docType,
      header,
      lines: validatedLines,
      rotation_needed: rotation,
      rotationNeeded: rotation,
      text_hints: textHints,
      warnings,
      injection_suspected: injectionSuspected,
      rawJson: rawResult,
      tokensIn: rawResult.tokensIn || 0,
      tokensOut: rawResult.tokensOut || 0,
      modelUsed: rawResult.modelUsed || "",
      costUsdEst: rawResult.costUsdEst || 0.002,
      latencyMs: rawResult.latencyMs || 0
    };
  }
}
