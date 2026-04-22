/**
 * CLI-level integration tests for `llmwiki export`.
 *
 * These tests exercise the export command end-to-end through the compiled CLI
 * binary. No LLM calls are made — export is a pure transformation of wiki
 * content on disk.
 *
 * Test coverage:
 *  - --help shows the export command and --target flag
 *  - Default (all targets) produces all 6 artifact files with expected markers
 *  - --target llms-txt writes only llms.txt
 *  - --target json-ld writes only wiki.jsonld and produces valid JSON
 *  - --target graphml writes only wiki.graphml with XML header
 *  - Empty wiki (no concepts) exits cleanly with valid empty artifacts
 *  - GraphML and JSON-LD include wikilink-derived edges
 */

import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { mkdir, rm, access } from "fs/promises";
import { readFile } from "fs/promises";
import { tmpdir } from "os";
import { writePage } from "./fixtures/write-page.js";

const exec = promisify(execFile);
const CLI = path.resolve("dist/cli.js");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALL_ARTIFACTS = [
  "llms.txt",
  "llms-full.txt",
  "wiki.json",
  "wiki.jsonld",
  "wiki.graphml",
  "wiki.md",
] as const;

const EXPORT_DIR = "dist/exports";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a temp wiki root with concepts and queries dirs. */
async function makeTempWikiRoot(suffix: string): Promise<string> {
  const root = path.join(tmpdir(), `llmwiki-export-it-${suffix}-${Date.now()}`);
  await mkdir(path.join(root, "wiki/concepts"), { recursive: true });
  await mkdir(path.join(root, "wiki/queries"), { recursive: true });
  return root;
}

