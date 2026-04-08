/**
 * LLM provider abstraction layer.
 *
 * Defines the LLMProvider interface and a factory function that reads
 * LLMWIKI_PROVIDER and LLMWIKI_MODEL env vars to instantiate the
 * appropriate backend (Anthropic, OpenAI, or Ollama).
 */

import { DEFAULT_PROVIDER, PROVIDER_MODELS, OLLAMA_DEFAULT_HOST } from "./constants.js";
import { AnthropicProvider } from "../providers/anthropic.js";
import { OpenAIProvider } from "../providers/openai.js";
import { OllamaProvider } from "../providers/ollama.js";

/** A single message in an LLM conversation. */
export interface LLMMessage {
  role: "user" | "assistant";
  content: string;
}

/** A tool definition in Anthropic-style format (used as the canonical shape). */
export interface LLMTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** Provider-agnostic interface for LLM backends. */
export interface LLMProvider {
  complete(system: string, messages: LLMMessage[], maxTokens: number): Promise<string>;
  stream(
    system: string,
    messages: LLMMessage[],
    maxTokens: number,
    onToken?: (text: string) => void,
  ): Promise<string>;
  toolCall(
    system: string,
    messages: LLMMessage[],
    tools: LLMTool[],
    maxTokens: number,
  ): Promise<string>;
}

const SUPPORTED_PROVIDERS: ReadonlySet<string> = new Set(["anthropic", "openai", "ollama"]);

/**
 * Factory that returns the appropriate LLMProvider based on env vars.
 * Reads LLMWIKI_PROVIDER (default "anthropic") and LLMWIKI_MODEL
 * (defaults per provider from PROVIDER_MODELS).
 *
 * Direct process.env access is acceptable here as this is a system boundary.
 */
export function getProvider(): LLMProvider {
  const providerName = process.env.LLMWIKI_PROVIDER ?? DEFAULT_PROVIDER;

  if (!SUPPORTED_PROVIDERS.has(providerName)) {
    throw new Error(
      `Unknown provider "${providerName}". Supported: ${[...SUPPORTED_PROVIDERS].join(", ")}`,
    );
  }

  const model = process.env.LLMWIKI_MODEL ?? PROVIDER_MODELS[providerName];

  switch (providerName) {
    case "anthropic":
      return new AnthropicProvider(model);
    case "openai":
      return new OpenAIProvider(model);
    case "ollama":
      return new OllamaProvider(
        model,
        process.env.OLLAMA_HOST ?? OLLAMA_DEFAULT_HOST,
      );
    default:
      throw new Error(`Unhandled provider: ${providerName}`);
  }
}
