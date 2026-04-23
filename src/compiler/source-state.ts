/**
 * Source-state snapshot helpers shared between the live compile path and the
 * review-candidate path.
 *
 * The compile pipeline normally persists a `SourceState` entry for every
 * extracted source so subsequent compiles can skip unchanged inputs. When
 * compile runs in `--review` mode, page writes are deferred — but the same
 * per-source state still needs to land on approval, otherwise approved
 * sources stay marked as "new/changed" forever and reproduce duplicate
 * candidates on every compile.
 *
 * This module produces a `Record<sourceFile, SourceState>` snapshot from the
 * extraction results so it can ride along inside each `ReviewCandidate` and
 * be flushed to `.llmwiki/state.json` at approval time.
 */

import path from "path";
import { hashFile } from "./hasher.js";
import { slugify } from "../utils/markdown.js";
import { SOURCES_DIR } from "../utils/constants.js";
import type { ExtractionResult } from "./deps.js";
import type { SourceState } from "../utils/types.js";

/**
 * Compute a per-source state snapshot keyed by source filename.
 *
 * Hashes every contributing source once so each candidate carries the
 * incremental-state payload required to mark its sources compiled on
 * approval. Sources with no extracted concepts are skipped — we only mark
 * sources compiled when extraction succeeded, mirroring the live path's
 * behaviour.
 *
 * @param root - Project root directory.
 * @param extractions - Extraction results from the compile pipeline.
 * @returns Map of source filename → SourceState ready for state.json.
 */
export async function buildExtractionSourceStates(
  root: string,
  extractions: ExtractionResult[],
): Promise<Record<string, SourceState>> {
  const snapshot: Record<string, SourceState> = {};
  const compiledAt = new Date().toISOString();

  for (const result of extractions) {
    if (result.concepts.length === 0) continue;
    snapshot[result.sourceFile] = await buildEntry(root, result, compiledAt);
  }

  return snapshot;
}

/** Build a single SourceState entry for one extraction result. */
async function buildEntry(
  root: string,
  result: ExtractionResult,
  compiledAt: string,
): Promise<SourceState> {
  const filePath = path.join(root, SOURCES_DIR, result.sourceFile);
  const hash = await hashFile(filePath);
  return {
    hash,
    concepts: result.concepts.map((concept) => slugify(concept.concept)),
    compiledAt,
  };
}

/**
 * Filter a global source-state snapshot down to entries relevant to a
 * specific candidate. A candidate carries only the source-state entries
 * for sources that actually contributed to it, so on approval we can
 * persist a minimal, accurate slice into state.json.
 *
 * @param allStates - Global per-source snapshot from buildExtractionSourceStates.
 * @param sourceFiles - Source filenames that contributed to the candidate.
 */
export function pickStatesForSources(
  allStates: Record<string, SourceState>,
  sourceFiles: string[],
): Record<string, SourceState> {
  const picked: Record<string, SourceState> = {};
  for (const file of sourceFiles) {
    const entry = allStates[file];
    if (entry) picked[file] = entry;
  }
  return picked;
}
