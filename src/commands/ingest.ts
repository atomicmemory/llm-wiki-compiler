/**
 * Commander action for `llmwiki ingest <source>`.
 *
 * Detects the source type (URL, image, PDF, transcript, or generic file),
 * delegates to the appropriate ingestion module, and saves the result as a
 * markdown file with YAML frontmatter in the sources/ directory.
 *
 * Source type is persisted in frontmatter under the `sourceType` key for
 * downstream tooling and human readers.
 */

import path from "path";
import { mkdir, readFile, writeFile } from "fs/promises";
import { slugify, buildFrontmatter } from "../utils/markdown.js";
import { MAX_SOURCE_CHARS, MIN_SOURCE_CHARS, SOURCES_DIR, IMAGE_EXTENSIONS, TRANSCRIPT_EXTENSIONS } from "../utils/constants.js";
import * as output from "../utils/output.js";
import ingestWeb from "../ingest/web.js";
import ingestFile from "../ingest/file.js";
import ingestPdf from "../ingest/pdf.js";
import ingestImage from "../ingest/image.js";
import ingestTranscript, { isYoutubeUrl } from "../ingest/transcript.js";
import type { IngestResult, SourceType } from "../utils/types.js";

/** Check whether a source string looks like a URL. */
function isUrl(source: string): boolean {
  return source.startsWith("http://") || source.startsWith("https://");
}

/** Number of bytes to peek at when sniffing .txt content for transcript signals. */
const TXT_SNIFF_BYTES = 2048;

/**
 * Regex for a speaker-tag line: "Name: " or "Name (timestamp): ".
 * Allows names up to ~40 chars with letters, spaces, dots, apostrophes, hyphens.
 */
