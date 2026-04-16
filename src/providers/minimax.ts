/**
 * MiniMax LLM provider implementation.
 *
 * Extends OpenAIProvider since MiniMax exposes an OpenAI-compatible API.
 * Overrides only the constructor to set MiniMax's base URL and API key.
 */

import { OpenAIProvider } from "./openai.js";

/** MiniMax API base URL. */
const MINIMAX_BASE_URL = "https://api.minimax.io/v1";

/** MiniMax-backed LLM provider using the OpenAI-compatible endpoint. */
export class MiniMaxProvider extends OpenAIProvider {
  constructor(model: string, apiKey: string) {
    super(model, MINIMAX_BASE_URL, apiKey);
  }
}
