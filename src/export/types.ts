/**
 * Shared types for the llmwiki export subsystem.
 *
 * ExportPage is the normalised in-memory representation of a wiki page used
 * by every export format. It is derived from the page's YAML frontmatter plus
 * the wikilink graph extracted from the body.
 */

/** A fully-resolved wiki page ready for export serialisation. */
export interface ExportPage {
  /** Human-readable page title (from frontmatter). */
  title: string;
  /** Filesystem slug (filename without .md). */
  slug: string;
  /** One-line page summary (from frontmatter). */
  summary: string;
  /** Source filenames cited in the page body. */
  sources: string[];
  /** Taxonomy tags (from frontmatter). */
  tags: string[];
  /** ISO-8601 creation timestamp. */
  createdAt: string;
  /** ISO-8601 last-updated timestamp. */
  updatedAt: string;
  /** Slugs of other pages this page links to via [[wikilinks]]. */
  links: string[];
  /** Full markdown body (without frontmatter). */
  body: string;
}

/** Supported export target identifiers. */
export type ExportTarget =
  | "llms-txt"
  | "llms-full-txt"
  | "json"
  | "json-ld"
  | "graphml"
  | "marp";

/** All recognised export target names — used for validation. */
export const EXPORT_TARGETS: readonly ExportTarget[] = [
  "llms-txt",
  "llms-full-txt",
  "json",
  "json-ld",
  "graphml",
  "marp",
];
