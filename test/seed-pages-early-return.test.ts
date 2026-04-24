/**
 * Regression tests for seed-page generation when no source files changed
 * (Finding 1).
 *
 * Before the fix, `runCompilePipeline` returned early when there was nothing to
 * compile, skipping `generateSeedPages`. Adding a seed page to schema.json in
 * an up-to-date project had no effect until a source file was also changed.
 *
 * After the fix, seed pages declared in the schema are always written — even
 * when the early-return path is taken — because they are cheap deterministic
 * writes that never require LLM extraction.
 */

import { describe, it, expect, vi } from "vitest";
import { mkdir, writeFile } from "fs/promises";
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
async function writeSchemaWithSeedPage(root: string, seedTitle: string): Promise<void> {
  await mkdir(path.join(root, ".llmwiki"), { recursive: true });
  const schema = {
    version: 1,
    defaultKind: "concept",
    kinds: {},
    seedPages: [
      { title: seedTitle, kind: "overview", summary: "A top-level overview." },
    ],
  };
  await writeFile(
    path.join(root, ".llmwiki", "schema.json"),
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
});
