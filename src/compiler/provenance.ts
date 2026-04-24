/**
 * Helpers for surfacing provenance metadata during compilation.
 *
 * Keeps the compile orchestrator small by isolating the logic that copies
 * confidence/contradiction signals from extracted concepts onto wiki page
 * frontmatter and emits compile-time warnings when contradictions are
 * reported.
 */

import * as output from "../utils/output.js";
import type { ExtractedConcept } from "../utils/types.js";

/**
 * Copy provenance metadata fields from an extracted concept onto the
 * frontmatter record, omitting fields the LLM did not provide so existing
 * pages without these fields stay clean.
 * @param fields - Mutable frontmatter record being assembled for a page.
 * @param concept - Source concept whose provenance metadata to apply.
 */
export function addProvenanceMeta(
  fields: Record<string, unknown>,
  concept: ExtractedConcept,
): void {
  if (typeof concept.confidence === "number") {
    fields.confidence = concept.confidence;
  }
  if (concept.provenanceState) {
    fields.provenanceState = concept.provenanceState;
  }
  if (concept.contradictedBy && concept.contradictedBy.length > 0) {
    fields.contradictedBy = concept.contradictedBy;
  }
  if (typeof concept.inferredParagraphs === "number") {
    fields.inferredParagraphs = concept.inferredParagraphs;
  }
}

/**
 * Print a compile-time warning when a concept reports contradictions with
 * other pages. Returns silently when there is nothing to report.
 * @param conceptTitle - Human-readable title of the concept being compiled.
 * @param concept - The extracted concept whose contradictions to surface.
 */
export function reportContradictionWarnings(
  conceptTitle: string,
  concept: ExtractedConcept,
): void {
  const refs = concept.contradictedBy;
  if (!refs || refs.length === 0) return;
  const slugs = refs.map((r) => r.slug).join(", ");
  output.status(
    "!",
    output.warn(`Contradiction reported on "${conceptTitle}" — conflicts with: ${slugs}`),
  );
}
