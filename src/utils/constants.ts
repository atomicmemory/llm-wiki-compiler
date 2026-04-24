/**
 * Shared constants for the llmwiki knowledge compiler.
 * Centralized config values to avoid magic numbers scattered across the codebase.
 */

/** Maximum source file size in characters before truncation. */
export const MAX_SOURCE_CHARS = 100_000;

/** Minimum source content length to ingest without a warning. */
export const MIN_SOURCE_CHARS = 50;

/** Number of most relevant wiki pages to load for query context. */
export const QUERY_PAGE_LIMIT = 5;

/** Maximum concurrent API calls during page generation. */
export const COMPILE_CONCURRENCY = 5;

/** API retry configuration. */
export const RETRY_COUNT = 3;
export const RETRY_BASE_MS = 1000;
export const RETRY_MULTIPLIER = 4;

/** Default provider when LLMWIKI_PROVIDER is not set. */
export const DEFAULT_PROVIDER = "anthropic";

/** Default model per provider. */
export const PROVIDER_MODELS: Record<string, string> = {
  anthropic: "claude-sonnet-4-20250514",
  openai: "gpt-4o",
  ollama: "llama3.1",
  minimax: "MiniMax-M2.7",
};

/** Default Ollama API base URL. */
export const OLLAMA_DEFAULT_HOST = "http://localhost:11434/v1";

/** Directory names relative to the project root. */
export const SOURCES_DIR = "sources";
export const CONCEPTS_DIR = "wiki/concepts";
export const QUERIES_DIR = "wiki/queries";
export const LLMWIKI_DIR = ".llmwiki";
export const STATE_FILE = ".llmwiki/state.json";
export const LOCK_FILE = ".llmwiki/lock";
export const INDEX_FILE = "wiki/index.md";
export const MOC_FILE = "wiki/MOC.md";
export const EMBEDDINGS_FILE = ".llmwiki/embeddings.json";

/** Pending review candidates awaiting approval/rejection. */
export const CANDIDATES_DIR = ".llmwiki/candidates";

/** Rejected review candidates archived for audit (not deleted). */
export const CANDIDATES_ARCHIVE_DIR = ".llmwiki/candidates/archive";

/** Number of most similar pages to return from embedding-based pre-filter. */
export const EMBEDDING_TOP_K = 15;

/** Number of chunk candidates to retain after the semantic-similarity step. */
export const CHUNK_TOP_K = 30;

/** Number of chunk candidates to keep after reranking. */
export const CHUNK_RERANK_KEEP = 12;

/** Target chunk size in characters; chunks try to land near this length. */
export const CHUNK_TARGET_CHARS = 800;

/** Hard upper bound on a single chunk's character length. */
export const CHUNK_MAX_CHARS = 1_400;

/** Minimum standalone chunk size; smaller trailing fragments are merged back. */
export const CHUNK_MIN_CHARS = 200;

/** Provenance metadata thresholds used by lint rules. */
export const LOW_CONFIDENCE_THRESHOLD = 0.5;
export const MAX_INFERRED_PARAGRAPHS_WITHOUT_CITATIONS = 2;

/** Embedding model to use per provider. */
export const EMBEDDING_MODELS: Record<string, string> = {
  anthropic: "voyage-3-lite",
  openai: "text-embedding-3-small",
  ollama: "nomic-embed-text",
};
