import type { ExtractionResult, IVisionProvider } from "../types.js";

export interface GeminiConfig {
  apiKey?: string;
  modelId: string;
  temperature?: number;
  endpointBase?: string;
}

export class GeminiVisionProvider implements IVisionProvider {
  public readonly providerId: string = "gemini";
  private apiKey: string;
  public readonly modelId: string;
  private endpointBase: string;

  constructor(config: GeminiConfig) {
    if (!config || !config.modelId) {
      throw new Error("GeminiVisionProvider requires modelId in configuration (LD-5: no defaults in code).");
    }
    const endpoint = config.endpointBase || process.env.GEMINI_ENDPOINT_BASE;
    if (!endpoint) {
      throw new Error("GeminiVisionProvider requires endpointBase in configuration (LD-5: no defaults in code).");
    }
    this.apiKey = config.apiKey || process.env.GEMINI_API_KEY || "";
    this.modelId = config.modelId;
    this.endpointBase = endpoint;
  }

  async extractDocument(
    imageBuffer: Buffer,
    mimeType: string,
    promptText: string
  ): Promise<ExtractionResult> {
    if (!this.apiKey) {
      throw new Error("GEMINI_API_KEY is not configured.");
    }

    const base64Data = imageBuffer.toString("base64");
    const endpoint = `${this.endpointBase}/models/${this.modelId}:generateContent?key=${this.apiKey}`;

    const payload = {
      contents: [
        {
          parts: [
            { text: promptText },
            {
              inlineData: {
                mimeType,
                data: base64Data
              }
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.0,
        responseMimeType: "application/json"
      }
    };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${errBody}`);
    }

    const data = await response.json() as any;
    const candidateText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    const parsed = JSON.parse(candidateText);

    return {
      header: parsed.header || { documentType: "unknown" },
      lines: parsed.lines || [],
      rotationNeeded: parsed.rotation_needed || 0,
      rawJson: parsed,
      tokensIn: data?.usageMetadata?.promptTokenCount || 0,
      tokensOut: data?.usageMetadata?.candidatesTokenCount || 0,
      modelUsed: this.modelId,
      costUsdEst: 0
    };
  }
}
