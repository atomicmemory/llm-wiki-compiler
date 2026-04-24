/**
 * CLI-level integration tests for the multimodal ingest command.
 *
 * These tests exercise the full CLI code path — spawning `node dist/cli.js
 * ingest <file>` — for each supported source type, verifying that routing,
 * frontmatter, and content extraction all work together end-to-end.
 *
 * Scope:
 *  - `ingest --help` shows help and exits 0
 *  - VTT transcript: written with sourceType transcript, timestamps preserved
 *  - SRT transcript: written with sourceType transcript, timestamps preserved
 *  - Plain-text transcript with speaker tags: routes to transcript adapter
 *  - PDF: written with sourceType pdf, text extracted
 *  - Image without credentials: exits non-zero with actionable error message
 *  - Extension routing verified end-to-end for .vtt, .srt, and .pdf
 *
 * Tests that require real vision API calls (actual image description) are
 * intentionally absent — they would cost quota and are non-deterministic.
 * The credential-failure path for image ingest IS tested here as an
 * offline-safe proxy for source-type routing correctness.
 *
 * All fixture files are written to a tmp directory and cleaned up after each test.
 */

import { describe, it, expect, afterEach } from "vitest";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { mkdtemp, rm, readdir, readFile, writeFile } from "fs/promises";
import { tmpdir } from "os";

const exec = promisify(execFile);
const CLI = path.resolve("dist/cli.js");

