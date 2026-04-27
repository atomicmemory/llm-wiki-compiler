/**
 * aimock helper for subprocess CLI tests.
 *
 * Spins up a `@copilotkit/aimock` LLMock server on an ephemeral port and
 * returns the URL plus the env overrides needed to point our Anthropic
 * provider at it. CLI subprocesses started via `runCLI(args, cwd, env)`
 * with the returned env will have their `AnthropicProvider` talk to the
 * mock instead of the real API.
 *
 * This unlocks subprocess-level CLI tests for `compile`, `query`, and any
 * other code path that needs the LLM — without the recurring "no canned
 * provider" gap that codex has flagged on multiple branches.
 *
 * @example
 * ```
 * const handle = await startMockClaude();
 * try {
 *   handle.mock.onToolCall("extract_concepts", { toolCalls: [{ name, arguments }] });
 *   handle.mock.onMessage(/.* /, { content: "page body" });
 *   const result = await runCLI(["compile"], cwd, mockClaudeEnv(handle));
 *   expectCLIExit(result, 0);
 * } finally {
 *   await stopMockClaude(handle);
 * }
 * ```
 */

import { LLMock } from "@copilotkit/aimock";

/** Handle returned from {@link startMockClaude}. */
export interface MockClaudeHandle {
  /** Base URL the mock is listening on (e.g. "http://127.0.0.1:54321"). */
  url: string;
  /** Underlying LLMock instance — call .onMessage / .onToolCall to register canned responses. */
  mock: LLMock;
}

/**
 * Start a mock Anthropic-compatible server on an ephemeral port.
 * Caller is responsible for calling {@link stopMockClaude} when done.
 */
export async function startMockClaude(): Promise<MockClaudeHandle> {
  const mock = new LLMock({ port: 0, logLevel: "silent" });
  await mock.start();
  return { url: mock.url, mock };
}

/** Tear down a mock Claude instance. Safe to call in finally blocks. */
export async function stopMockClaude(handle: MockClaudeHandle): Promise<void> {
  await handle.mock.stop();
}

/**
 * Env overrides to inject into `runCLI` so the CLI subprocess routes
 * Anthropic API calls to the mock. The mock-key value is arbitrary —
 * the CLI's credential check only verifies the env var is non-empty.
 *
 * Note: Anthropic embeddings go to Voyage (a different host) which is
 * NOT intercepted by this helper. Use {@link mockOpenAIEnv} for tests
 * that need both completions and embeddings stubbed under one base URL.
 */
export function mockClaudeEnv(handle: MockClaudeHandle): NodeJS.ProcessEnv {
  return {
    ANTHROPIC_BASE_URL: handle.url,
    ANTHROPIC_API_KEY: "mock-key-for-aimock",
    // Pin provider explicitly so a dev environment with LLMWIKI_PROVIDER=ollama
    // doesn't bypass the Anthropic mock.
    LLMWIKI_PROVIDER: "anthropic",
  };
}

/**
 * Env overrides for OpenAI-mode subprocess tests. Use this when the test
 * needs both chat and embedding calls intercepted (the OpenAI provider
 * routes both through OPENAI_BASE_URL, unlike the Anthropic provider
 * which uses Voyage for embeddings).
 *
 * @param handle - aimock handle from {@link startMockClaude}.
 * @param model - Optional model name override (defaults to "gpt-4o").
 */
export function mockOpenAIEnv(
  handle: MockClaudeHandle,
  model = "gpt-4o",
): NodeJS.ProcessEnv {
  return {
    OPENAI_BASE_URL: `${handle.url}/v1`,
    OPENAI_API_KEY: "mock-key-for-aimock",
    LLMWIKI_PROVIDER: "openai",
    LLMWIKI_MODEL: model,
    LLMWIKI_EMBEDDING_MODEL: "text-embedding-3-small",
  };
}
