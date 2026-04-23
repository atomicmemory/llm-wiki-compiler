/**
 * CLI-level integration tests for the `llmwiki review` subcommand family.
 *
 * All tests spawn real subprocesses via execFile so they exercise the full
 * CLI surface (Commander routing, exit codes, stdout/stderr) without mocking
 * internal modules. Candidate JSON files are written manually to control state
 * so no LLM call is needed for any test in this file.
 *
 * Tests that would require a real LLM call (compile --review with valid creds)
 * are marked it.skip and explained inline.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { mkdir, rm, writeFile, readdir, access } from "fs/promises";
import { tmpdir } from "os";
import type { ReviewCandidate } from "../src/utils/types.js";
import { runCLI, CLI } from "./fixtures/run-cli.js";

const exec = promisify(execFile);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a disposable temp directory with a sources/ sub-folder. */
async function makeTempWorkspace(suffix: string): Promise<string> {
  const cwd = path.join(tmpdir(), `llmwiki-review-test-${suffix}-${Date.now()}`);
  await mkdir(path.join(cwd, "sources"), { recursive: true });
  return cwd;
}

async function cleanupDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

/** Write a minimal, valid ReviewCandidate JSON under .llmwiki/candidates/. */
async function writeCandidateFixture(
  cwd: string,
  overrides: Partial<ReviewCandidate> = {},
): Promise<ReviewCandidate> {
  const candidate: ReviewCandidate = {
    id: overrides.id ?? "test-slug-aabbccdd",
    title: overrides.title ?? "Test Concept",
    slug: overrides.slug ?? "test-slug",
    summary: overrides.summary ?? "A test concept summary.",
    sources: overrides.sources ?? ["source-a.md"],
    body: overrides.body ?? buildValidPageBody(
      overrides.title ?? "Test Concept",
      overrides.summary ?? "A test concept summary.",
    ),
    generatedAt: overrides.generatedAt ?? new Date().toISOString(),
  };

  const candidatesDir = path.join(cwd, ".llmwiki", "candidates");
  await mkdir(candidatesDir, { recursive: true });
  const filePath = path.join(candidatesDir, `${candidate.id}.json`);
  await writeFile(filePath, JSON.stringify(candidate, null, 2), "utf-8");
  return candidate;
}

/** Build minimal YAML-frontmatter page body that passes validateWikiPage. */
function buildValidPageBody(title: string, summary: string): string {
  const now = new Date().toISOString();
  return [
    "---",
    `title: "${title}"`,
    `summary: "${summary}"`,
    `sources: []`,
    `createdAt: "${now}"`,
    `updatedAt: "${now}"`,
    "---",
    "",
    `# ${title}`,
    "",
    summary,
  ].join("\n");
}

/**
 * Assert that a review subcommand exits non-zero and prints "not found" when
 * given an id that does not correspond to any candidate file.
 */
async function assertMissingIdFails(subcommand: string, suffix: string): Promise<void> {
  const cwd = await makeTempWorkspace(suffix);
  try {
    const result = await runCLI(["review", subcommand, "does-not-exist-00000000"], cwd);
    expect(result.code).not.toBe(0);
    expect(result.stdout).toContain("not found");
  } finally {
    await cleanupDir(cwd);
  }
}

// ---------------------------------------------------------------------------
// Build once before all tests
// ---------------------------------------------------------------------------

