/**
 * Embedding-based semantic search utilities.
 *
 * Maintains a persistent store of page embeddings in .llmwiki/embeddings.json
 * and provides cosine-similarity retrieval so the query command can narrow
 * hundreds of pages down to a small top-K before calling the selection LLM.
 *
 * The store is additive: successful embedding calls update entries; failures
 * degrade gracefully (caller falls back to full-index selection).
 */

import { readFile, readdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { getProvider, getActiveProviderName } from "./provider.js";
import { atomicWrite, safeReadFile, parseFrontmatter } from "./markdown.js";
import {
  CONCEPTS_DIR,
  QUERIES_DIR,
  EMBEDDINGS_FILE,
  EMBEDDING_TOP_K,
  EMBEDDING_MODELS,
} from "./constants.js";
import * as output from "./output.js";

/** A single embedded page record. */
export interface EmbeddingEntry {
  slug: string;
  title: string;
  summary: string;
  vector: number[];
  updatedAt: string;
}

/** Root shape of .llmwiki/embeddings.json. */
export interface EmbeddingStore {
  version: 1;
  model: string;
  dimensions: number;
  entries: EmbeddingEntry[];
}

/** A retrievable page record on disk (concepts/ or queries/). */
interface PageRecord {
  slug: string;
  title: string;
  summary: string;
}

/**
 * Cosine similarity between two equal-length vectors.
 * Returns 0 when either vector has zero magnitude (safer than NaN for ranking).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/** Return the top-K entries most similar to the query vector, sorted descending. */
export function findTopK(
  queryVec: number[],
  store: EmbeddingStore,
  k: number,
): EmbeddingEntry[] {
  const scored = store.entries.map((entry) => ({
    entry,
    score: cosineSimilarity(queryVec, entry.vector),
  }));
  scored.sort((left, right) => right.score - left.score);
  return scored.slice(0, k).map((item) => item.entry);
}

/** Read .llmwiki/embeddings.json, returning null if it does not exist. */
export async function readEmbeddingStore(root: string): Promise<EmbeddingStore | null> {
  const filePath = path.join(root, EMBEDDINGS_FILE);
  if (!existsSync(filePath)) return null;
  const raw = await readFile(filePath, "utf-8");
  return JSON.parse(raw) as EmbeddingStore;
}

/** Atomically persist the embedding store. */
export async function writeEmbeddingStore(root: string, store: EmbeddingStore): Promise<void> {
  const filePath = path.join(root, EMBEDDINGS_FILE);
  await atomicWrite(filePath, JSON.stringify(store, null, 2));
}

/**
 * Embed the question, look up top-K matches, and return lightweight page records.
 * Returns [] when no store exists so callers can transparently fall back.
 */
export async function findRelevantPages(
  root: string,
  question: string,
): Promise<Array<{ slug: string; title: string; summary: string }>> {
  const store = await readEmbeddingStore(root);
  if (!store || store.entries.length === 0) return [];
  const activeModel = resolveEmbeddingModel();
  if (store.model !== activeModel) {
    warnStaleEmbeddingStore(store.model, activeModel);
    return [];
  }

  const queryVec = await getProvider().embed(question);
  return findTopK(queryVec, store, EMBEDDING_TOP_K).map((entry) => ({
    slug: entry.slug,
    title: entry.title,
    summary: entry.summary,
  }));
}

/** Scan concepts/ and queries/ directories, returning retrievable pages. */
async function collectPageRecords(root: string): Promise<PageRecord[]> {
  const records: PageRecord[] = [];
  for (const dir of [CONCEPTS_DIR, QUERIES_DIR]) {
    const absDir = path.join(root, dir);
    let files: string[];
    try {
      files = await readdir(absDir);
    } catch {
      continue;
    }
    for (const file of files.filter((f) => f.endsWith(".md"))) {
      const content = await safeReadFile(path.join(absDir, file));
      const { meta } = parseFrontmatter(content);
      if (meta.orphaned || typeof meta.title !== "string") continue;
      records.push({
        slug: file.replace(/\.md$/, ""),
        title: meta.title,
        summary: typeof meta.summary === "string" ? meta.summary : "",
      });
    }
  }
  return records;
}

/** Build the text that represents a page in the embedding space. */
function buildEmbeddingText(record: PageRecord): string {
  return record.summary
    ? `${record.title}\n\n${record.summary}`
    : record.title;
}

/**
 * Embed every page in `records` whose slug appears in `slugsToEmbed`,
 * returning the new entries. Failures bubble up to the caller.
 */
async function embedPages(
  records: PageRecord[],
  slugsToEmbed: Set<string>,
): Promise<EmbeddingEntry[]> {
  const provider = getProvider();
  const now = new Date().toISOString();
  const fresh: EmbeddingEntry[] = [];

  for (const record of records) {
    if (!slugsToEmbed.has(record.slug)) continue;
    const vector = await provider.embed(buildEmbeddingText(record));
    fresh.push({
      slug: record.slug,
      title: record.title,
      summary: record.summary,
      vector,
      updatedAt: now,
    });
  }
  return fresh;
}

/** Tracks which (stored, active) model pairs have already been warned about. */
const warnedStaleModels = new Set<string>();

/** Warn once per (stored, active) model pair so queries stay quiet on repeat runs. */
function warnStaleEmbeddingStore(storedModel: string, activeModel: string): void {
  const key = `${storedModel}→${activeModel}`;
  if (warnedStaleModels.has(key)) return;
  warnedStaleModels.add(key);
  output.status(
    "!",
    output.warn(
      `Embedding store was built with "${storedModel}" but active embedding model is "${activeModel}". ` +
      `Falling back to full-index selection. Run 'llmwiki compile' to rebuild embeddings.`,
    ),
  );
}

/** Test-only hook: clear the warned-pair cache so each test sees a fresh warning. */
export function resetStaleEmbeddingWarnings(): void {
  warnedStaleModels.clear();
}

/** Choose the active embedding model name, defaulting to anthropic's voyage model. */
export function resolveEmbeddingModel(): string {
  const providerName = getActiveProviderName();
  const configuredModel = process.env.LLMWIKI_EMBEDDING_MODEL?.trim();
  if (configuredModel && (providerName === "openai" || providerName === "ollama")) {
    return configuredModel;
  }
  return EMBEDDING_MODELS[providerName] ?? EMBEDDING_MODELS.anthropic;
}

/** Merge fresh embeddings into an existing store, dropping slugs not in liveSlugs. */
function mergeEntries(
  existing: EmbeddingEntry[],
  fresh: EmbeddingEntry[],
  liveSlugs: Set<string>,
): EmbeddingEntry[] {
  const bySlug = new Map<string, EmbeddingEntry>();
  for (const entry of existing) {
    if (liveSlugs.has(entry.slug)) bySlug.set(entry.slug, entry);
  }
  for (const entry of fresh) {
    bySlug.set(entry.slug, entry);
  }
  return Array.from(bySlug.values());
}

/**
 * Re-embed the given changed slugs and prune any entries whose pages no longer
 * exist on disk. Changed slugs not present as live pages are silently skipped.
 */
export async function updateEmbeddings(root: string, changedSlugs: string[]): Promise<void> {
  const records = await collectPageRecords(root);
  const liveSlugs = new Set(records.map((r) => r.slug));
  const embeddingModel = resolveEmbeddingModel();
  const existingStore = await readEmbeddingStore(root);
  const modelChanged = Boolean(existingStore && existingStore.model !== embeddingModel);
  const toEmbed = new Set(changedSlugs.filter((slug) => liveSlugs.has(slug)));
  const previousEntries = modelChanged ? [] : existingStore?.entries ?? [];

  // Cold start: embed every page so the store is immediately useful.
  if (!existingStore || modelChanged) {
    for (const record of records) toEmbed.add(record.slug);
  }

  if (!modelChanged && toEmbed.size === 0 && previousEntries.every((e) => liveSlugs.has(e.slug))) {
    return;
  }

  const freshEntries = await embedPages(records, toEmbed);
  const mergedEntries = mergeEntries(previousEntries, freshEntries, liveSlugs);

  const dimensions = mergedEntries[0]?.vector.length ?? 0;
  const store: EmbeddingStore = {
    version: 1,
    model: embeddingModel,
    dimensions,
    entries: mergedEntries,
  };
  await writeEmbeddingStore(root, store);
  output.status("*", output.dim(`Embeddings updated (${mergedEntries.length} pages).`));
}
