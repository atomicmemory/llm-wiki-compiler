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

/** A single chunk citation surfaced as part of a query result. */
export interface ChunkCitation {
  slug: string;
  title: string;
  chunkIndex: number;
  score: number;
  text: string;
}

/** Diagnostic snapshot of how the retrieval pipeline picked context. */
export interface RetrievalDebug {
  /** Pages selected after collapsing chunks to their parent slugs. */
  pages: Array<{ slug: string; score: number }>;
  /** Top-ranked chunks before the page-collapse step. */
  chunks: ChunkCitation[];
  /** True when chunk-level entries drove the selection (vs. page-level fallback). */
  usedChunks: boolean;
  /** True when reranking reordered the initial semantic ranking. */
  reranked: boolean;
}

/** Structured result returned by the query pipeline. */
export interface QueryResult {
  answer: string;
  selectedPages: string[];
  reasoning: string;
  saved?: string;
  /** Populated when the query was run in debug mode. */
  debug?: RetrievalDebug;
}

/** Structured result returned by the ingest pipeline. */
export interface IngestResult {
  filename: string;
  charCount: number;
  truncated: boolean;
  source: string;
}
