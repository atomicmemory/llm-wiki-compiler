/**
 * Core type definitions for the llmwiki knowledge compiler.
 * All shared interfaces live here to keep the module boundary clean.
 */

/** A single concept extracted from a source by the LLM. */
export interface ExtractedConcept {
  concept: string;
  summary: string;
  is_new: boolean;
  tags?: string[];
}

/** Per-source entry in .llmwiki/state.json. */
export interface SourceState {
  hash: string;
  concepts: string[];
  compiledAt: string;
}

/** Root shape of .llmwiki/state.json. */
export interface WikiState {
  version: 1;
  indexHash: string;
  sources: Record<string, SourceState>;
  /** Concept slugs frozen across batches to preserve content from deleted sources. */
  frozenSlugs?: string[];
}

/** Change detection result for a single source file. */
export interface SourceChange {
  file: string;
  status: "new" | "changed" | "unchanged" | "deleted";
}

/** Wiki page frontmatter parsed from YAML. */
interface WikiFrontmatter {
  title: string;
  sources: string[];
  summary: string;
  orphaned?: boolean;
  tags?: string[];
  aliases?: string[];
  createdAt: string;
  updatedAt: string;
}

/** Summary entry used in index.md generation. */
export interface PageSummary {
  title: string;
  slug: string;
  summary: string;
}

/** Structured result returned by the compile pipeline. */
export interface CompileResult {
  compiled: number;
  skipped: number;
  deleted: number;
  concepts: string[];
  pages: string[];
  errors: string[];
}

/** Structured result returned by the query pipeline. */
export interface QueryResult {
  answer: string;
  selectedPages: string[];
  reasoning: string;
  saved?: string;
}

/** Structured result returned by the ingest pipeline. */
export interface IngestResult {
  filename: string;
  charCount: number;
  truncated: boolean;
  source: string;
}

/**
 * A single source span pointing back into ingested source text.
 * Spans are inclusive on both ends and 1-indexed when referring to lines,
 * mirroring the way humans cite editor line numbers.
 */
export interface SourceSpan {
  /** Source filename (e.g. `paper.md`) — always relative to `sources/`. */
  file: string;
  /** Optional inclusive line range; `start` and `end` may be equal. */
  lines?: { start: number; end: number };
}

/**
 * A claim-level citation parsed from a `^[file.md:42-58]` or
 * `^[file.md#L42-L58]` marker. The plain `^[file.md]` form parses with
 * `spans[i].lines` undefined, preserving paragraph-level provenance.
 */
export interface ClaimCitation {
  /** Raw text inside the brackets, useful for diagnostics. */
  raw: string;
  /** One or more source spans contributed by this marker. */
  spans: SourceSpan[];
}
