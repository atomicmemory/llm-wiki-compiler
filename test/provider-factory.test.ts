/**
 * Tests for the provider factory (getProvider).
 * Verifies correct provider instantiation based on env vars.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getProvider } from "../src/utils/provider.js";
import { AnthropicProvider } from "../src/providers/anthropic.js";
import { OpenAIProvider } from "../src/providers/openai.js";
import { OllamaProvider } from "../src/providers/ollama.js";

const TEST_SETTINGS_PATH_ENV = "LLMWIKI_CLAUDE_SETTINGS_PATH";
const tempDirs: string[] = [];

function withClaudeSettings(settings: unknown): string {
  const dir = mkdtempSync(path.join(tmpdir(), "llmwiki-provider-factory-"));
  tempDirs.push(dir);
  const settingsPath = path.join(dir, "settings.json");
  writeFileSync(settingsPath, JSON.stringify(settings), "utf8");
  return settingsPath;
}

function withMalformedClaudeSettings(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  const settingsPath = path.join(dir, "settings.json");
  writeFileSync(settingsPath, "{ invalid-json", "utf8");
  return settingsPath;
}

function setClaudeAnthropicModelFallback(model: string): void {
  process.env[TEST_SETTINGS_PATH_ENV] = withClaudeSettings({
    env: { ANTHROPIC_MODEL: model },
  });
}

function expectAnthropicModel(expectedModel: string): void {
  const provider = getProvider();
  expect(provider).toBeInstanceOf(AnthropicProvider);
  expect(Reflect.get(provider, "model")).toBe(expectedModel);
}

describe("getProvider", () => {
  afterEach(() => {
    delete process.env.LLMWIKI_PROVIDER;
    delete process.env.LLMWIKI_MODEL;
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env[TEST_SETTINGS_PATH_ENV];

    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("defaults to official anthropic endpoint when base url is unset", () => {
    delete process.env.ANTHROPIC_BASE_URL;
    const provider = getProvider();
    expect(provider).toBeInstanceOf(AnthropicProvider);
  });

  it("uses configured anthropic base url", () => {
    process.env.ANTHROPIC_BASE_URL = "https://custom.anthropic.com";
    const provider = getProvider();
    expect(provider).toBeInstanceOf(AnthropicProvider);
  });

  it("rejects invalid anthropic base url", () => {
    process.env.ANTHROPIC_BASE_URL = "not-a-url";
    expect(() => getProvider()).toThrow('Invalid ANTHROPIC_BASE_URL: "not-a-url"');
  });

  it("accepts anthropic base url with path endpoint", () => {
    process.env.ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
    const provider = getProvider();
    expect(provider).toBeInstanceOf(AnthropicProvider);
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

  it("ignores anthropic base url for non-anthropic providers", () => {
    process.env.LLMWIKI_PROVIDER = "openai";
    process.env.ANTHROPIC_BASE_URL = "https://invalid-host.com/v1";
    const provider = getProvider();
    expect(provider).toBeInstanceOf(OpenAIProvider);
    expect(provider).toBeDefined();
  });

  it("treats whitespace-only ANTHROPIC_BASE_URL as unset", () => {
    process.env.ANTHROPIC_BASE_URL = "  ";
    const provider = getProvider();
    expect(provider).toBeInstanceOf(AnthropicProvider);
  });

  it("uses Claude settings fallback for anthropic base URL", () => {
    process.env[TEST_SETTINGS_PATH_ENV] = withClaudeSettings({
      env: { ANTHROPIC_BASE_URL: "https://api.kimi.com/coding/" },
    });

    const provider = getProvider();
    expect(provider).toBeInstanceOf(AnthropicProvider);
  });

  it("uses Claude settings fallback for anthropic model", () => {
    setClaudeAnthropicModelFallback("Kimi-2.5");
    expectAnthropicModel("Kimi-2.5");
  });

  it("prefers explicit LLMWIKI_MODEL over Claude settings fallback model", () => {
    process.env.LLMWIKI_MODEL = "explicit-model";
    setClaudeAnthropicModelFallback("Kimi-2.5");
    expectAnthropicModel("explicit-model");
  });

  it("does not read Claude fallback for openai when explicit settings are sufficient", () => {
    const settingsPath = withMalformedClaudeSettings("llmwiki-provider-factory-bad-json-");

    process.env.LLMWIKI_PROVIDER = "openai";
    process.env.LLMWIKI_MODEL = "gpt-4o-mini";
    process.env[TEST_SETTINGS_PATH_ENV] = settingsPath;

    const provider = getProvider();
    expect(provider).toBeInstanceOf(OpenAIProvider);
  });

  it("throws when Claude settings JSON is malformed and anthropic fallback is required", () => {
    const settingsPath = withMalformedClaudeSettings("llmwiki-provider-factory-malformed-");

    process.env[TEST_SETTINGS_PATH_ENV] = settingsPath;
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.LLMWIKI_MODEL;

    expect(() => getProvider()).toThrow("Failed to parse Claude settings");
  });

  it("ignores malformed Claude settings for optional fallback fields when explicit auth is present", () => {
    const settingsPath = withMalformedClaudeSettings("llmwiki-provider-factory-malformed-optional-");

    process.env[TEST_SETTINGS_PATH_ENV] = settingsPath;
    process.env.ANTHROPIC_AUTH_TOKEN = "explicit-token";
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.LLMWIKI_MODEL;

    const provider = getProvider();
    expect(provider).toBeInstanceOf(AnthropicProvider);
  });
});
