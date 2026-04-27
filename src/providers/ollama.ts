/**
 * Ollama LLM provider implementation.
 *
 * Extends OpenAIProvider since Ollama exposes an OpenAI-compatible API.
 * Overrides only the constructor to set baseURL and disable API key auth.
 */

import { OpenAIProvider, readTimeoutEnv } from "./openai.js";
import { EMBEDDING_MODELS, OLLAMA_DEFAULT_TIMEOUT_MS } from "../utils/constants.js";

/** Construction options for an Ollama-compatible provider. */
interface OllamaProviderOptions {
  baseURL: string;
  embeddingsBaseURL?: string;
  embeddingModel?: string;
  /**
   * Per-request timeout in milliseconds. Defaults to 30 minutes for Ollama
   * because local models on modest hardware can take much longer than the
   * cloud-OpenAI default of 10. Override with OLLAMA_TIMEOUT_MS or the
   * provider-agnostic LLMWIKI_REQUEST_TIMEOUT_MS env var.
   */
  timeoutMs?: number;
}

/** Resolve the Ollama timeout: explicit option → OLLAMA_TIMEOUT_MS → LLMWIKI_REQUEST_TIMEOUT_MS → default. */
function resolveOllamaTimeoutMs(explicit?: number): number {
  return (
    explicit ??
    readTimeoutEnv("OLLAMA_TIMEOUT_MS") ??
    readTimeoutEnv("LLMWIKI_REQUEST_TIMEOUT_MS") ??
    OLLAMA_DEFAULT_TIMEOUT_MS
  );
}

/** Ollama-backed LLM provider using the OpenAI-compatible endpoint. */
export class OllamaProvider extends OpenAIProvider {
  constructor(model: string, options: OllamaProviderOptions) {
    super(model, {
      baseURL: options.baseURL,
      apiKey: "ollama",
      embeddingsBaseURL: options.embeddingsBaseURL,
      embeddingModel: options.embeddingModel,
      timeoutMs: resolveOllamaTimeoutMs(options.timeoutMs),
    });
  }

  /** Ollama ships a dedicated embedding model (nomic-embed-text). */
  protected override embeddingModel(): string {
    return this.configuredEmbeddingModel ?? EMBEDDING_MODELS.ollama;
  }
}
