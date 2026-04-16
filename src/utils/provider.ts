/**
 * LLM provider abstraction layer.
 *
 * Defines the LLMProvider interface and a factory function that reads
 * LLMWIKI_PROVIDER and LLMWIKI_MODEL env vars to instantiate the
 * appropriate backend (Anthropic, OpenAI, Ollama, or MiniMax).
 */

import { DEFAULT_PROVIDER, PROVIDER_MODELS, OLLAMA_DEFAULT_HOST } from "./constants.js";
import { AnthropicProvider } from "../providers/anthropic.js";
import { OpenAIProvider } from "../providers/openai.js";
import { OllamaProvider } from "../providers/ollama.js";
import { MiniMaxProvider } from "../providers/minimax.js";
import {
  resolveAnthropicAuthFromEnv,
  resolveAnthropicBaseURLFromEnv,
  resolveAnthropicModelFromEnv,
} from "./claude-settings.js";

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
  /** Return a single embedding vector for the given text. */
  embed(text: string): Promise<number[]>;
}

const SUPPORTED_PROVIDERS: ReadonlySet<string> = new Set(["anthropic", "openai", "ollama", "minimax"]);

/**
 * Factory that returns the appropriate LLMProvider based on env vars.
 * Reads LLMWIKI_PROVIDER (default "anthropic") and LLMWIKI_MODEL
 * (defaults per provider from PROVIDER_MODELS).
 *
 * Direct process.env access is acceptable here as this is a system boundary.
 */
export function getProvider(): LLMProvider {
  const providerName = getProviderName();

  switch (providerName) {
    case "anthropic":
      return getAnthropicProvider();
    case "openai":
      return new OpenAIProvider(getModelForProvider("openai"));
    case "ollama":
      return new OllamaProvider(
        getModelForProvider("ollama"),
        process.env.OLLAMA_HOST ?? OLLAMA_DEFAULT_HOST,
      );
    case "minimax":
      return getMiniMaxProvider();
    default:
      throw new Error(`Unhandled provider: ${providerName}`);
  }
}

function getModelForProvider(providerName: "openai" | "ollama" | "minimax"): string {
  return process.env.LLMWIKI_MODEL ?? PROVIDER_MODELS[providerName];
}

function getMiniMaxProvider(): MiniMaxProvider {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    throw new Error(
      "MiniMax provider requires MINIMAX_API_KEY environment variable.\n" +
      '  Set it with: export MINIMAX_API_KEY=your_key',
    );
  }
  return new MiniMaxProvider(getModelForProvider("minimax"), apiKey);
}

function getAnthropicProvider(): AnthropicProvider {
  const model = resolveAnthropicModelFromEnv() ?? PROVIDER_MODELS.anthropic;
  const baseURL = resolveAnthropicBaseURLFromEnv();
  const auth = resolveAnthropicAuthFromEnv();

  return new AnthropicProvider(model, {
    baseURL,
    ...auth,
  });
}

function getProviderName(): string {
  const providerName = process.env.LLMWIKI_PROVIDER ?? DEFAULT_PROVIDER;
  if (!SUPPORTED_PROVIDERS.has(providerName)) {
    throw new Error(
      `Unknown provider "${providerName}". Supported: ${[...SUPPORTED_PROVIDERS].join(", ")}`,
    );
  }
  return providerName;
}

/** Expose the resolved provider name for callers that need model lookup. */
export function getActiveProviderName(): string {
  return getProviderName();
}
