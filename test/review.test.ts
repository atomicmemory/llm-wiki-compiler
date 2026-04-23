/**
 * Tests for the candidate review queue: candidate persistence, approve/reject
 * CLI actions, and the compile pipeline's --review opt-in. The compile
 * integration test stubs the LLM provider so no network calls are made.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, readdir, readFile, writeFile, rm } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import os from "os";
import {
  archiveCandidate,
  countCandidates,
  deleteCandidate,
  listCandidates,
  readCandidate,
  writeCandidate,
} from "../src/compiler/candidates.js";
import reviewApproveCommand from "../src/commands/review-approve.js";
import reviewRejectCommand from "../src/commands/review-reject.js";
import reviewListCommand from "../src/commands/review-list.js";
import reviewShowCommand from "../src/commands/review-show.js";
import { compileAndReport } from "../src/compiler/index.js";
import {
  CANDIDATES_ARCHIVE_DIR,
  CANDIDATES_DIR,
  CONCEPTS_DIR,
} from "../src/utils/constants.js";

const VALID_BODY = [
  "---",
  "title: Sample Concept",
  'summary: "A sample summary"',
  "sources:",
  '  - "source.md"',
  'createdAt: "2026-01-01T00:00:00.000Z"',
  'updatedAt: "2026-01-01T00:00:00.000Z"',
  "tags: []",
  "aliases: []",
  "---",
  "",
  "Body content for the sample concept page.",
  "",
].join("\n");

let tmpDir: string;
let originalCwd: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "review-test-"));
  await mkdir(path.join(tmpDir, "wiki/concepts"), { recursive: true });
  await mkdir(path.join(tmpDir, "wiki/queries"), { recursive: true });
  await mkdir(path.join(tmpDir, "sources"), { recursive: true });
  originalCwd = process.cwd();
  process.chdir(tmpDir);
});

afterEach(async () => {
  process.chdir(originalCwd);
  await rm(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function sampleDraft(slug = "sample-concept") {
  return {
    title: "Sample Concept",
    slug,
    summary: "A sample summary",
    sources: ["source.md"],
    body: VALID_BODY,
  };
}

describe("candidates module", () => {
  it("writes a candidate JSON file under .llmwiki/candidates/", async () => {
    const candidate = await writeCandidate(tmpDir, sampleDraft());
    expect(candidate.id).toMatch(/^sample-concept-[0-9a-f]+$/);

    const filePath = path.join(tmpDir, CANDIDATES_DIR, `${candidate.id}.json`);
    expect(existsSync(filePath)).toBe(true);
  });

  it("reads back a written candidate verbatim", async () => {
    const candidate = await writeCandidate(tmpDir, sampleDraft());
    const loaded = await readCandidate(tmpDir, candidate.id);
    expect(loaded).toEqual(candidate);
  });

  it("lists pending candidates sorted by generation time", async () => {
    const first = await writeCandidate(tmpDir, sampleDraft("alpha"));
    // Sleep-free ordering: rewrite generatedAt explicitly so the test never races.
    const filePath = path.join(tmpDir, CANDIDATES_DIR, `${first.id}.json`);
    const earlier = { ...first, generatedAt: "2025-01-01T00:00:00.000Z" };
    await writeFile(filePath, JSON.stringify(earlier, null, 2));

    const second = await writeCandidate(tmpDir, sampleDraft("beta"));
    const all = await listCandidates(tmpDir);
    expect(all.map((c) => c.id)).toEqual([first.id, second.id]);
  });

  it("counts candidates without parsing each file body", async () => {
    await writeCandidate(tmpDir, sampleDraft("alpha"));
    await writeCandidate(tmpDir, sampleDraft("beta"));
    expect(await countCandidates(tmpDir)).toBe(2);
  });

  it("countCandidates and listCandidates agree even with malformed JSON files", async () => {
    await writeCandidate(tmpDir, sampleDraft("good"));
    // Drop a syntactically-broken candidate file alongside the valid one.
    const candidatesDir = path.join(tmpDir, CANDIDATES_DIR);
    await writeFile(
      path.join(candidatesDir, "broken-candidate.json"),
      "{ this is not valid json",
      "utf-8",
    );

    const listed = await listCandidates(tmpDir);
    const counted = await countCandidates(tmpDir);
    expect(counted).toBe(listed.length);
    expect(counted).toBe(1);
  });

  it("returns null when reading a missing candidate", async () => {
    expect(await readCandidate(tmpDir, "no-such-id")).toBeNull();
  });

  it("deletes a candidate and reports whether it existed", async () => {
    const candidate = await writeCandidate(tmpDir, sampleDraft());
    expect(await deleteCandidate(tmpDir, candidate.id)).toBe(true);
    expect(existsSync(path.join(tmpDir, CANDIDATES_DIR, `${candidate.id}.json`))).toBe(false);
    expect(await deleteCandidate(tmpDir, candidate.id)).toBe(false);
  });

  it("archives a rejected candidate without removing the record", async () => {
    const candidate = await writeCandidate(tmpDir, sampleDraft());
    expect(await archiveCandidate(tmpDir, candidate.id)).toBe(true);

    const pending = path.join(tmpDir, CANDIDATES_DIR, `${candidate.id}.json`);
    const archived = path.join(tmpDir, CANDIDATES_ARCHIVE_DIR, `${candidate.id}.json`);
    expect(existsSync(pending)).toBe(false);
    expect(existsSync(archived)).toBe(true);
  });
});

describe("review approve command", () => {
  it("writes the candidate body into wiki/concepts and clears the candidate", async () => {
    const candidate = await writeCandidate(tmpDir, sampleDraft());
    vi.spyOn(console, "log").mockImplementation(() => {});

    await reviewApproveCommand(candidate.id);

    const pagePath = path.join(tmpDir, CONCEPTS_DIR, "sample-concept.md");
    expect(existsSync(pagePath)).toBe(true);
    const content = await readFile(pagePath, "utf-8");
    expect(content).toBe(VALID_BODY);

    const candidateFile = path.join(tmpDir, CANDIDATES_DIR, `${candidate.id}.json`);
    expect(existsSync(candidateFile)).toBe(false);
  });

  it("rejects approval when the candidate body is invalid", async () => {
    const draft = { ...sampleDraft("broken"), body: "no frontmatter here" };
    const candidate = await writeCandidate(tmpDir, draft);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await reviewApproveCommand(candidate.id);

    expect(process.exitCode).toBe(1);
    expect(existsSync(path.join(tmpDir, CONCEPTS_DIR, "broken.md"))).toBe(false);
    process.exitCode = 0;
    errorSpy.mockRestore();
  });
});

describe("review reject command", () => {
  it("archives the candidate without touching wiki/concepts", async () => {
    const candidate = await writeCandidate(tmpDir, sampleDraft());
    vi.spyOn(console, "log").mockImplementation(() => {});

    await reviewRejectCommand(candidate.id);

    expect(existsSync(path.join(tmpDir, CONCEPTS_DIR, "sample-concept.md"))).toBe(false);
    const archivePath = path.join(tmpDir, CANDIDATES_ARCHIVE_DIR, `${candidate.id}.json`);
    expect(existsSync(archivePath)).toBe(true);
  });

  it("sets exit code 1 when the candidate is missing", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await reviewRejectCommand("missing-id-x");
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });
});

describe("review list and show commands", () => {
  it("list reports a quiet message when no candidates exist", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await reviewListCommand();
    const allOutput = logSpy.mock.calls.map((args) => args.join(" ")).join("\n");
    expect(allOutput).toContain("No pending candidates.");
  });

  it("show prints the candidate id, slug, and body", async () => {
    const candidate = await writeCandidate(tmpDir, sampleDraft());
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await reviewShowCommand(candidate.id);
    const allOutput = logSpy.mock.calls.map((args) => args.join(" ")).join("\n");
    expect(allOutput).toContain(candidate.id);
    expect(allOutput).toContain("sample-concept");
    expect(allOutput).toContain("Body content for the sample concept page.");
  });
});

describe("compile --review pipeline integration", () => {
  it("creates candidates and leaves wiki/ untouched", async () => {
    await writeFile(
      path.join(tmpDir, "sources", "topic.md"),
      "# Topic\nA brief article about a single topic.",
    );

    const llm = await import("../src/utils/llm.js");
    const callSpy = vi.spyOn(llm, "callClaude").mockImplementation(async ({ tools }) => {
      if (tools && tools.length > 0) {
        return JSON.stringify({
          concepts: [
            { concept: "Topic", summary: "A topic.", is_new: true, tags: ["intro"] },
          ],
        });
      }
      return "## Topic\n\nThe page body for the topic.";
    });

    const result = await compileAndReport(tmpDir, { review: true });
    expect(callSpy).toHaveBeenCalled();
    expect(result.candidates ?? []).toHaveLength(1);

    // Pages on disk: only the candidate, never the wiki page.
    const conceptsDir = path.join(tmpDir, CONCEPTS_DIR);
    expect(existsSync(path.join(conceptsDir, "topic.md"))).toBe(false);

    const candidateFiles = await readdir(path.join(tmpDir, CANDIDATES_DIR));
    expect(candidateFiles.filter((f) => f.endsWith(".json"))).toHaveLength(1);
  });

  /**
   * End-to-end incremental-state regression test for Finding 1.
   *
   * Prior to the fix, `compile --review` skipped state.json writes entirely.
   * That left every approved source still flagged "new" in change detection,
   * so the next compile would regenerate the same candidate over and over.
   * Approving a candidate must persist its source-state snapshot so the
   * source is treated as "unchanged" on subsequent compiles.
   */
  it("does not regenerate a candidate for a source that was approved", async () => {
    await writeFile(
      path.join(tmpDir, "sources", "topic.md"),
      "# Topic\nA brief article about a single topic.",
    );

    const llm = await import("../src/utils/llm.js");
    vi.spyOn(llm, "callClaude").mockImplementation(async ({ tools }) => {
      if (tools && tools.length > 0) {
        return JSON.stringify({
          concepts: [
            { concept: "Topic", summary: "A topic.", is_new: true, tags: [] },
          ],
        });
      }
      return VALID_BODY;
    });
    vi.spyOn(console, "log").mockImplementation(() => {});

    const first = await compileAndReport(tmpDir, { review: true });
    expect(first.candidates).toHaveLength(1);

    const candidateId = first.candidates![0];
    await reviewApproveCommand(candidateId);

    const second = await compileAndReport(tmpDir, { review: true });
    expect(second.candidates ?? []).toHaveLength(0);
    expect(second.compiled).toBe(0);
    expect(second.skipped).toBeGreaterThanOrEqual(1);
  });
});
