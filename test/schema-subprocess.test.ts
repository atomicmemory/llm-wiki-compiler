/**
 * Subprocess-level acceptance tests for the schema layer.
 *
 * These tests complement the in-process unit tests in schema-violations.test.ts
 * and seed-pages-early-return.test.ts by exercising the same behaviours through
 * the compiled CLI binary, closing the coverage gap identified by Codex.
 *
 * Test 1: Seed page generation — verifies that `compile` materialises a
 *   schema-declared seed page and rebuilds wiki/index.md even when no source
 *   files are present (early-return path). Requires a live Anthropic API key.
 *
 * Test 2: `review show` prints schema violations when present — a candidate
 *   JSON fixture with schemaViolations is written manually; the subprocess
 *   output is checked for the violations block and message text.
 *
 * Test 3: `review show` hides violations block when absent — same fixture
 *   without schemaViolations; the block header must not appear in output.
 *
 * dist/cli.js is built once via vitest globalSetup (see test/global-setup.ts).
 * Per-file beforeAll(npx tsup) calls are intentionally absent — see PR #21.
 */

import { describe, it, expect } from "vitest";
import path from "path";
import { mkdir, rm, writeFile, readFile } from "fs/promises";
import { existsSync } from "fs";
import { tmpdir } from "os";
import { runCLI, formatCLIFailure } from "./fixtures/run-cli.js";
import type { ReviewCandidate } from "../src/utils/types.js";
import type { LintResult } from "../src/linter/types.js";

// ---------------------------------------------------------------------------
// Workspace helpers
// ---------------------------------------------------------------------------

/** Create a fresh temporary project directory with a sources/ sub-folder. */
async function makeTempProject(label: string): Promise<string> {
  const dir = path.join(tmpdir(), `llmwiki-subproc-${label}-${Date.now()}`);
  await mkdir(path.join(dir, "sources"), { recursive: true });
  return dir;
}

/** Remove a temporary project directory. */
async function cleanupDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

/** Write schema.json with a single seed page declaration. */
async function writeSeedSchema(root: string, title: string): Promise<void> {
  const schemaDir = path.join(root, ".llmwiki");
  await mkdir(schemaDir, { recursive: true });
  const schema = {
    version: 1,
    defaultKind: "concept",
    kinds: {},
    seedPages: [
      { title, kind: "overview", summary: "A top-level domain overview." },
    ],
  };
  await writeFile(path.join(schemaDir, "schema.json"), JSON.stringify(schema, null, 2), "utf-8");
}

/** Build a minimal valid ReviewCandidate page body (frontmatter + body). */
function buildValidBody(title: string): string {
  const now = new Date().toISOString();
  return [
    "---",
    `title: "${title}"`,
    'summary: "A page for subprocess testing."',
    "sources: []",
    `createdAt: "${now}"`,
    `updatedAt: "${now}"`,
    "---",
    "",
    `# ${title}`,
    "",
    "Body content for subprocess test.",
  ].join("\n");
}

/** Write a ReviewCandidate JSON under .llmwiki/candidates/<id>.json. */
async function writeCandidateJson(
  root: string,
  candidate: ReviewCandidate,
): Promise<void> {
  const dir = path.join(root, ".llmwiki", "candidates");
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, `${candidate.id}.json`),
    JSON.stringify(candidate, null, 2),
    "utf-8",
  );
}

/**
 * Write a candidate JSON fixture and run `review show <id>` as a subprocess.
 * Returns the CLI result so callers can assert on stdout and exit code.
 * @param root - Temporary project root directory.
 * @param candidate - Candidate to persist and display.
 */
async function runReviewShow(
  root: string,
  candidate: ReviewCandidate,
): Promise<import("./fixtures/run-cli.js").CLIResult> {
  await writeCandidateJson(root, candidate);
  return runCLI(["review", "show", candidate.id], root);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("schema subprocess tests", () => {
  // -------------------------------------------------------------------------
  // Test 1: Seed page generation + index rebuild via subprocess
  // -------------------------------------------------------------------------

  it(
    "compile writes seed page and rebuilds index when no source files exist",
    async () => {
      const cwd = await makeTempProject("seed-gen");
      try {
        const title = "Domain Overview";
        const slug = "domain-overview";
        await writeSeedSchema(cwd, title);

        // requireProvider() runs before the early-return path, so we need
        // credentials env-vars set even though no LLM call will be made
        // (no source files → early-return → seed-page generation only).
        const result = await runCLI(["compile"], cwd, {
          ANTHROPIC_AUTH_TOKEN: "test-token-for-credential-check",
        });
        expect(result.code, `compile failed:\n${formatCLIFailure(result)}`).toBe(0);

        // Seed page must exist at the expected path
        const pagePath = path.join(cwd, "wiki", "concepts", `${slug}.md`);
        expect(existsSync(pagePath)).toBe(true);

        // Frontmatter must declare kind: overview
        const pageContent = await readFile(pagePath, "utf-8");
        expect(pageContent).toContain("kind: overview");

        // wiki/index.md must exist and reference the seed slug
        const indexPath = path.join(cwd, "wiki", "index.md");
        expect(existsSync(indexPath)).toBe(true);
        const indexContent = await readFile(indexPath, "utf-8");
        expect(indexContent).toContain(slug);
      } finally {
        await cleanupDir(cwd);
      }
    },
    60_000,
  );

  // -------------------------------------------------------------------------
  // Test 2: review show prints schema violations when present
  // -------------------------------------------------------------------------

  it("review show prints Schema violations block when candidate has violations", async () => {
    const cwd = await makeTempProject("show-violations");
    try {
      const violation: LintResult = {
        rule: "schema-cross-link-minimum",
        severity: "warning",
        file: "wiki/concepts/overview-page.md",
        message: 'Page kind "overview" requires at least 3 [[wikilinks]] but only 0 found.',
      };
      const candidate: ReviewCandidate = {
        id: "overview-page-aabbccdd",
        title: "Overview Page",
        slug: "overview-page",
        summary: "A test overview page.",
        sources: ["source.md"],
        body: buildValidBody("Overview Page"),
        generatedAt: new Date().toISOString(),
        schemaViolations: [violation],
      };

      const result = await runReviewShow(cwd, candidate);
      expect(result.code).toBe(0);
      // The header() helper wraps text in ANSI bold codes but the raw text is present
      expect(result.stdout).toContain("Schema violations");
      expect(result.stdout).toContain("requires at least 3");
    } finally {
      await cleanupDir(cwd);
    }
  }, 30_000);

  // -------------------------------------------------------------------------
  // Test 3: review show hides violations block when absent
  // -------------------------------------------------------------------------

  it("review show omits Schema violations block when candidate has no violations", async () => {
    const cwd = await makeTempProject("show-no-violations");
    try {
      const candidate: ReviewCandidate = {
        id: "clean-page-aabbccdd",
        title: "Clean Page",
        slug: "clean-page",
        summary: "A candidate with no schema violations.",
        sources: ["source.md"],
        body: buildValidBody("Clean Page"),
        generatedAt: new Date().toISOString(),
        // schemaViolations intentionally omitted — block must not appear
      };

      const result = await runReviewShow(cwd, candidate);
      expect(result.code).toBe(0);
      expect(result.stdout).not.toContain("Schema violations");
    } finally {
      await cleanupDir(cwd);
    }
  }, 30_000);
});
