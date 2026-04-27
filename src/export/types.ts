/**
 * Shared types for the llmwiki export subsystem.
 *
 * ExportPage is the normalised in-memory representation of a wiki page used
 * by every export format. It is derived from the page's YAML frontmatter plus
 * the wikilink graph extracted from the body.
 */

/** The wiki directory kind a page originates from. */
export type PageKind = "concepts" | "queries";

/** A fully-resolved wiki page ready for export serialisation. */
export interface ExportPage {
  /** Human-readable page title (from frontmatter). */
  title: string;
  /** Filesystem slug (filename without .md). */
  slug: string;
  /** Whether this page came from wiki/concepts or wiki/queries. */
  kind: PageKind;
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

/**
 * Source filter for marp export: which page kinds to include.
 * "all" includes both concepts and queries (the default).
 */
export type MarpSource = "concepts" | "queries" | "all";

/** All recognised marp source values — used for validation. */
export const MARP_SOURCES: readonly MarpSource[] = ["concepts", "queries", "all"];

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
