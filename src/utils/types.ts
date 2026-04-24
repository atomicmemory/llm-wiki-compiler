/**
 * Core type definitions for the llmwiki knowledge compiler.
 * All shared interfaces live here to keep the module boundary clean.
 */

/**
 * Lifecycle state of a concept or page's provenance.
 * - `extracted`: drawn directly from a source document.
 * - `merged`: synthesised from multiple sources during compilation.
 * - `inferred`: produced by the model from context, not directly cited.
 * - `ambiguous`: sources disagree or evidence is conflicting.
 */
export type ProvenanceState = "extracted" | "merged" | "inferred" | "ambiguous";

/**
 * Reference to another concept that contradicts the current one.
 * The slug points to the contradicting wiki page.
 */
export interface ContradictionRef {
  slug: string;
  reason?: string;
}

/** A single concept extracted from a source by the LLM. */
export interface ExtractedConcept {
  concept: string;
  summary: string;
  is_new: boolean;
  tags?: string[];
  /** Numeric confidence in 0..1 — how certain the model is in this concept. */
  confidence?: number;
  /** Lifecycle state describing how this concept was produced. */
  provenanceState?: ProvenanceState;
  /** Slugs of concepts whose evidence contradicts this one. */
  contradictedBy?: ContradictionRef[];
  /**
   * Number of paragraphs the model considers inferred (not directly extracted).
   * Used by the inferred-without-citations lint rule.
   */
  inferredParagraphs?: number;
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
export interface WikiFrontmatter {
  title: string;
  sources: string[];
  summary: string;
  orphaned?: boolean;
  tags?: string[];
  aliases?: string[];
  createdAt: string;
  updatedAt: string;
  /**
   * Optional typed page kind. Defaults to "concept" when absent so existing
   * pages compiled before the schema layer existed continue to work.
   */
  kind?: "concept" | "entity" | "comparison" | "overview";
  /** Numeric confidence in 0..1 — overall confidence in the page's claims. */
  confidence?: number;
  /** Lifecycle state describing how the page's content was produced. */
  provenanceState?: ProvenanceState;
  /** Slugs of pages whose evidence contradicts this one. */
  contradictedBy?: ContradictionRef[];
  /** Number of inferred paragraphs in the page body without direct citations. */
  inferredParagraphs?: number;
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
  /** Candidate IDs created when the pipeline runs in --review mode. */
  candidates?: string[];
}

/** Optional behaviour controls for the compile pipeline. */
export interface CompileOptions {
  /**
   * Write generated pages as candidates under .llmwiki/candidates/ instead
   * of mutating wiki/. Reviewers approve/reject via `llmwiki review`.
   */
  review?: boolean;
}

/**
 * A pending wiki page change awaiting human review. Persisted as JSON under
 * .llmwiki/candidates/<id>.json when compile is run with --review.
 */
export interface ReviewCandidate {
  /** Stable identifier used by the review CLI commands. */
  id: string;
  /** Human-readable concept title. */
  title: string;
  /** Filename slug that the page would be written to. */
  slug: string;
  /** Short summary copied from the LLM extraction. */
  summary: string;
  /** Source filenames that contributed to this candidate. */
  sources: string[];
  /** Full page content (frontmatter + body) ready to be written verbatim. */
  body: string;
  /** ISO timestamp recorded when the candidate was generated. */
  generatedAt: string;
  /**
   * Per-source incremental-state snapshots captured at compile time.
   *
   * Approving the candidate persists these into `.llmwiki/state.json` so the
   * source files are marked compiled and won't be reprocessed on the next
   * `compile` run. Without this, approved candidates would silently
   * regenerate on every subsequent compile.
   */
  sourceStates?: Record<string, SourceState>;
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