describe("review integration tests", () => {
  beforeAll(async () => {
    await exec("npx", ["tsup"], { cwd: path.resolve(".") });
  }, 30_000);

  // -------------------------------------------------------------------------
  // compile --help advertises the --review flag
  // -------------------------------------------------------------------------

  it("compile --help documents the --review flag for discoverability", async () => {
    const cwd = await makeTempWorkspace("compile-help-review-flag");
    try {
      const result = await runCLI(["compile", "--help"], cwd);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("--review");
    } finally {
      await cleanupDir(cwd);
    }
  }, 30_000);

  // -------------------------------------------------------------------------
  // compile --review without credentials
  // -------------------------------------------------------------------------

  it("compile --review fails with credential error when no API key set", async () => {
    const cwd = await makeTempWorkspace("compile-review-no-key");
    try {
      const result = await runCLI(["compile", "--review"], cwd, {
        ANTHROPIC_API_KEY: "",
        ANTHROPIC_AUTH_TOKEN: "",
      });
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("Error:");
    } finally {
      await cleanupDir(cwd);
    }
  }, 30_000);

  // -------------------------------------------------------------------------
  // review list — no candidates
  // -------------------------------------------------------------------------

  it("review list on a fresh wiki exits 0 and reports no candidates", async () => {
    const cwd = await makeTempWorkspace("review-list-empty");
    try {
      const result = await runCLI(["review", "list"], cwd);
      expect(result.code).toBe(0);
      expect(result.stdout.toLowerCase()).toContain("no pending");
    } finally {
      await cleanupDir(cwd);
    }
  }, 30_000);

  // -------------------------------------------------------------------------
  // review show — missing id
  // -------------------------------------------------------------------------

  it("review show with missing id exits non-zero with actionable error", async () => {
    await assertMissingIdFails("show", "review-show-missing");
  }, 30_000);

  // -------------------------------------------------------------------------
  // review approve — missing id
  // -------------------------------------------------------------------------

  it("review approve with missing id exits non-zero with actionable error", async () => {
    await assertMissingIdFails("approve", "review-approve-missing");
  }, 30_000);

  // -------------------------------------------------------------------------
  // review reject — missing id
  // -------------------------------------------------------------------------

  it("review reject with missing id exits non-zero with actionable error", async () => {
    await assertMissingIdFails("reject", "review-reject-missing");
  }, 30_000);

  // -------------------------------------------------------------------------
  // End-to-end: list → show → reject
  // -------------------------------------------------------------------------

  it("review list shows a manually seeded candidate", async () => {
    const cwd = await makeTempWorkspace("review-list-seed");
    try {
      const candidate = await writeCandidateFixture(cwd);
      const result = await runCLI(["review", "list"], cwd);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain(candidate.id);
    } finally {
      await cleanupDir(cwd);
    }
  }, 30_000);

  it("review show prints title and summary for a seeded candidate", async () => {
    const cwd = await makeTempWorkspace("review-show-seed");
    try {
      const candidate = await writeCandidateFixture(cwd, {
        title: "Semantic Indexing",
        summary: "How semantic indexes are built.",
      });
      const result = await runCLI(["review", "show", candidate.id], cwd);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Semantic Indexing");
      expect(result.stdout).toContain("How semantic indexes are built.");
    } finally {
      await cleanupDir(cwd);
    }
  }, 30_000);

  it("review reject moves candidate to archive and removes it from list", async () => {
    const cwd = await makeTempWorkspace("review-reject-e2e");
    try {
      const candidate = await writeCandidateFixture(cwd);

      const rejectResult = await runCLI(["review", "reject", candidate.id], cwd);
      expect(rejectResult.code).toBe(0);

      // Candidate no longer appears in list
      const listResult = await runCLI(["review", "list"], cwd);
      expect(listResult.stdout).not.toContain(candidate.id);
      expect(listResult.stdout.toLowerCase()).toContain("no pending");

      // Archived file exists
      const archivePath = path.join(
        cwd,
        ".llmwiki",
        "candidates",
        "archive",
        `${candidate.id}.json`,
      );
      await expect(access(archivePath)).resolves.toBeUndefined();
    } finally {
      await cleanupDir(cwd);
    }
  }, 30_000);

  // -------------------------------------------------------------------------
  // End-to-end: approve → wiki page written
  // -------------------------------------------------------------------------

  it("review approve writes the wiki page and clears the candidate", async () => {
    const cwd = await makeTempWorkspace("review-approve-e2e");
    try {
      const candidate = await writeCandidateFixture(cwd, {
        slug: "test-slug",
        title: "Test Concept",
      });

      const approveResult = await runCLI(["review", "approve", candidate.id], cwd);
      // Exit code 0 — embeddings warning is tolerated by design in approve
      expect(approveResult.code).toBe(0);

      // Wiki page written
      const pagePath = path.join(cwd, "wiki", "concepts", `${candidate.slug}.md`);
      await expect(access(pagePath)).resolves.toBeUndefined();

      // Candidate file removed from pending area
      const pendingFiles = await readdir(path.join(cwd, ".llmwiki", "candidates")).catch(
        () => [] as string[],
      );
      const jsonFiles = pendingFiles.filter((f) => f.endsWith(".json"));
      expect(jsonFiles).not.toContain(`${candidate.id}.json`);
    } finally {
      await cleanupDir(cwd);
    }
  }, 30_000);
});
