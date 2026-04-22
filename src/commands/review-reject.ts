/**
 * Commander action for `llmwiki review reject <id>`.
 *
 * Removes a candidate from the pending area without touching `wiki/`.
 * Rejected candidates are moved into .llmwiki/candidates/archive/ so they
 * remain auditable but never appear in `llmwiki review list` again.
 */

import { archiveCandidate, loadCandidateOrFail } from "../compiler/candidates.js";
import * as output from "../utils/output.js";

/** Reject a pending candidate by archiving its JSON record. */
export default async function reviewRejectCommand(id: string): Promise<void> {
  const root = process.cwd();
  const candidate = await loadCandidateOrFail(root, id);
  if (!candidate) return;

  await archiveCandidate(root, id);
  output.status(
    "-",
    output.warn(`Rejected candidate ${id} (${candidate.slug}) — archived, wiki unchanged.`),
  );
}
