/**
 * Tests for the multimodal ingest pipeline (PDF, image, transcript).
 *
 * Covers:
 *   - source-type detection routes paths to the right ingest module
 *   - frontmatter records sourceType per type
 *   - happy paths for transcript parsers (.vtt, .srt, .txt)
 *   - PDF title resolution (preserves Info.Title, falls back to filename)
 *   - requireNode20ForPdf throws a clear error when Node version is below 20
 *   - image ingest surfaces a clear error when the active provider is non-vision
 *   - YouTube URL detection routes to the transcript handler
 *
 * Heavy lifting (real PDF parsing, real Anthropic vision calls, real YouTube
 * fetches) is intentionally avoided so tests stay deterministic and offline.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "fs/promises";
import path from "path";
import os from "os";
import { detectSourceType, buildDocument, enforceCharLimit } from "../src/commands/ingest.js";
import { parseFrontmatter } from "../src/utils/markdown.js";
import ingestTranscript, { isYoutubeUrl } from "../src/ingest/transcript.js";
import { resolveTitle, requireNode20ForPdf } from "../src/ingest/pdf.js";
import ingestImage from "../src/ingest/image.js";

const tempDirsToCleanup: string[] = [];

async function makeTempFile(name: string, contents: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "llmwiki-multimodal-"));
  tempDirsToCleanup.push(dir);
  const filePath = path.join(dir, name);
  await writeFile(filePath, contents, "utf-8");
  return filePath;
}

afterEach(async () => {
  while (tempDirsToCleanup.length > 0) {
    const dir = tempDirsToCleanup.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe("detectSourceType", () => {
  it("routes .pdf paths to pdf", () => {
    expect(detectSourceType("/tmp/report.pdf")).toBe("pdf");
    expect(detectSourceType("./docs/spec.PDF")).toBe("pdf");
  });

  it("routes image extensions to image", () => {
    expect(detectSourceType("/tmp/photo.png")).toBe("image");
    expect(detectSourceType("/tmp/photo.jpg")).toBe("image");
    expect(detectSourceType("/tmp/photo.JPEG")).toBe("image");
    expect(detectSourceType("/tmp/anim.gif")).toBe("image");
    expect(detectSourceType("/tmp/pic.webp")).toBe("image");
  });

  it("routes transcript extensions to transcript", () => {
    expect(detectSourceType("/tmp/lecture.vtt")).toBe("transcript");
    expect(detectSourceType("/tmp/movie.srt")).toBe("transcript");
    expect(detectSourceType("/tmp/notes.txt")).toBe("transcript");
  });

  it("routes .md to file", () => {
    expect(detectSourceType("/tmp/notes.md")).toBe("file");
  });

  it("routes generic http(s) URLs to web", () => {
    expect(detectSourceType("https://example.com/article")).toBe("web");
    expect(detectSourceType("http://example.com/post")).toBe("web");
  });

  it("routes YouTube URLs to transcript", () => {
    expect(detectSourceType("https://www.youtube.com/watch?v=abc123")).toBe("transcript");
    expect(detectSourceType("https://youtu.be/abc123")).toBe("transcript");
  });
});

describe("buildDocument frontmatter sourceType", () => {
  it("records sourceType in frontmatter for each type", () => {
    const result = enforceCharLimit("hello world");
    for (const type of ["web", "file", "image", "pdf", "transcript"] as const) {
      const doc = buildDocument("Title", "src", result, type);
      const { meta } = parseFrontmatter(doc);
      expect(meta.sourceType).toBe(type);
    }
  });

  it("omits sourceType when not provided (legacy callers preserved)", () => {
    const result = enforceCharLimit("hello world");
    const doc = buildDocument("Title", "src", result);
    const { meta } = parseFrontmatter(doc);
    expect(meta.sourceType).toBeUndefined();
    expect(meta.title).toBe("Title");
  });
});

describe("isYoutubeUrl", () => {
  it("matches youtube.com/watch URLs", () => {
    expect(isYoutubeUrl("https://www.youtube.com/watch?v=abc")).toBe(true);
    expect(isYoutubeUrl("https://youtube.com/watch?v=abc")).toBe(true);
  });

  it("matches youtu.be short URLs", () => {
    expect(isYoutubeUrl("https://youtu.be/abc123")).toBe(true);
  });

  it("rejects non-YouTube URLs", () => {
    expect(isYoutubeUrl("https://example.com/watch?v=abc")).toBe(false);
    expect(isYoutubeUrl("https://vimeo.com/abc")).toBe(false);
  });
});

describe("transcript ingest", () => {
  it("parses VTT preserving timestamps and cues", async () => {
    const vtt = [
      "WEBVTT",
      "",
      "00:00:01.000 --> 00:00:04.000",
      "Alice: Welcome to the show.",
      "",
      "00:00:05.000 --> 00:00:08.000",
      "Bob: Thanks for having me.",
    ].join("\n");
    const filePath = await makeTempFile("ep.vtt", vtt);

    const result = await ingestTranscript(filePath);
    expect(result.title).toBe("ep");
    expect(result.content).toContain("00:00:01.000 --> 00:00:04.000");
    expect(result.content).toContain("Alice: Welcome to the show.");
    expect(result.content).toContain("Bob: Thanks for having me.");
  });

  it("parses SRT preserving timestamps and skipping sequence numbers", async () => {
    const srt = [
      "1",
      "00:00:01,000 --> 00:00:04,000",
      "Alice: Hello there.",
      "",
      "2",
      "00:00:05,000 --> 00:00:08,000",
      "Bob: General Kenobi.",
    ].join("\n");
    const filePath = await makeTempFile("clip.srt", srt);

    const result = await ingestTranscript(filePath);
    expect(result.title).toBe("clip");
    expect(result.content).toContain("00:00:01,000 --> 00:00:04,000");
    expect(result.content).toContain("Alice: Hello there.");
    expect(result.content).not.toMatch(/^1$/m);
  });

  it("parses plain .txt transcripts preserving speaker tags", async () => {
    const txt = "Alice: Hi.\nBob: Hello back.\n";
    const filePath = await makeTempFile("chat.txt", txt);

    const result = await ingestTranscript(filePath);
    expect(result.title).toBe("chat");
    expect(result.content).toContain("Alice: Hi.");
    expect(result.content).toContain("Bob: Hello back.");
  });

  it("rejects unsupported transcript extensions", async () => {
    const filePath = await makeTempFile("data.csv", "a,b,c");
    await expect(ingestTranscript(filePath)).rejects.toThrow(/Unsupported transcript file type/);
  });
});

describe("PDF ingest helpers", () => {
  it("resolveTitle prefers PDF Info.Title over filename", () => {
    const title = resolveTitle("/tmp/report.pdf", { Title: "Quarterly Report" });
    expect(title).toBe("Quarterly Report");
  });

  it("resolveTitle falls back to humanized filename when Info.Title is absent", () => {
    expect(resolveTitle("/tmp/quarterly_report.pdf", {})).toBe("quarterly report");
    expect(resolveTitle("/tmp/quarterly-report.pdf", undefined)).toBe("quarterly report");
  });

  it("resolveTitle ignores empty Info.Title", () => {
    const title = resolveTitle("/tmp/spec.pdf", { Title: "   " });
    expect(title).toBe("spec");
  });
});

describe("requireNode20ForPdf runtime check", () => {
  it("throws a clear error when the Node.js major version is below 20", () => {
    const original = process.version;
    Object.defineProperty(process, "version", { value: "v18.20.8", configurable: true });
    try {
      expect(() => requireNode20ForPdf()).toThrow(/PDF ingest requires Node\.js 20/);
      expect(() => requireNode20ForPdf()).toThrow(/v18\.20\.8/);
    } finally {
      Object.defineProperty(process, "version", { value: original, configurable: true });
    }
  });

  it("does not throw when running on Node 20+", () => {
    const original = process.version;
    Object.defineProperty(process, "version", { value: "v20.16.0", configurable: true });
    try {
      expect(() => requireNode20ForPdf()).not.toThrow();
    } finally {
      Object.defineProperty(process, "version", { value: original, configurable: true });
    }
  });
});

describe("image ingest provider gating", () => {
  it("throws a clear error when the active provider is not Anthropic", async () => {
    const original = process.env.LLMWIKI_PROVIDER;
    process.env.LLMWIKI_PROVIDER = "ollama";
    try {
      await expect(ingestImage("/tmp/anything.png")).rejects.toThrow(
        /Image ingest requires the Anthropic provider/,
      );
    } finally {
      if (original === undefined) delete process.env.LLMWIKI_PROVIDER;
      else process.env.LLMWIKI_PROVIDER = original;
    }
  });
});
