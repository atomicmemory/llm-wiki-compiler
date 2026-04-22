/**
 * Commander action for `llmwiki review list`.
 *
 * Prints every pending review candidate (id, slug, sources, generated time)
 * so reviewers can pick one to inspect with `llmwiki review show <id>`.
 */

import { listCandidates } from "../compiler/candidates.js";
import * as output from "../utils/output.js";

/** List every pending candidate from .llmwiki/candidates/. */
export default async function reviewListCommand(): Promise<void> {
  output.header("Pending review candidates");

  const candidates = await listCandidates(process.cwd());
  if (candidates.length === 0) {
    output.status("✓", output.success("No pending candidates."));
    return;
  }

  for (const candidate of candidates) {
    const sources = candidate.sources.join(", ");
    const meta = output.dim(`${candidate.generatedAt} | sources: ${sources}`);
    output.status("?", `${output.info(candidate.id)} → ${candidate.slug} ${meta}`);
  }

  output.status(
    "→",
    output.dim(`Use \`llmwiki review show <id>\` to inspect a candidate.`),
  );
}
