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

/** Supported image file extensions for vision-based ingest. */
export const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);

/** Supported transcript file extensions. */
export const TRANSCRIPT_EXTENSIONS = new Set([".vtt", ".srt", ".txt"]);

/** Max tokens for image-description completions. */
export const IMAGE_DESCRIBE_MAX_TOKENS = 2048;

/** Number of most similar pages to return from embedding-based pre-filter. */
export const EMBEDDING_TOP_K = 15;

/** Embedding model to use per provider. */
export const EMBEDDING_MODELS: Record<string, string> = {
  anthropic: "voyage-3-lite",
  openai: "text-embedding-3-small",
  ollama: "nomic-embed-text",
};
