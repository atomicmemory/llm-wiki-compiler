/**
 * Markdown parsing and manipulation helpers.
 * Handles YAML frontmatter extraction, slugification, and atomic file writes
 * for wiki pages.
 */

import { writeFile, rename, readFile, mkdir } from "fs/promises";
import path from "path";
import yaml from "js-yaml";
import type { ContradictionRef, ProvenanceState } from "./types.js";

/** The set of valid provenance state strings, used to reject unknown values. */
const VALID_PROVENANCE_STATES: ReadonlySet<ProvenanceState> = new Set([
  "extracted",
  "merged",
  "inferred",
  "ambiguous",
]);

/** Provenance metadata parsed from a page's frontmatter. */
interface ProvenanceMetadata {
  confidence?: number;
  provenanceState?: ProvenanceState;
  contradictedBy?: ContradictionRef[];
  inferredParagraphs?: number;
}

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
 * Handles single citations (^[source.md]) and multi-source (^[a.md, b.md]).
 * @param body - The markdown body text to parse.
 * @returns Array of unique source filenames.
 */
export function extractCitations(body: string): string[] {
  const citationPattern = /\^\[([^\]]+)\]/g;
  const filenames = new Set<string>();

  let match;
  while ((match = citationPattern.exec(body)) !== null) {
    const inner = match[1];
    for (const part of inner.split(",")) {
      const trimmed = part.trim();
      if (trimmed.length > 0) {
        filenames.add(trimmed);
      }
    }
  }

  return [...filenames];
}

/** Read a file, returning empty string if it doesn't exist. */
export async function safeReadFile(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

/** Parse a numeric confidence value, clamping to 0..1 and rejecting non-numbers. */
function parseConfidence(raw: unknown): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  if (raw < 0) return 0;
  if (raw > 1) return 1;
  return raw;
}

/** Parse a provenance state string, returning undefined for unknown values. */
function parseProvenanceState(raw: unknown): ProvenanceState | undefined {
  if (typeof raw !== "string") return undefined;
  return VALID_PROVENANCE_STATES.has(raw as ProvenanceState)
    ? (raw as ProvenanceState)
    : undefined;
}

/** Coerce a single contradiction entry to a ContradictionRef, or null if invalid. */
function coerceContradictionEntry(entry: unknown): ContradictionRef | null {
  if (typeof entry === "string" && entry.trim().length > 0) {
    return { slug: entry.trim() };
  }
  if (entry && typeof entry === "object" && "slug" in entry) {
    const obj = entry as { slug: unknown; reason?: unknown };
    if (typeof obj.slug !== "string" || obj.slug.trim().length === 0) return null;
    const ref: ContradictionRef = { slug: obj.slug.trim() };
    if (typeof obj.reason === "string") ref.reason = obj.reason;
    return ref;
  }
  return null;
}

/** Parse a contradictedBy array, accepting strings or objects with slug. */
function parseContradictedBy(raw: unknown): ContradictionRef[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const refs = raw
    .map(coerceContradictionEntry)
    .filter((ref): ref is ContradictionRef => ref !== null);
  return refs.length > 0 ? refs : undefined;
}

/** Parse the inferred paragraph count, requiring a non-negative integer. */
function parseInferredParagraphs(raw: unknown): number | undefined {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) return undefined;
  return raw;
}

/**
 * Extract provenance metadata fields from a parsed frontmatter record.
 * Defensively handles missing or malformed values so existing pages without
 * the new fields continue to parse correctly.
 * @param meta - Raw frontmatter object as returned by parseFrontmatter.
 * @returns Typed provenance metadata with only the fields that were present.
 */
export function parseProvenanceMetadata(
  meta: Record<string, unknown>,
): ProvenanceMetadata {
  return {
    confidence: parseConfidence(meta.confidence),
    provenanceState: parseProvenanceState(meta.provenanceState),
    contradictedBy: parseContradictedBy(meta.contradictedBy),
    inferredParagraphs: parseInferredParagraphs(meta.inferredParagraphs),
  };
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
