/**
 * Regression tests for seed-page generation when no source files changed
 * (Finding 1 and Finding 2).
 *
 * Finding 1 — before the fix, `runCompilePipeline` returned early when there
 * was nothing to compile, skipping `generateSeedPages`. Adding a seed page to
 * schema.json in an up-to-date project had no effect until a source file was
 * also changed.  After the fix, seed pages are always written on the early-
 * return path and `finalizeWiki` is called so wiki/index.md and wiki/MOC.md
 * are rebuilt to include the new seed page.
 *
 * Finding 2 — before the fix, errors collected by `generateSeedPages` were
 * discarded on the early-return path because the temporary `emptyGeneration`
 * object was never threaded into the returned `CompileResult`. After the fix,
 * `emptyGeneration.errors` is propagated into the result.
 */

import { describe, it, expect, vi } from "vitest";
import { mkdir, writeFile, readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { compileAndReport } from "../src/compiler/index.js";
import { CONCEPTS_DIR } from "../src/utils/constants.js";
import { useTempRoot } from "./fixtures/temp-root.js";

const root = useTempRoot(["sources"]);

/** Stub callClaude so seed-page body generation never hits the network. */
async function stubLLMForSeedPage(seedTitle: string): Promise<void> {
  const llm = await import("../src/utils/llm.js");
  vi.spyOn(llm, "callClaude").mockImplementation(async ({ tools }) => {
    if (tools && tools.length > 0) {
      // Extraction call — return zero concepts (no source to extract from)
      return JSON.stringify({ concepts: [] });
    }
    // Seed-page body generation call
    return `## ${seedTitle}\n\nThis is a seed page overview.\n`;
  });
}

/** Write a schema declaring one overview seed page. */
async function writeSchemaWithSeedPage(rootDir: string, seedTitle: string): Promise<void> {
  await mkdir(path.join(rootDir, ".llmwiki"), { recursive: true });
  const schema = {
    version: 1,
    defaultKind: "concept",
    kinds: {},
    seedPages: [
      { title: seedTitle, kind: "overview", summary: "A top-level overview." },
    ],
  };
  await writeFile(
    path.join(rootDir, ".llmwiki", "schema.json"),
    JSON.stringify(schema, null, 2),
  );
}

describe("seed pages generated when no source files changed", () => {
  it("creates the seed page even when all sources are up to date", async () => {
    const seedTitle = "Project Overview";
    await writeSchemaWithSeedPage(root.dir, seedTitle);
    await stubLLMForSeedPage(seedTitle);
    vi.spyOn(console, "log").mockImplementation(() => {});

    // No sources present → compile detects nothing to compile and would
    // previously early-return before generating seed pages.
    const result = await compileAndReport(root.dir, {});
    expect(result.compiled).toBe(0);

    // The seed page must be written to wiki/concepts/<slug>.md
    const seedPath = path.join(root.dir, CONCEPTS_DIR, "project-overview.md");
    expect(existsSync(seedPath)).toBe(true);
  });

  it("rebuilds wiki/index.md after writing seed pages on the early-return path", async () => {
    const seedTitle = "Domain Overview";
    await writeSchemaWithSeedPage(root.dir, seedTitle);
    await stubLLMForSeedPage(seedTitle);
    vi.spyOn(console, "log").mockImplementation(() => {});

    await compileAndReport(root.dir, {});

    // wiki/index.md must exist and reference the newly-written seed page
    const indexPath = path.join(root.dir, "wiki", "index.md");
    expect(existsSync(indexPath)).toBe(true);
    const indexContent = await readFile(indexPath, "utf-8");
    expect(indexContent).toContain("domain-overview");
  });

  it("does not generate seed pages in review mode (review keeps wiki/ clean)", async () => {
    const seedTitle = "Review Overview";
    await writeSchemaWithSeedPage(root.dir, seedTitle);
    await stubLLMForSeedPage(seedTitle);
    vi.spyOn(console, "log").mockImplementation(() => {});

    await compileAndReport(root.dir, { review: true });

    // Seed pages must not land in wiki/ when running in review mode
    const seedPath = path.join(root.dir, CONCEPTS_DIR, "review-overview.md");
    expect(existsSync(seedPath)).toBe(false);
  });

  it("propagates seed-page validation errors into CompileResult on the early-return path", async () => {
    const seedTitle = "Broken Overview";
    await writeSchemaWithSeedPage(root.dir, seedTitle);
    await stubLLMForSeedPage(seedTitle);
    vi.spyOn(console, "log").mockImplementation(() => {});

    // Force validateWikiPage to reject the seed page so an error is recorded
    const markdownUtils = await import("../src/utils/markdown.js");
    vi.spyOn(markdownUtils, "validateWikiPage").mockReturnValue(false);

    const result = await compileAndReport(root.dir, {});

    // The seed-page error must surface in CompileResult.errors
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.includes("Broken Overview"))).toBe(true);
  });
});
