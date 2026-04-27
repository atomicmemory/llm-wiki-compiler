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