/** Minimal valid PDF with the text "Hello PDF World". */
const MINIMAL_PDF_CONTENT = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]
/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length 52 >>
stream
BT /F1 12 Tf 72 720 Td (Hello PDF World) Tj ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000274 00000 n
0000000378 00000 n
trailer
<< /Size 6 /Root 1 0 R >>
startxref
449
%%EOF`;

const VTT_CONTENT = [
  "WEBVTT",
  "",
  "00:00:01.000 --> 00:00:04.000",
  "Alice: Good morning.",
  "",
  "00:00:05.000 --> 00:00:08.000",
  "Bob: Hello there.",
].join("\n");

const SRT_CONTENT = [
  "1",
  "00:00:01,000 --> 00:00:04,000",
  "Alice: Good morning.",
  "",
  "2",
  "00:00:05,000 --> 00:00:08,000",
  "Bob: Hello there.",
].join("\n");

const PLAIN_TRANSCRIPT_CONTENT = "Alice: Hi there.\nBob: Hello back.\n";

/** Isolated workspace with its own sources/ directory. */
interface Workspace {
  cwd: string;
  fixturePath: string;
}

const tempDirs: string[] = [];

async function makeWorkspace(fixtureName: string, content: string | Buffer): Promise<Workspace> {
  const cwd = await mkdtemp(path.join(tmpdir(), "llmwiki-ingest-integration-"));
  tempDirs.push(cwd);
  const fixturePath = path.join(cwd, fixtureName);
  await writeFile(fixturePath, content);
  return { cwd, fixturePath };
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

/** Read the first .md file found in sources/ within cwd. */
async function readIngestedMarkdown(cwd: string): Promise<string> {
  const sourcesDir = path.join(cwd, "sources");
  const files = await readdir(sourcesDir);
  const mdFile = files.find((f) => f.endsWith(".md"));
  if (!mdFile) throw new Error(`No .md file in ${sourcesDir}; found: ${files.join(", ")}`);
  return readFile(path.join(sourcesDir, mdFile), "utf-8");
}

/** Run ingest on a fixture and return the written markdown. */
async function runIngest(workspace: Workspace): Promise<{ stdout: string; markdown: string }> {
  const { stdout } = await exec("node", [CLI, "ingest", workspace.fixturePath], {
    cwd: workspace.cwd,
  });
  const markdown = await readIngestedMarkdown(workspace.cwd);
  return { stdout, markdown };
}

/** Assert that a transcript ingest emits correct frontmatter and content markers. */
async function assertTranscriptIngest(
  fixtureName: string,
  content: string,
  timestampMarker: string,
): Promise<void> {
  const workspace = await makeWorkspace(fixtureName, content);
  const { stdout, markdown } = await runIngest(workspace);
  expect(stdout).toContain("Next: llmwiki compile");
  expect(markdown).toContain("sourceType: transcript");
  expect(markdown).toContain(timestampMarker);
  expect(markdown).toContain("Alice: Good morning.");
}

/** Assert that a file's extension routes to the given sourceType (and not another). */
async function assertExtensionRouting(
  fixtureName: string,
  content: string | Buffer,
  expectedSourceType: string,
): Promise<void> {
  const workspace = await makeWorkspace(fixtureName, content);
  await exec("node", [CLI, "ingest", workspace.fixturePath], { cwd: workspace.cwd });
  const markdown = await readIngestedMarkdown(workspace.cwd);
  expect(markdown).toContain(`sourceType: ${expectedSourceType}`);
  expect(markdown).not.toContain("sourceType: file");
}

describe("multimodal ingest CLI integration", () => {
  // dist/cli.js is built once via vitest globalSetup (test/global-setup.ts)

  it("ingest --help shows help and exits 0", async () => {
    const { stdout } = await exec("node", [CLI, "ingest", "--help"]);
    expect(stdout).toContain("ingest");
    expect(stdout).toContain("source");
  }, 15_000);

  it("ingest a .vtt transcript writes markdown with sourceType transcript", async () => {
    await assertTranscriptIngest("meeting.vtt", VTT_CONTENT, "00:00:01.000 --> 00:00:04.000");
  }, 15_000);

  it("ingest a .srt transcript writes markdown with sourceType transcript", async () => {
    await assertTranscriptIngest("subtitles.srt", SRT_CONTENT, "00:00:01,000 --> 00:00:04,000");
  }, 15_000);

  it("ingest a plain-text .txt transcript with speaker tags routes to transcript adapter", async () => {
    const workspace = await makeWorkspace("chat.txt", PLAIN_TRANSCRIPT_CONTENT);
    const { markdown } = await runIngest(workspace);
    expect(markdown).toContain("sourceType: transcript");
    expect(markdown).toContain("Alice: Hi there.");
    expect(markdown).toContain("Bob: Hello back.");
  }, 15_000);

  it("ingest a .pdf writes markdown with sourceType pdf and extracted text", async () => {
    const workspace = await makeWorkspace("sample.pdf", MINIMAL_PDF_CONTENT);
    const { stdout, markdown } = await runIngest(workspace);
    expect(stdout).toContain("Next: llmwiki compile");
    expect(markdown).toContain("sourceType: pdf");
    expect(markdown).toContain("Hello PDF World");
  }, 15_000);

  it("ingest a .png without provider credentials fails with actionable error", async () => {
    // A 1x1 PNG (minimal valid PNG bytes) — no real vision call is made
    // because the credential check happens before any network request.
    const minimalPng = Buffer.from(
      "89504e470d0a1a0a0000000d49484452000000010000000108020000009001" +
      "2e00000000c4944415478016360f8cfc00000000200016be617960000000049454e44ae426082",
      "hex",
    );
    const workspace = await makeWorkspace("photo.png", minimalPng);

    try {
      await exec("node", [CLI, "ingest", workspace.fixturePath], {
        cwd: workspace.cwd,
        env: { ...process.env, ANTHROPIC_API_KEY: "", ANTHROPIC_AUTH_TOKEN: "", LLMWIKI_PROVIDER: "ollama" },
      });
      expect.fail("should have exited non-zero");
    } catch (err: unknown) {
      const error = err as { stderr?: string; stdout?: string; code?: number };
      expect(error.code).not.toBe(0);
      const combined = (error.stderr ?? "") + (error.stdout ?? "");
      expect(combined).toMatch(/anthropic/i);
      expect(combined).toMatch(/provider|vision/i);
    }
  }, 15_000);

  it("source-type detection routes .vtt by extension through the full CLI", async () => {
    // If extension routing broke, the file would be rejected or get wrong frontmatter.
    await assertExtensionRouting("episode.vtt", VTT_CONTENT, "transcript");
  }, 15_000);

  it("source-type detection routes .srt by extension through the full CLI", async () => {
    await assertExtensionRouting("clip.srt", SRT_CONTENT, "transcript");
  }, 15_000);

  it("source-type detection routes .pdf by extension through the full CLI", async () => {
    await assertExtensionRouting("report.pdf", MINIMAL_PDF_CONTENT, "pdf");
  }, 15_000);
});
