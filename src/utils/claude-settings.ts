/**
 * Claude settings fallback helpers.
 *
 * Provides a narrow, read-only integration with `~/.claude/settings.json`.
 * We only read the `env` object and only extract Anthropic-related values that
 * llmwiki can safely consume. Explicit process env values remain higher priority.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const CLAUDE_SETTINGS_PATH_ENV = "LLMWIKI_CLAUDE_SETTINGS_PATH";

interface ClaudeSettingsEnv {
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_AUTH_TOKEN?: string;
  ANTHROPIC_BASE_URL?: string;
  ANTHROPIC_MODEL?: string;
}

interface AnthropicAuthConfig {
  apiKey?: string;
  authToken?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalize(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function resolveClaudeSettingsPath(env: NodeJS.ProcessEnv): string {
  return env[CLAUDE_SETTINGS_PATH_ENV] ?? path.join(homedir(), ".claude", "settings.json");
}

function readClaudeSettingsFile(settingsPath: string): string | undefined {
  try {
    return readFileSync(settingsPath, "utf8");
  } catch (err) {
    if (isRecord(err) && err.code === "ENOENT") {
      return undefined;
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read Claude settings at "${settingsPath}": ${message}`);
  }
}

export function readClaudeSettingsEnv(env: NodeJS.ProcessEnv = process.env): ClaudeSettingsEnv | undefined {
  const settingsPath = resolveClaudeSettingsPath(env);
  const raw = readClaudeSettingsFile(settingsPath);
  if (!raw) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse Claude settings at "${settingsPath}": ${message}`);
  }

  if (!isRecord(parsed) || !isRecord(parsed.env)) {
    return undefined;
  }

  const values: ClaudeSettingsEnv = {
    ANTHROPIC_API_KEY: normalize(parsed.env.ANTHROPIC_API_KEY),
    ANTHROPIC_AUTH_TOKEN: normalize(parsed.env.ANTHROPIC_AUTH_TOKEN),
    ANTHROPIC_BASE_URL: normalize(parsed.env.ANTHROPIC_BASE_URL),
    ANTHROPIC_MODEL: normalize(parsed.env.ANTHROPIC_MODEL),
  };

  if (!values.ANTHROPIC_API_KEY && !values.ANTHROPIC_AUTH_TOKEN && !values.ANTHROPIC_BASE_URL && !values.ANTHROPIC_MODEL) {
    return undefined;
  }
  return values;
}

function tryReadClaudeSettingsEnv(env: NodeJS.ProcessEnv): ClaudeSettingsEnv | undefined {
  try {
    return readClaudeSettingsEnv(env);
  } catch {
    return undefined;
  }
}

function validateAnthropicBaseURL(value: string): string {
  const normalized = value.trim();
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Must use http:// or https:// protocol.");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Must be a valid http(s) URL.";
    throw new Error(`Invalid ANTHROPIC_BASE_URL: "${normalized}". ${message}`);
  }
  return normalized;
}

export function resolveAnthropicAuthFromEnv(env: NodeJS.ProcessEnv = process.env): AnthropicAuthConfig {
  const explicitApiKey = normalize(env.ANTHROPIC_API_KEY);
  if (explicitApiKey) return { apiKey: explicitApiKey };

  const explicitAuthToken = normalize(env.ANTHROPIC_AUTH_TOKEN);
  if (explicitAuthToken) return { authToken: explicitAuthToken };

  const fallback = readClaudeSettingsEnv(env);
  if (fallback?.ANTHROPIC_API_KEY) return { apiKey: fallback.ANTHROPIC_API_KEY };
  if (fallback?.ANTHROPIC_AUTH_TOKEN) return { authToken: fallback.ANTHROPIC_AUTH_TOKEN };
  return {};
}

export function resolveAnthropicModelFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const explicitModel = env.LLMWIKI_MODEL;
  if (explicitModel !== undefined) return explicitModel;
  return tryReadClaudeSettingsEnv(env)?.ANTHROPIC_MODEL;
}

export function resolveAnthropicBaseURLFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const explicitBaseURL = normalize(env.ANTHROPIC_BASE_URL);
  if (explicitBaseURL) return validateAnthropicBaseURL(explicitBaseURL);

  const fallbackBaseURL = tryReadClaudeSettingsEnv(env)?.ANTHROPIC_BASE_URL;
  if (!fallbackBaseURL) return undefined;
  return validateAnthropicBaseURL(fallbackBaseURL);
}