const SPEAKER_TAG_PATTERN = /^[A-Z][a-zA-Z .'-]{0,40}:\s/m;

/**
 * Regex for a bare timestamp: "H:MM" or "HH:MM" or "HH:MM:SS" occurring at the
 * start of several lines (transcripts often have many such markers).
 */
const TIMESTAMP_PATTERN = /\d{1,2}:\d{2}(:\d{2})?/;

/** Minimum number of timestamp-like matches to treat a file as a transcript. */
const MIN_TIMESTAMP_MATCHES = 3;

/**
 * Peek at the first {@link TXT_SNIFF_BYTES} of a plain-text file and decide
 * whether it looks like a conversation transcript.
 *
 * Heuristic: at least one of the following must be true in the sampled content:
 *  1. A speaker-tag line starting with "Name: " (e.g. "Alice: Hi.").
 *  2. Three or more bare timestamp patterns (e.g. "01:23" / "1:23:45"), which
 *     is the signature of a time-coded script or subtitle-like plain file.
 *
 * When neither signal fires the caller should route the file as a generic text
 * file, not a transcript.
 *
 * @param filePath - Absolute or relative path to the .txt file.
 * @returns `true` when transcript signals are detected, `false` otherwise.
 */
async function looksLikeTxtTranscript(filePath: string): Promise<boolean> {
  const raw = await readFile(filePath, "utf-8");
  const sample = raw.slice(0, TXT_SNIFF_BYTES);

  if (SPEAKER_TAG_PATTERN.test(sample)) return true;

  const timestampMatches = sample.match(new RegExp(TIMESTAMP_PATTERN.source, "g"));
  return (timestampMatches?.length ?? 0) >= MIN_TIMESTAMP_MATCHES;
}

/** Truncate result including whether truncation occurred and original length. */
interface TruncateResult {
  content: string;
  truncated: boolean;
  originalChars: number;
}

/** Truncate content if it exceeds the character limit, logging a warning. */
export function enforceCharLimit(content: string): TruncateResult {
  if (content.length <= MAX_SOURCE_CHARS) {
    return { content, truncated: false, originalChars: content.length };
  }

  output.status(
    "!",
    output.warn(
      `Content truncated from ${content.length.toLocaleString()} to ${MAX_SOURCE_CHARS.toLocaleString()} characters.`
    )
  );
  return {
    content: content.slice(0, MAX_SOURCE_CHARS),
    truncated: true,
    originalChars: content.length,
  };
}

/** Reject empty content and warn when content is trivially short. */
function enforceMinContent(content: string): void {
  const length = content.trim().length;

  if (length === 0) {
    throw new Error(
      "No readable content could be extracted from the source."
    );
  }

  if (length < MIN_SOURCE_CHARS) {
    output.status(
      "!",
      output.warn(
        `Content seems very short (${length} chars, minimum recommended is ${MIN_SOURCE_CHARS}).`
      )
    );
  }
}

/**
 * Determine the source type for a given source string.
 *
 * For `.txt` files, content-sniffing is used instead of a pure extension check.
 * The file's first {@link TXT_SNIFF_BYTES} bytes are inspected for transcript
 * signals (speaker-tag lines or repeated timestamps). Only when both heuristics
 * fail is the file routed to the generic `file` adapter. `.vtt` and `.srt` are
 * always treated as transcripts regardless of content.
 *
 * @param source - A URL, local file path, or image path.
 * @returns The detected SourceType.
 */
export async function detectSourceType(source: string): Promise<SourceType> {
  if (!isUrl(source)) {
    const ext = path.extname(source).toLowerCase();
    if (ext === ".pdf") return "pdf";
    if (IMAGE_EXTENSIONS.has(ext)) return "image";
    if (TRANSCRIPT_EXTENSIONS.has(ext)) return "transcript";
    if (ext === ".txt") {
      const isTranscript = await looksLikeTxtTranscript(source);
      return isTranscript ? "transcript" : "file";
    }
    return "file";
  }

  if (isYoutubeUrl(source)) return "transcript";
  return "web";
}

/** Build the full markdown document with frontmatter. */
export function buildDocument(
  title: string,
  source: string,
  result: TruncateResult,
  sourceType?: SourceType,
): string {
  const meta: Record<string, unknown> = {
    title,
    source,
    ingestedAt: new Date().toISOString(),
  };
  if (sourceType !== undefined) {
    meta.sourceType = sourceType;
  }
  if (result.truncated) {
    meta.truncated = true;
    meta.originalChars = result.originalChars;
  }
  const frontmatter = buildFrontmatter(meta);

  return `${frontmatter}\n\n${result.content}\n`;
}

/** Fetch content from the appropriate ingestion module based on source type. */
async function fetchContent(
  source: string,
  sourceType: SourceType,
): Promise<{ title: string; content: string }> {
  switch (sourceType) {
    case "web":
      return ingestWeb(source);
    case "pdf":
      return ingestPdf(source);
    case "image":
      return ingestImage(source);
    case "transcript":
      return ingestTranscript(source);
    case "file":
      return ingestFile(source);
  }
}

/** Write the ingested document to the sources/ directory. */
async function saveSource(title: string, document: string): Promise<string> {
  const filename = `${slugify(title)}.md`;
  const destPath = path.join(SOURCES_DIR, filename);

  await mkdir(SOURCES_DIR, { recursive: true });
  await writeFile(destPath, document, "utf-8");

  return destPath;
}

/**
 * Programmatic ingest entry point. Identical fetch + write logic to the CLI
 * command but returns a structured IngestResult instead of writing to stdout.
 * Used by the MCP server's ingest_source tool.
 *
 * @param source - A URL (http/https), YouTube URL, local file, PDF, or image path.
 * @returns Saved filename, character count, truncation flag, source URI, and detected source type.
 */
export async function ingestSource(source: string): Promise<IngestResult> {
  const sourceType = await detectSourceType(source);
  output.status("*", output.info(`Ingesting [${sourceType}]: ${source}`));

  const { title, content } = await fetchContent(source, sourceType);

  const result = enforceCharLimit(content);
  enforceMinContent(result.content);
  const document = buildDocument(title, source, result, sourceType);
  const savedPath = await saveSource(title, document);

  return {
    filename: path.basename(savedPath),
    charCount: result.content.length,
    truncated: result.truncated,
    source,
    sourceType,
  };
}

/**
 * Ingest a source and save it to the sources/ directory.
 * @param source - A URL (http/https), YouTube URL, local file, PDF, or image path.
 */
export default async function ingest(source: string): Promise<void> {
  const result = await ingestSource(source);
  const savedPath = path.join(SOURCES_DIR, result.filename);

  output.status(
    "+",
    output.success(`Saved ${output.bold(result.filename)} → ${output.source(savedPath)}`)
  );
  output.status("→", output.dim("Next: llmwiki compile"));
}
