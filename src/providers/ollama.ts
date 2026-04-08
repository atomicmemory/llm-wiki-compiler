/**
 * Ollama LLM provider implementation.
 *
 * Extends OpenAIProvider since Ollama exposes an OpenAI-compatible API.
 * Overrides only the constructor to set baseURL and disable API key auth.
 */

import { OpenAIProvider } from "./openai.js";

/** Ollama-backed LLM provider using the OpenAI-compatible endpoint. */
export class OllamaProvider extends OpenAIProvider {
  constructor(model: string, baseURL: string) {
    super(model, baseURL, "ollama");
  }
}