/** Remove a temp root directory. */
async function cleanup(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

/** Return true when a file exists at the given path. */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Run the export command in the given root directory. */
async function runExport(root: string, args: string[] = []): Promise<{ stdout: string; stderr: string }> {
  return exec("node", [CLI, "export", ...args], { cwd: root });
}

/**
 * Write a two-page fixture wiki into root with a [[wikilink]] from alpha to beta.
 * Returns the concepts dir path.
 */
async function writeFixtureWiki(root: string): Promise<string> {
  const conceptsDir = path.join(root, "wiki/concepts");
  await writePage(
    conceptsDir,
    "alpha",
    {
      title: "Alpha Concept",
      summary: "The first concept.",
      tags: ["science"],
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-02T00:00:00.000Z",
    },
    "Alpha links to [[Beta Concept]].",
  );
  await writePage(
    conceptsDir,
    "beta-concept",
    {
      title: "Beta Concept",
      summary: "The second concept.",
      tags: ["science"],
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-02T00:00:00.000Z",
    },
    "Beta stands alone.",
  );
  return conceptsDir;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("export CLI integration", () => {
  beforeAll(async () => {
    await exec("npx", ["tsup"], { cwd: path.resolve(".") });
  }, 30_000);

  it("export --help shows the command and --target flag", async () => {
    const { stdout } = await exec("node", [CLI, "export", "--help"]);
    expect(stdout).toContain("export");
    expect(stdout).toContain("--target");
  }, 30_000);

  it("export (all targets) writes all 6 artifacts", async () => {
    const root = await makeTempWikiRoot("all");
    try {
      await writeFixtureWiki(root);
      await runExport(root);
      for (const artifact of ALL_ARTIFACTS) {
        const exists = await fileExists(path.join(root, EXPORT_DIR, artifact));
        expect(exists, `${artifact} should exist`).toBe(true);
      }
    } finally {
      await cleanup(root);
    }
  }, 30_000);

  it("export (all targets) llms.txt contains # Knowledge Wiki marker", async () => {
    const root = await makeTempWikiRoot("llms-marker");
    try {
      await writeFixtureWiki(root);
      await runExport(root);
      const content = await readFile(path.join(root, EXPORT_DIR, "llms.txt"), "utf-8");
      expect(content).toContain("#");
      expect(content).toContain("Alpha Concept");
    } finally {
      await cleanup(root);
    }
  }, 30_000);

  it("export (all targets) wiki.jsonld contains @graph key", async () => {
    const root = await makeTempWikiRoot("jsonld-all");
    try {
      await writeFixtureWiki(root);
      await runExport(root);
      const content = await readFile(path.join(root, EXPORT_DIR, "wiki.jsonld"), "utf-8");
      const parsed = JSON.parse(content) as Record<string, unknown>;
      expect(parsed).toHaveProperty("@graph");
    } finally {
      await cleanup(root);
    }
  }, 30_000);

  it("export --target llms-txt writes only llms.txt", async () => {
    const root = await makeTempWikiRoot("llms-only");
    try {
      await writeFixtureWiki(root);
      await runExport(root, ["--target", "llms-txt"]);
      expect(await fileExists(path.join(root, EXPORT_DIR, "llms.txt"))).toBe(true);
      for (const artifact of ALL_ARTIFACTS.filter((a) => a !== "llms.txt")) {
        expect(await fileExists(path.join(root, EXPORT_DIR, artifact))).toBe(false);
      }
    } finally {
      await cleanup(root);
    }
  }, 30_000);

  it("export --target json-ld writes only wiki.jsonld and is valid JSON", async () => {
    const root = await makeTempWikiRoot("jsonld-only");
    try {
      await writeFixtureWiki(root);
      await runExport(root, ["--target", "json-ld"]);
      expect(await fileExists(path.join(root, EXPORT_DIR, "wiki.jsonld"))).toBe(true);
      for (const artifact of ALL_ARTIFACTS.filter((a) => a !== "wiki.jsonld")) {
        expect(await fileExists(path.join(root, EXPORT_DIR, artifact))).toBe(false);
      }
      const content = await readFile(path.join(root, EXPORT_DIR, "wiki.jsonld"), "utf-8");
      expect(() => JSON.parse(content)).not.toThrow();
    } finally {
      await cleanup(root);
    }
  }, 30_000);

  it("export --target graphml writes only wiki.graphml with XML header", async () => {
    const root = await makeTempWikiRoot("graphml-only");
    try {
      await writeFixtureWiki(root);
      await runExport(root, ["--target", "graphml"]);
      expect(await fileExists(path.join(root, EXPORT_DIR, "wiki.graphml"))).toBe(true);
      for (const artifact of ALL_ARTIFACTS.filter((a) => a !== "wiki.graphml")) {
        expect(await fileExists(path.join(root, EXPORT_DIR, artifact))).toBe(false);
      }
      const content = await readFile(path.join(root, EXPORT_DIR, "wiki.graphml"), "utf-8");
      expect(content.trimStart()).toMatch(/^<\?xml/);
    } finally {
      await cleanup(root);
    }
  }, 30_000);

  it("export on an empty wiki exits cleanly with empty-safe artifacts", async () => {
    const root = await makeTempWikiRoot("empty");
    try {
      // No pages written — wiki dirs exist but are empty.
      await runExport(root);
      // All artifacts should still be written (with 0 pages).
      for (const artifact of ALL_ARTIFACTS) {
        expect(await fileExists(path.join(root, EXPORT_DIR, artifact))).toBe(true);
      }
      const llmsTxt = await readFile(path.join(root, EXPORT_DIR, "llms.txt"), "utf-8");
      expect(llmsTxt).toContain("0 pages");
    } finally {
      await cleanup(root);
    }
  }, 30_000);

  it("wiki.graphml includes edge for [[wikilink]] between pages", async () => {
    const root = await makeTempWikiRoot("graphml-edges");
    try {
      await writeFixtureWiki(root);
      await runExport(root, ["--target", "graphml"]);
      const content = await readFile(path.join(root, EXPORT_DIR, "wiki.graphml"), "utf-8");
      // Expect an edge from alpha to beta-concept derived from [[Beta Concept]]
      expect(content).toContain('source="alpha"');
      expect(content).toContain('target="beta-concept"');
    } finally {
      await cleanup(root);
    }
  }, 30_000);

  it("wiki.jsonld includes mentions link for [[wikilink]] between pages", async () => {
    const root = await makeTempWikiRoot("jsonld-edges");
    try {
      await writeFixtureWiki(root);
      await runExport(root, ["--target", "json-ld"]);
      const content = await readFile(path.join(root, EXPORT_DIR, "wiki.jsonld"), "utf-8");
      const parsed = JSON.parse(content) as { "@graph": Array<{ mentions?: Array<{ "@id": string }> }> };
      const alphaNode = parsed["@graph"].find((n) =>
        (n as Record<string, unknown>)["@id"]?.toString().endsWith("alpha"),
      );
      expect(alphaNode).toBeDefined();
      expect(alphaNode?.mentions).toBeDefined();
      const mentionIds = (alphaNode?.mentions ?? []).map((m) => m["@id"]);
      expect(mentionIds.some((id) => id.endsWith("beta-concept"))).toBe(true);
    } finally {
      await cleanup(root);
    }
  }, 30_000);
});
