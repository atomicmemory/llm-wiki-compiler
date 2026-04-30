/**
 * Chunked retrieval helpers: text splitting, content hashing, and BM25 reranking.
 *
 * The query pipeline relies on these utilities to:
 *   1. Split a wiki page into paragraph-aligned chunks for embedding.
 *   2. Detect unchanged chunks via a stable content hash so embedding refreshes
 *      can skip work.
 *   3. Rerank a candidate set with a lightweight BM25 score over chunk text,
 *      improving precision over pure cosine similarity for keyword-heavy
 *      questions.
 *
 * No network calls happen here — these are deterministic CPU-side helpers
 * that are easy to unit test and safe to invoke from any code path.
 */

import { createHash } from "crypto";
import {
  CHUNK_MAX_CHARS,
  CHUNK_MIN_CHARS,
  CHUNK_TARGET_CHARS,
} from "./constants.js";

/** Stable content hash used to detect chunk-level changes between runs. */
export function hashChunkText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}

/**
 * Split a page body into paragraph-aligned chunks bounded by CHUNK_TARGET_CHARS.
 * Trailing fragments smaller than CHUNK_MIN_CHARS are merged into the previous
 * chunk so we never emit a tiny dangling piece. Paragraphs longer than
 * CHUNK_MAX_CHARS are sentence-split before being added.
 *
 * @param body - Raw page body (frontmatter already stripped).
 * @returns Ordered chunk strings; empty array when body has no usable text.
 */
export function splitIntoChunks(body: string): string[] {
  const paragraphs = extractParagraphs(body);
  if (paragraphs.length === 0) return [];

  const chunks: string[] = [];
  let buffer = "";

  for (const paragraph of paragraphs) {
    for (const piece of splitOversizedParagraph(paragraph)) {
      buffer = appendParagraph(buffer, piece, chunks);
    }
  }

  if (buffer.length > 0) chunks.push(buffer);
  return mergeTrailingFragment(chunks);
}

/** Append a paragraph to the buffer, flushing when the target size is exceeded. */
function appendParagraph(buffer: string, paragraph: string, chunks: string[]): string {
  const candidate = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
  if (candidate.length <= CHUNK_TARGET_CHARS) return candidate;

  if (buffer.length > 0) {
    chunks.push(buffer);
    return paragraph;
  }
  // Single paragraph already exceeds target — emit it as a standalone chunk.
  chunks.push(candidate);
  return "";
}

/**
 * Merge a too-small trailing chunk back into its predecessor for cleaner
 * ranking. We only merge when the combined size would still respect
 * CHUNK_MAX_CHARS — otherwise the tiny tail stays standalone.
 */
function mergeTrailingFragment(chunks: string[]): string[] {
  if (chunks.length < 2) return chunks;
  const last = chunks[chunks.length - 1];
  if (last.length >= CHUNK_MIN_CHARS) return chunks;
  const previous = chunks[chunks.length - 2];
  // +2 covers the "\n\n" separator length we insert between paragraphs.
  if (previous.length + last.length + 2 > CHUNK_MAX_CHARS) return chunks;
  const merged = chunks.slice(0, -2);
  merged.push(`${previous}\n\n${last}`);
  return merged;
}

