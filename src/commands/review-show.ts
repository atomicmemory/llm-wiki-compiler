/**
 * Commander action for `llmwiki review show <id>`.
 *
 * Prints a single candidate's metadata header followed by its full body so
 * reviewers can read the proposed page before approving or rejecting.
 */

import { loadCandidateOrFail } from "../compiler/candidates.js";
import * as output from "../utils/output.js";

/** Print a single candidate's full content to stdout. */
export default async function reviewShowCommand(id: string): Promise<void> {
  const candidate = await loadCandidateOrFail(process.cwd(), id);
  if (!candidate) return;

  output.header(`Candidate ${candidate.id}`);
  output.status("i", output.dim(`title:      ${candidate.title}`));
  output.status("i", output.dim(`slug:       ${candidate.slug}`));
  output.status("i", output.dim(`summary:    ${candidate.summary}`));
  output.status("i", output.dim(`sources:    ${candidate.sources.join(", ")}`));
  output.status("i", output.dim(`generated:  ${candidate.generatedAt}`));

  console.log();
  console.log(candidate.body);

  if (candidate.schemaViolations && candidate.schemaViolations.length > 0) {
    console.log();
    output.header("Schema violations");
    for (const v of candidate.schemaViolations) {
      output.status("!", output.warn(`[${v.severity}] ${v.message}`));
    }
  }
}
