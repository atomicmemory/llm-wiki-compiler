/**
 * Commander action for `llmwiki review approve <id>`.
 *
 * Promotes a pending candidate into the live wiki: writes the page body to
 * wiki/concepts/<slug>.md, refreshes the index/MOC, updates embeddings, and
 * removes the candidate file. Approval never re-invokes the LLM — the body
 * stored in the candidate is written verbatim.
 */

import path from "path";
import {
  atomicWrite,
  validateWikiPage,
} from "../utils/markdown.js";
import { deleteCandidate, loadCandidateOrFail } from "../compiler/candidates.js";
import { generateIndex } from "../compiler/indexgen.js";
import { generateMOC } from "../compiler/obsidian.js";
import { resolveLinks } from "../compiler/resolver.js";
import { updateEmbeddings } from "../utils/embeddings.js";
import { updateSourceState } from "../utils/state.js";
import { CONCEPTS_DIR } from "../utils/constants.js";
import * as output from "../utils/output.js";
import type { ReviewCandidate } from "../utils/types.js";

/** Approve a pending candidate by promoting its body into wiki/concepts/. */
export default async function reviewApproveCommand(id: string): Promise<void> {
  const root = process.cwd();
  const candidate = await loadCandidateOrFail(root, id);
  if (!candidate) return;

  if (!validateWikiPage(candidate.body)) {
    output.status("!", output.error(`Candidate ${id} failed page validation; not approved.`));
    process.exitCode = 1;
    return;
  }

  const pagePath = path.join(root, CONCEPTS_DIR, `${candidate.slug}.md`);
  await atomicWrite(pagePath, candidate.body);
  output.status("+", output.success(`Approved → ${output.source(pagePath)}`));

  await persistCandidateSourceStates(root, candidate);
  await refreshWikiAfterApproval(root, candidate.slug);
  await deleteCandidate(root, id);
  output.status("✓", output.dim(`Candidate ${id} cleared.`));
}

/**
 * Flush the source-state snapshot stored on the candidate into
 * `.llmwiki/state.json` so the contributing source files are marked
 * compiled. Without this, approved candidates would re-appear on the next
 * `compile` run because the source still looks "new" or "changed" to the
 * change detector.
 */
async function persistCandidateSourceStates(
  root: string,
  candidate: ReviewCandidate,
): Promise<void> {
  const states = candidate.sourceStates;
  if (!states) return;
  for (const [sourceFile, entry] of Object.entries(states)) {
    await updateSourceState(root, sourceFile, entry);
  }
}

/** Refresh interlinks, index, MOC, and embeddings after writing a candidate. */
async function refreshWikiAfterApproval(root: string, slug: string): Promise<void> {
  await resolveLinks(root, [slug], [slug]);
  await generateIndex(root);
  await generateMOC(root);
  await safelyUpdateEmbeddings(root, [slug]);
}

/**
 * Refresh the embeddings store without failing approval.
 * Mirrors the compiler's tolerance: missing API keys / transient provider
 * failures should warn, not abort the approval flow.
 */
async function safelyUpdateEmbeddings(root: string, slugs: string[]): Promise<void> {
  try {
    await updateEmbeddings(root, slugs);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    output.status("!", output.warn(`Skipped embeddings update: ${message}`));
  }
}