/** Strip whitespace-only paragraphs from a markdown body. */
function extractParagraphs(body: string): string[] {
  return body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * Sentence-split a paragraph that exceeds CHUNK_MAX_CHARS so the resulting
 * pieces still respect the upper bound. A single sentence longer than the
 * cap is hard-cut at CHUNK_MAX_CHARS — preferable to dropping content.
 */
function splitOversizedParagraph(paragraph: string): string[] {
  if (paragraph.length <= CHUNK_MAX_CHARS) return [paragraph];

  const sentences = paragraph.split(/(?<=[.!?])\s+/);
  const pieces: string[] = [];
  let buffer = "";

  for (const sentence of sentences) {
    if ((buffer + " " + sentence).length > CHUNK_MAX_CHARS && buffer.length > 0) {
      pieces.push(buffer.trim());
      buffer = sentence;
    } else {
      buffer = buffer ? `${buffer} ${sentence}` : sentence;
    }
  }

  if (buffer.length > 0) pieces.push(buffer.trim());
  return pieces.flatMap(hardCut);
}

/** Hard-cut a string longer than CHUNK_MAX_CHARS into fixed-size pieces. */
function hardCut(text: string): string[] {
  if (text.length <= CHUNK_MAX_CHARS) return [text];
  const pieces: string[] = [];
  for (let start = 0; start < text.length; start += CHUNK_MAX_CHARS) {
    pieces.push(text.slice(start, start + CHUNK_MAX_CHARS));
  }
  return pieces;
}

/** A scored candidate that the BM25 reranker accepts. */
interface RankableCandidate {
  text: string;
  /** Initial similarity score; preserved for debug output and tie-breaking. */
  baseScore: number;
}

/** Result of a BM25 rerank: original candidate plus the rerank score. */
interface RankedCandidate<T extends RankableCandidate> {
  candidate: T;
  score: number;
}

/**
 * Rerank candidates with BM25 over their `text` field given a free-text query.
 * BM25 is a deterministic keyword-overlap metric that complements semantic
 * similarity well: it boosts chunks that literally mention the query terms.
 *
 * @param query - Natural-language query.
 * @param candidates - Items to rerank; their `baseScore` is used as a tiebreaker.
 * @returns Sorted descending by combined score.
 */
export function rerankWithBm25<T extends RankableCandidate>(
  query: string,
  candidates: T[],
): Array<RankedCandidate<T>> {
  if (candidates.length === 0) return [];
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) {
    return candidates.map((candidate) => ({ candidate, score: candidate.baseScore }));
  }

  const docs = candidates.map((c) => tokenize(c.text));
  const stats = buildCorpusStats(docs);
  return rankByBm25Score(candidates, docs, queryTerms, stats);
}

/** Rank candidates by combined BM25 + base semantic score. */
function rankByBm25Score<T extends RankableCandidate>(
  candidates: T[],
  docs: string[][],
  queryTerms: string[],
  stats: CorpusStats,
): Array<RankedCandidate<T>> {
  const scored = candidates.map((candidate, index) => {
    const lexical = bm25Score(queryTerms, docs[index], stats);
    return { candidate, score: lexical + candidate.baseScore * BASE_SCORE_WEIGHT };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

/** Tokenise a string into lowercase alphanumeric tokens for BM25. */
function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

interface CorpusStats {
  /** Document frequency per term: how many docs contain the term. */
  docFreq: Map<string, number>;
  /** Average document length across the corpus. */
  avgDocLen: number;
  /** Total document count. */
  totalDocs: number;
}

/** Precompute BM25 corpus statistics from the tokenised candidate set. */
function buildCorpusStats(docs: string[][]): CorpusStats {
  const docFreq = new Map<string, number>();
  let totalLen = 0;
  for (const tokens of docs) {
    totalLen += tokens.length;
    const unique = new Set(tokens);
    for (const term of unique) docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
  }
  const totalDocs = docs.length;
  const avgDocLen = totalDocs > 0 ? totalLen / totalDocs : 0;
  return { docFreq, avgDocLen, totalDocs };
}

/** BM25 saturation parameter; higher = slower term-frequency saturation. */
const BM25_K1 = 1.5;
/** BM25 length normalisation strength; 0 disables, 1 is full normalisation. */
const BM25_B = 0.75;
/** How much weight the original semantic score retains in the rerank tie-break. */
const BASE_SCORE_WEIGHT = 0.5;

/** Compute BM25 score for one document against a tokenised query. */
function bm25Score(queryTerms: string[], docTokens: string[], stats: CorpusStats): number {
  if (docTokens.length === 0 || stats.totalDocs === 0) return 0;
  const termFreq = countTerms(docTokens);
  const lengthRatio = docTokens.length / (stats.avgDocLen || 1);

  let total = 0;
  for (const term of queryTerms) {
    const tf = termFreq.get(term) ?? 0;
    if (tf === 0) continue;
    const idf = idfWeight(stats.docFreq.get(term) ?? 0, stats.totalDocs);
    const numerator = tf * (BM25_K1 + 1);
    const denominator = tf + BM25_K1 * (1 - BM25_B + BM25_B * lengthRatio);
    total += idf * (numerator / denominator);
  }
  return total;
}

/** BM25 inverse-document-frequency component (Robertson-Spärck Jones form). */
function idfWeight(docFrequency: number, totalDocs: number): number {
  const numerator = totalDocs - docFrequency + 0.5;
  const denominator = docFrequency + 0.5;
  // +1 inside log keeps idf non-negative even when a term appears in every doc.
  return Math.log(1 + numerator / denominator);
}

/** Count token occurrences in a single document. */
function countTerms(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return counts;
}
