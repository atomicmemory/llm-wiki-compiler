/**
 * Markdown parsing and manipulation helpers.
 * Handles YAML frontmatter extraction, slugification, and atomic file writes
 * for wiki pages.
 */

import { writeFile, rename, readFile, mkdir } from "fs/promises";
import path from "path";
import yaml from "js-yaml";
import type { ClaimCitation, SourceSpan } from "./types.js";

/** Regex matching `^[...]` citation markers (paragraph or claim-level). */
const CITATION_MARKER_PATTERN = /\^\[([^\]]+)\]/g;

/** Regex matching the optional `:start-end` or `#Lstart-Lend` span suffix on a citation entry. */
const SPAN_SUFFIX_PATTERN = /^(?<file>[^:#]+)(?:(?::(?<colonStart>\d+)(?:-(?<colonEnd>\d+))?)|(?:#L(?<hashStart>\d+)(?:-L(?<hashEnd>\d+))?))?$/;

/** Convert a human-readable concept title to a filename slug. */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Build YAML frontmatter string from key-value pairs. */
export function buildFrontmatter(fields: Record<string, unknown>): string {
  const dumped = yaml.dump(fields, { lineWidth: -1, quotingType: '"' }).trimEnd();
  return `---\n${dumped}\n---`;
}

/** Parse YAML frontmatter from a markdown string. Returns { meta, body }. */
export function parseFrontmatter(content: string): {
  meta: Record<string, unknown>;
  body: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { meta: {}, body: content };
  }

  let meta: Record<string, unknown> = {};
  try {
    const parsed = yaml.load(match[1]);
    if (parsed && typeof parsed === "object") {
      meta = parsed as Record<string, unknown>;
    }
  } catch {
    // Malformed YAML — return empty meta so callers degrade gracefully.
  }
  return { meta, body: match[2] };
}

/** Atomically write a file (write to .tmp, then rename). */
export async function atomicWrite(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = filePath + ".tmp";
  await writeFile(tmpPath, content, "utf-8");
  await rename(tmpPath, filePath);
}

/**
 * Extract all source filenames from ^[filename.md] citation markers in a page body.
 * Handles paragraph form (`^[source.md]`), multi-source (`^[a.md, b.md]`), and the
 * claim-level extension that pins a line range (`^[source.md:42-58]` or
 * `^[source.md#L42-L58]`). Only the filename component is returned — span data is
 * discarded so existing callers continue to receive a flat filename list.
 * @param body - The markdown body text to parse.
 * @returns Array of unique source filenames.
 */
export function extractCitations(body: string): string[] {
  const filenames = new Set<string>();
  for (const citation of extractClaimCitations(body)) {
    for (const span of citation.spans) {
      if (span.file.length > 0) filenames.add(span.file);
    }
  }
  return [...filenames];
}

/**
 * Extract claim-level citations from a markdown body. Each `^[...]` marker
 * becomes one `ClaimCitation`; comma-separated entries inside a single marker
 * become multiple spans on that citation. Entries that fail to parse against
 * the span grammar are returned as bare-file spans so callers can still tell
 * the marker was present (the linter inspects `raw` to flag malformed forms).
 * @param body - The markdown body text to parse.
 * @returns Array of ClaimCitation objects in document order.
 */
export function extractClaimCitations(body: string): ClaimCitation[] {
  const citations: ClaimCitation[] = [];
  let match: RegExpExecArray | null;
  CITATION_MARKER_PATTERN.lastIndex = 0;
  while ((match = CITATION_MARKER_PATTERN.exec(body)) !== null) {
    const raw = match[1];
    const spans = parseCitationEntries(raw);
    if (spans.length > 0) citations.push({ raw, spans });
  }
  return citations;
}

/** Parse the inside of `^[...]` into one or more SourceSpan entries. */
function parseCitationEntries(inner: string): SourceSpan[] {
  const spans: SourceSpan[] = [];
  for (const part of inner.split(",")) {
    const trimmed = part.trim();
    if (trimmed.length === 0) continue;
    spans.push(parseSpanEntry(trimmed));
  }
  return spans;
}

/** Parse a single citation entry (`file.md` / `file.md:1-3` / `file.md#L1-L3`). */
function parseSpanEntry(entry: string): SourceSpan {
  const match = SPAN_SUFFIX_PATTERN.exec(entry);
  if (!match || !match.groups) {
    return { file: entry };
  }
  const { file, colonStart, colonEnd, hashStart, hashEnd } = match.groups;
  const start = colonStart ?? hashStart;
  const end = colonEnd ?? hashEnd;
  if (start === undefined) return { file };
  const startLine = Number(start);
  const endLine = end === undefined ? startLine : Number(end);
  return { file, lines: { start: startLine, end: endLine } };
}

/**
 * Detect whether a citation entry is malformed: bracket text that contains
 * `:` or `#` characters but does not match the documented span grammar.
 * Used by the linter to flag broken claim-level provenance markers.
 */
export function isMalformedCitationEntry(entry: string): boolean {
  const trimmed = entry.trim();
  if (trimmed.length === 0) return true;
  if (!trimmed.includes(":") && !trimmed.includes("#")) return false;
  const match = SPAN_SUFFIX_PATTERN.exec(trimmed);
  return !match;
}

/**
 * Inspect provenance for a page body, grouping every parsed span by source file.
 * Useful for tooling that wants to render a "this page draws from" panel without
 * worrying about how the markers were formatted in source. Each filename maps to
 * a deduplicated list of `{start, end}` line ranges (paragraph-only citations
 * appear as the empty array, signalling "no specific span").
 */
export function inspectProvenance(body: string): Map<string, Array<{ start: number; end: number }>> {
  const grouped = new Map<string, Array<{ start: number; end: number }>>();
  for (const citation of extractClaimCitations(body)) {
    for (const span of citation.spans) {
      const ranges = grouped.get(span.file) ?? [];
      if (span.lines && !rangeAlreadyTracked(ranges, span.lines)) {
        ranges.push(span.lines);
      }
      grouped.set(span.file, ranges);
    }
  }
  return grouped;
}

/** Has this start/end pair already been recorded for a file? */
function rangeAlreadyTracked(
  ranges: Array<{ start: number; end: number }>,
  candidate: { start: number; end: number },
): boolean {
  return ranges.some((r) => r.start === candidate.start && r.end === candidate.end);
}

/** Read a file, returning empty string if it doesn't exist. */
export async function safeReadFile(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

/**
 * Validate that a wiki page has non-empty content and valid frontmatter.
 * Returns true if the page is valid.
 */
export function validateWikiPage(content: string): boolean {
  if (!content || content.trim().length === 0) return false;

  const { meta, body } = parseFrontmatter(content);
  if (!meta.title) return false;
  if (body.trim().length === 0) return false;

  return true;
}
