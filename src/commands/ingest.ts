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
import { createHash } from "crypto";
import { slugify, buildFrontmatter, parseFrontmatter } from "../utils/markdown.js";
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
 * Regex for a speaker-tag line: captures the speaker name before the colon.
 * Allows names up to ~40 chars with letters, spaces, dots, apostrophes, hyphens.
 * The `gm` flags let us find ALL occurrences in the sample.
 */
const SPEAKER_TAG_PATTERN = /^([A-Z][a-zA-Z .'-]{0,40}):\s/gm;

/**
 * Regex for a bare timestamp at the start of a line (allowing leading
 * whitespace): "H:MM", "HH:MM", or "HH:MM:SS". Anchored to line starts so
 * incidental times in prose (e.g. "the meeting at 3:00 was productive")
 * don't trip the transcript heuristic.
 */
const TIMESTAMP_PATTERN = /^\s*\d{1,2}:\d{2}(:\d{2})?/;

/** Minimum number of timestamp-like matches to treat a file as a transcript. */
const MIN_TIMESTAMP_MATCHES = 3;

/**
 * Minimum number of times a single speaker name must appear to signal dialogue
 * (rules out one-off section headers like "Summary:" that appear only once).
 */
const MIN_SPEAKER_REPEAT_COUNT = 2;

/**
 * Minimum number of distinct speaker names required alongside the repeat
 * condition (rules out single-speaker monologues).
 */
const MIN_DISTINCT_SPEAKERS = 2;

/**
 * Count how many times each speaker name appears in the collected tag matches.
 * Returns a Map from name → occurrence count.
 */
function countSpeakerOccurrences(sample: string): Map<string, number> {
  const counts = new Map<string, number>();
  // Reset lastIndex since SPEAKER_TAG_PATTERN has the `g` flag.
  SPEAKER_TAG_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SPEAKER_TAG_PATTERN.exec(sample)) !== null) {
    const name = match[1].trim();
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}

/**
 * Decide whether speaker-tag occurrences in a sample look like dialogue.
 *
 * A file passes when both of the following are true:
 *  - At least {@link MIN_DISTINCT_SPEAKERS} distinct speaker names appear.
 *  - At least one name appears {@link MIN_SPEAKER_REPEAT_COUNT}+ times,
 *    indicating back-and-forth turns rather than a list of section headers
 *    (e.g. "Summary: …", "Details: …") where every label is unique.
 */
function hasSpeakerDialoguePattern(sample: string): boolean {
  const counts = countSpeakerOccurrences(sample);

  const distinctSpeakers = counts.size;
  const hasEnoughSpeakers = distinctSpeakers >= MIN_DISTINCT_SPEAKERS;

  const hasRepeatedSpeaker = [...counts.values()].some(
    (n) => n >= MIN_SPEAKER_REPEAT_COUNT,
  );

  return hasEnoughSpeakers && hasRepeatedSpeaker;
}

/**
 * Peek at the first {@link TXT_SNIFF_BYTES} of a plain-text file and decide
 * whether it looks like a conversation transcript.
 *
 * Heuristic: at least one of the following must be true in the sampled content:
 *
 *  1. **Speaker-tag dialogue pattern** — lines of the form "Name: …" where:
 *     - At least {@link MIN_DISTINCT_SPEAKERS} distinct names appear, AND
 *     - At least one name appears {@link MIN_SPEAKER_REPEAT_COUNT}+ times.
 *     This rejects lone section headers ("Summary: …") and lists of unique
 *     labels ("Summary:", "Details:", "Notes:") that have no repetition, while
 *     accepting real back-and-forth dialogue ("Alice: …\nBob: …\nAlice: …").
 *
 *  2. **Timestamp density** — three or more bare timestamp patterns (e.g.
 *     "01:23" / "1:23:45"), the signature of time-coded scripts or subtitles.
 *
 * When neither signal fires the caller routes the file as a generic text file.
 *
 * @param filePath - Absolute or relative path to the .txt file.
 * @returns `true` when transcript signals are detected, `false` otherwise.
 */
async function looksLikeTxtTranscript(filePath: string): Promise<boolean> {
  const raw = await readFile(filePath, "utf-8");
  const sample = raw.slice(0, TXT_SNIFF_BYTES);

  if (hasSpeakerDialoguePattern(sample)) return true;

  const timestampMatches = sample.match(new RegExp(TIMESTAMP_PATTERN.source, "gm"));
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

/** Length of the hex hash suffix appended to disambiguate basename collisions. */
const COLLISION_HASH_LEN = 8;

/**
 * Compute a short, stable hex hash of a source identifier. Used to
 * disambiguate filenames when two distinct sources slugify to the same
 * basename (issue #36). Stability matters: re-ingesting the same source
 * must always produce the same hash so we overwrite cleanly instead of
 * accumulating duplicates.
 */
function shortHashOfSource(source: string): string {
  return createHash("sha256").update(source).digest("hex").slice(0, COLLISION_HASH_LEN);
}

/**
 * Resolve a final filename for the given slug and source identity.
 *
 * - When `${slug}.md` does not exist, return `${slug}.md`.
 * - When `${slug}.md` exists and its frontmatter `source` matches the
 *   incoming source, return `${slug}.md` so re-ingest stays idempotent.
 * - Otherwise return `${slug}-<hash>.md` so two distinct sources that
 *   share a basename coexist instead of one silently overwriting the
 *   other (issue #36).
 */
async function resolveCollisionFreeFilename(slug: string, source: string): Promise<string> {
  const candidate = `${slug}.md`;
  const candidatePath = path.join(SOURCES_DIR, candidate);
  let existing: string;
  try {
    existing = await readFile(candidatePath, "utf-8");
  } catch (err) {
    const e = err as { code?: string };
    if (e.code === "ENOENT") return candidate;
    throw err;
  }
  const { meta } = parseFrontmatter(existing);
  if (typeof meta.source === "string" && meta.source === source) {
    return candidate;
  }
  return `${slug}-${shortHashOfSource(source)}.md`;
}

/** Write the ingested document to the sources/ directory. */
async function saveSource(title: string, document: string, source: string): Promise<string> {
  const slug = slugify(title);
  // Defense in depth — even with the Unicode-aware slugifier (#35), a title
  // made entirely of punctuation/emoji/symbols still slugifies to "". Without
  // this guard the file would be written to sources/.md (a dotfile that's
  // easy to miss and that subsequent empty-slug ingests would overwrite).
  if (!slug) {
    throw new Error(
      `Could not derive a filename from title "${title}". ` +
        `The title contains no letter or number characters. ` +
        `Rename the source file to one with at least one letter or digit.`,
    );
  }
  await mkdir(SOURCES_DIR, { recursive: true });
  const filename = await resolveCollisionFreeFilename(slug, source);
  const destPath = path.join(SOURCES_DIR, filename);
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
  const savedPath = await saveSource(title, document, source);

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
