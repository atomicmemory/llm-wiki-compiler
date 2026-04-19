/**
 * Ollama LLM provider implementation.
 *
 * Extends OpenAIProvider since Ollama exposes an OpenAI-compatible API.
 * Overrides only the constructor to set baseURL and disable API key auth.
 */

import { OpenAIProvider } from "./openai.js";
import { EMBEDDING_MODELS } from "../utils/constants.js";

/** Construction options for an Ollama-compatible provider. */
interface OllamaProviderOptions {
  baseURL: string;
  embeddingsBaseURL?: string;
  embeddingModel?: string;
}

/** Ollama-backed LLM provider using the OpenAI-compatible endpoint. */
export class OllamaProvider extends OpenAIProvider {
  constructor(model: string, options: OllamaProviderOptions) {
    super(model, {
      baseURL: options.baseURL,
      apiKey: "ollama",
      embeddingsBaseURL: options.embeddingsBaseURL,
      embeddingModel: options.embeddingModel,
    });
  }

  /** Ollama ships a dedicated embedding model (nomic-embed-text). */
  protected override embeddingModel(): string {
    return this.configuredEmbeddingModel ?? EMBEDDING_MODELS.ollama;
  }
}
