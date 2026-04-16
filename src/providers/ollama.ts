/**
 * Ollama LLM provider implementation.
 *
 * Extends OpenAIProvider since Ollama exposes an OpenAI-compatible API.
 * Overrides only the constructor to set baseURL and disable API key auth.
 */

import { OpenAIProvider } from "./openai.js";
import { EMBEDDING_MODELS } from "../utils/constants.js";

/** Ollama-backed LLM provider using the OpenAI-compatible endpoint. */
export class OllamaProvider extends OpenAIProvider {
  constructor(model: string, baseURL: string) {
    super(model, baseURL, "ollama");
  }

  /** Ollama ships a dedicated embedding model (nomic-embed-text). */
  protected override embeddingModel(): string {
    return EMBEDDING_MODELS.ollama;
  }
}
