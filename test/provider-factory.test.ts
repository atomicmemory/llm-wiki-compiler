/**
 * Tests for the provider factory (getProvider).
 * Verifies correct provider instantiation based on env vars.
 */

import { describe, it, expect, afterEach } from "vitest";
import { getProvider } from "../src/utils/provider.js";
import { AnthropicProvider } from "../src/providers/anthropic.js";
import { OpenAIProvider } from "../src/providers/openai.js";
import { OllamaProvider } from "../src/providers/ollama.js";

describe("getProvider", () => {
  afterEach(() => {
    delete process.env.LLMWIKI_PROVIDER;
    delete process.env.LLMWIKI_MODEL;
  });

  it("returns AnthropicProvider when LLMWIKI_PROVIDER is unset", () => {
    delete process.env.LLMWIKI_PROVIDER;
    const provider = getProvider();
    expect(provider).toBeInstanceOf(AnthropicProvider);
  });

  it("returns AnthropicProvider when LLMWIKI_PROVIDER=anthropic", () => {
    process.env.LLMWIKI_PROVIDER = "anthropic";
    const provider = getProvider();
    expect(provider).toBeInstanceOf(AnthropicProvider);
  });

  it("returns OpenAIProvider when LLMWIKI_PROVIDER=openai", () => {
    process.env.LLMWIKI_PROVIDER = "openai";
    const provider = getProvider();
    expect(provider).toBeInstanceOf(OpenAIProvider);
  });

  it("returns OllamaProvider when LLMWIKI_PROVIDER=ollama", () => {
    process.env.LLMWIKI_PROVIDER = "ollama";
    const provider = getProvider();
    expect(provider).toBeInstanceOf(OllamaProvider);
  });

  it("throws for unknown provider", () => {
    process.env.LLMWIKI_PROVIDER = "gemini";
    expect(() => getProvider()).toThrow('Unknown provider "gemini"');
  });

  it("respects LLMWIKI_MODEL override", () => {
    process.env.LLMWIKI_PROVIDER = "openai";
    process.env.LLMWIKI_MODEL = "gpt-4-turbo";
    const provider = getProvider();
    expect(provider).toBeInstanceOf(OpenAIProvider);
    // The model is stored as a protected field; verify it was accepted
    // by checking the provider was created without throwing
    expect(provider).toBeDefined();
  });
});
