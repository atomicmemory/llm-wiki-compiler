/**
 * CLI-level integration tests for the `ingest-session` command and session adapters.
 *
 * Each test exercises the full CLI path — from argument parsing through adapter
 * detection and file writing — so no mocking is required. Tests use a temporary
 * working directory and clean up after themselves.
 *
 * Fixture files live in `test/fixtures/sessions/` and cover Claude (.jsonl),
 * Codex (.json), Cursor (.json), and a malformed JSONL that triggers an error.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { mkdir, rm, readdir, writeFile, readFile } from "fs/promises";
import { tmpdir } from "os";

const exec = promisify(execFile);
const CLI = path.resolve("dist/cli.js");

const FIXTURES = path.resolve("test/fixtures/sessions");
const CLAUDE_FIXTURE = path.join(FIXTURES, "claude-session.jsonl");
const CODEX_FIXTURE = path.join(FIXTURES, "codex-session.json");
const CURSOR_FIXTURE = path.join(FIXTURES, "cursor-session.json");
const MALFORMED_FIXTURE = path.join(FIXTURES, "malformed.jsonl");

/** Create an isolated temp workspace with an empty `sources/` directory. */
async function makeWorkspace(suffix: string): Promise<string> {
  const cwd = path.join(tmpdir(), `llmwiki-session-test-${suffix}-${Date.now()}`);
  await mkdir(path.join(cwd, "sources"), { recursive: true });
  return cwd;
}

async function removeWorkspace(cwd: string): Promise<void> {
  await rm(cwd, { recursive: true, force: true });
}

/** Run the CLI in `cwd`, returning stdout on success. */
async function runCli(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return exec("node", [CLI, ...args], { cwd });
}

/** Run the CLI expecting a non-zero exit; returns the error object. */
async function runCliExpectFailure(
  args: string[],
  cwd: string,
): Promise<{ stderr: string; code: number }> {
  try {
    await exec("node", [CLI, ...args], { cwd });
    expect.fail("Expected CLI to exit non-zero but it succeeded");
  } catch (err: unknown) {
    const e = err as { stderr?: string; code?: number };
    return { stderr: e.stderr ?? "", code: e.code ?? 1 };
  }
  // Unreachable — appeases TypeScript.
  throw new Error("unreachable");
}

/**
 * Assert that exactly one markdown file was written to `sources/` and that
 * its frontmatter includes `adapter: <adapterName>` plus the standard fields.
 */
async function assertSingleSessionIngested(cwd: string, adapterName: string): Promise<void> {
  const files = await readdir(path.join(cwd, "sources"));
  expect(files.length).toBe(1);

  const content = await readFile(path.join(cwd, "sources", files[0]), "utf-8");
  expect(content).toContain(`adapter: ${adapterName}`);
  expect(content).toContain("ingestedAt:");
  expect(content).toContain("source:");
}

/**
 * Assert that the CLI exits non-zero and the stderr matches an expected pattern.
 * Always checks for a leading `Error:` label from the CLI error handler.
 */
async function assertCliError(
  args: string[],
  cwd: string,
  pattern: RegExp,
): Promise<void> {
  const { stderr, code } = await runCliExpectFailure(args, cwd);
  expect(code).not.toBe(0);
  expect(stderr).toContain("Error:");
  expect(stderr.toLowerCase()).toMatch(pattern);
}

describe("ingest-session CLI integration", () => {
  beforeAll(async () => {
    await exec("npx", ["tsup"], { cwd: path.resolve(".") });
  }, 30_000);

  it("ingest-session --help shows the command description", async () => {
    const cwd = await makeWorkspace("help");
    try {
      const { stdout } = await runCli(["ingest-session", "--help"], cwd);
      expect(stdout).toContain("ingest-session");
      expect(stdout).toContain("session");
    } finally {
      await removeWorkspace(cwd);
    }
  }, 30_000);

  it("ingest-session with claude fixture writes markdown to sources/", async () => {
    const cwd = await makeWorkspace("claude");
    try {
      const { stdout } = await runCli(["ingest-session", CLAUDE_FIXTURE], cwd);
      expect(stdout).toContain("claude");
      await assertSingleSessionIngested(cwd, "claude");
    } finally {
      await removeWorkspace(cwd);
    }
  }, 30_000);

  it("ingest-session with codex fixture writes markdown to sources/", async () => {
    const cwd = await makeWorkspace("codex");
    try {
      const { stdout } = await runCli(["ingest-session", CODEX_FIXTURE], cwd);
      expect(stdout).toContain("codex");
      await assertSingleSessionIngested(cwd, "codex");
    } finally {
      await removeWorkspace(cwd);
    }
  }, 30_000);

  it("ingest-session with cursor fixture writes markdown to sources/", async () => {
    const cwd = await makeWorkspace("cursor");
    try {
      const { stdout } = await runCli(["ingest-session", CURSOR_FIXTURE], cwd);
      expect(stdout).toContain("cursor");
      await assertSingleSessionIngested(cwd, "cursor");
    } finally {
      await removeWorkspace(cwd);
    }
  }, 30_000);

  it("ingest-session with malformed fixture exits non-zero with actionable error", async () => {
    const cwd = await makeWorkspace("malformed");
    try {
      // The claude adapter reports which line is malformed.
      await assertCliError(["ingest-session", MALFORMED_FIXTURE], cwd, /malformed|line \d+|invalid/);
    } finally {
      await removeWorkspace(cwd);
    }
  }, 30_000);

  it("ingest-session with directory bulk-imports all recognised session files", async () => {
    const cwd = await makeWorkspace("directory");
    try {
      const { stdout } = await runCli(["ingest-session", FIXTURES], cwd);

      const files = await readdir(path.join(cwd, "sources"));
      // claude, codex, cursor fixtures should be imported; malformed.jsonl is skipped.
      expect(files.length).toBeGreaterThanOrEqual(3);

      // The CLI should report counts.
      expect(stdout).toMatch(/Imported \d+ session/);
    } finally {
      await removeWorkspace(cwd);
    }
  }, 30_000);

  it("ingest-session with unknown format exits non-zero explaining no adapter matched", async () => {
    const cwd = await makeWorkspace("unknown");
    const unknownFile = path.join(cwd, "unknown.txt");
    // Write a plain text file that no adapter should recognise.
    await writeFile(unknownFile, "hello world", "utf-8");
    try {
      await assertCliError(["ingest-session", unknownFile], cwd, /no session adapter|no adapter/);
    } finally {
      await removeWorkspace(cwd);
    }
  }, 30_000);

  it("ingest-session with missing path exits non-zero with file-not-found error", async () => {
    const cwd = await makeWorkspace("missing");
    const missingPath = path.join(cwd, "does-not-exist.jsonl");
    try {
      await assertCliError(["ingest-session", missingPath], cwd, /not found|no such file/);
    } finally {
      await removeWorkspace(cwd);
    }
  }, 30_000);
});
