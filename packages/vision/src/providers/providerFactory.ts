import type { IVisionProvider, IReasoningProvider } from "../types.js";
import { GeminiVisionProvider } from "./geminiProvider.js";
import { DeepSeekReasoningProvider } from "./deepseekProvider.js";

export type VisionProviderConstructor = new (config: any) => IVisionProvider;
export type ReasoningProviderConstructor = new (config: any) => IReasoningProvider;

export interface ProviderSpec {
  provider: string;
  model_id: string;
  endpoint?: string;
  endpoint_base?: string;
  temperature?: number;
  max_output_tokens?: number;
  timeout_ms?: number;
  api_key?: string;
}

/**
 * ModelProviderFactory
 * Enforces dynamic provider instantiation driven exclusively by configuration.
 * Adheres to Locked Decision LD-5 (no defaults in code) and allows arbitrary
 * providers to be registered without code changes.
 */
export class ModelProviderFactory {
  private static visionRegistry: Map<string, VisionProviderConstructor> = new Map([
    ["gemini", GeminiVisionProvider]
  ]);

  private static reasoningRegistry: Map<string, ReasoningProviderConstructor> = new Map([
    ["deepseek", DeepSeekReasoningProvider]
  ]);

  static registerVisionProvider(providerKey: string, ctor: VisionProviderConstructor): void {
    this.visionRegistry.set(providerKey.toLowerCase(), ctor);
  }

  static registerReasoningProvider(providerKey: string, ctor: ReasoningProviderConstructor): void {
    this.reasoningRegistry.set(providerKey.toLowerCase(), ctor);
  }

  static createVisionProvider(spec: ProviderSpec): IVisionProvider {
    if (!spec || !spec.provider) {
      throw new Error("ModelProviderFactory: provider name must be specified in configuration (LD-5: no defaults in code).");
    }
    if (!spec.model_id) {
      throw new Error("ModelProviderFactory: model_id must be specified in configuration (LD-5: no defaults in code).");
    }
    const ctor = this.visionRegistry.get(spec.provider.toLowerCase());
    if (!ctor) {
      throw new Error(`ModelProviderFactory: unregistered vision provider '${spec.provider}'. Register it via ModelProviderFactory.registerVisionProvider.`);
    }
    return new ctor({
      modelId: spec.model_id,
      endpointBase: spec.endpoint_base || spec.endpoint,
      temperature: spec.temperature,
      apiKey: spec.api_key
    });
  }

  static createReasoningProvider(spec: ProviderSpec): IReasoningProvider {
    if (!spec || !spec.provider) {
      throw new Error("ModelProviderFactory: provider name must be specified in configuration (LD-5: no defaults in code).");
    }
    if (!spec.model_id) {
      throw new Error("ModelProviderFactory: model_id must be specified in configuration (LD-5: no defaults in code).");
    }
    const ctor = this.reasoningRegistry.get(spec.provider.toLowerCase());
    if (!ctor) {
      throw new Error(`ModelProviderFactory: unregistered reasoning provider '${spec.provider}'. Register it via ModelProviderFactory.registerReasoningProvider.`);
    }
    return new ctor({
      modelId: spec.model_id,
      endpoint: spec.endpoint || spec.endpoint_base,
      temperature: spec.temperature,
      apiKey: spec.api_key
    });
  }
}
