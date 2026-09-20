export interface DeepSeekConfig {
  apiKey?: string;
  modelId?: string;
  temperature?: number;
}

export class DeepSeekReasoningProvider {
  private apiKey: string;
  private modelId: string;

  constructor(config: DeepSeekConfig = {}) {
    this.apiKey = config.apiKey || process.env.DEEPSEEK_API_KEY || "";
    this.modelId = config.modelId || "deepseek-chat";
  }

  async repairJson(malformedJsonText: string, schemaDescription: string): Promise<Record<string, unknown>> {
    if (!this.apiKey) {
      throw new Error("DEEPSEEK_API_KEY is not configured.");
    }

    const endpoint = "https://api.deepseek.com/chat/completions";
    const prompt = `You are a strict JSON repair engine. Correct the following invalid or truncated JSON to match this schema:
Schema:
${schemaDescription}

Invalid JSON text:
${malformedJsonText}

Return ONLY valid JSON with no markdown backticks, no commentary.`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.modelId,
        messages: [
          { role: "system", content: "You output only pure, valid JSON." },
          { role: "user", content: prompt }
        ],
        temperature: 0.0,
        response_format: { type: "json_object" }
      })
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`DeepSeek API error (${response.status}): ${err}`);
    }

    const data = await response.json() as any;
    const content = data?.choices?.[0]?.message?.content || "{}";
    return JSON.parse(content);
  }
}
