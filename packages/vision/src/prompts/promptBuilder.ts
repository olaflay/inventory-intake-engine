import { EXTRACTION_SYSTEM_PROMPT } from "./systemPrompts.js";

export interface DocumentTypeDefinition {
  key: string;
  name: string;
  cues: string[];
  expectedHeaders: string[];
}

export interface PromptBuilderOptions {
  documentTypes?: DocumentTypeDefinition[];
  schemaDescription?: string;
  fewShotExamples?: string[];
  userMessage?: string;
}

export const CANONICAL_OUTPUT_SCHEMA_DESC = `{
  "schema_version": "1.0",
  "doc_type_key": "string (from configured document types or 'other')",
  "rotation_needed": 0 | 90 | 180 | 270,
  "header": {
    "documentNo": { "value": string | null, "evidence_text": string | null, "legible": boolean },
    "date": { "value": string | null, "evidence_text": string | null, "legible": boolean },
    "fromLocation": { "value": string | null, "evidence_text": string | null, "legible": boolean },
    "toLocation": { "value": string | null, "evidence_text": string | null, "legible": boolean },
    "vesselName": { "value": string | null, "evidence_text": string | null, "legible": boolean },
    "issuerName": { "value": string | null, "evidence_text": string | null, "legible": boolean },
    "receiverName": { "value": string | null, "evidence_text": string | null, "legible": boolean }
  },
  "lines": [
    {
      "line_no": number | null,
      "page": number,
      "description": { "value": string | null, "evidence_text": string | null, "legible": boolean },
      "asset_no": { "value": string | null, "evidence_text": string | null, "legible": boolean },
      "serials": [
        { "value": string | null, "evidence_text": string | null, "legible": boolean }
      ],
      "qty": { "value": number | null, "evidence_text": string | null, "legible": boolean },
      "status_text": { "value": string | null, "evidence_text": string | null, "legible": boolean },
      "remark": { "value": string | null, "evidence_text": string | null, "legible": boolean }
    }
  ],
  "text_hints": {
    "operation_key": string | null,
    "destination_text": string | null,
    "source_text": string | null,
    "item_refs": string[]
  } | null,
  "warnings": string[]
}`;

export class PromptBuilder {
  /**
   * Builds an extraction prompt following the prompt caching prefix ordering:
   * [rules][document-type definitions][output schema][examples] | [user text]
   */
  static buildPrompt(options: PromptBuilderOptions = {}): {
    promptText: string;
    hasInjectionRisk: boolean;
  } {
    const docTypes = options.documentTypes || [];
    const docTypeDefinitions = docTypes.length > 0
      ? docTypes.map(d =>
          `- Key: "${d.key}" (${d.name}). Cues: [${d.cues.join(", ")}]. Expected headers: [${d.expectedHeaders.join(", ")}]`
        ).join("\n")
      : "- Classification rules supplied by configuration.";

    const schemaDesc = options.schemaDescription || CANONICAL_OUTPUT_SCHEMA_DESC;

    let prompt = `${EXTRACTION_SYSTEM_PROMPT}\n\n`;
    prompt += `## Allowed Document Types\n${docTypeDefinitions}\n\n`;
    prompt += `## Required Output JSON Schema\n${schemaDesc}\n\n`;

    if (options.fewShotExamples && options.fewShotExamples.length > 0) {
      prompt += `## Examples\n${options.fewShotExamples.join("\n---\n")}\n\n`;
    }

    // Cache breakpoint separator
    prompt += `--- CACHE_BREAKPOINT ---\n\n`;

    let hasInjectionRisk = false;
    if (options.userMessage && options.userMessage.trim().length > 0) {
      const sanitized = options.userMessage.trim();
      const injectionPattern = /ignore previous|override rules|system prompt|disregard|developer mode|assistant mode/i;
      if (injectionPattern.test(sanitized)) {
        hasInjectionRisk = true;
      }
      prompt += `<user_message>\n${sanitized}\n</user_message>\n\n`;
    }

    prompt += `Analyze the attached <document> image(s) and extract the data strictly adhering to the JSON schema.`;

    return { promptText: prompt, hasInjectionRisk };
  }
}
