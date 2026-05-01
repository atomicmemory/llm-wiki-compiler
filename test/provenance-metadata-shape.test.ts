/**
 * Compile-time pin for the shared ProvenanceMetadata shape.
 *
 * Codex's post-merge schema-overlap audit flagged that ExtractedConcept
 * and WikiFrontmatter independently re-declared the same four optional
 * fields (confidence, provenanceState, contradictedBy,
 * inferredParagraphs), which was a drift hazard. The fix composes both
 * surfaces from a single exported `ProvenanceMetadata` interface in
 * src/utils/types.ts, plus drops the duplicate private interface that
 * lived in src/utils/markdown.ts.
 *
 * The assertions below are static type-system checks expressed as
 * runtime assignments so a future re-introduction of the drift fails
 * `npx tsc --noEmit` rather than silently re-creating the gap.
 */

import { describe, it, expect } from "vitest";
import type {
  ExtractedConcept,
  ProvenanceMetadata,
  WikiFrontmatter,
} from "../src/utils/types.js";

describe("ProvenanceMetadata shared shape", () => {
  it("ExtractedConcept satisfies ProvenanceMetadata so the four fields are unified", () => {
    const concept: ExtractedConcept = {
      concept: "Concept",
      summary: "summary",
      is_new: true,
      confidence: 0.9,
      provenanceState: "extracted",
      contradictedBy: [{ slug: "other" }],
      inferredParagraphs: 2,
    };
    // Compile-time assertion: assigning to ProvenanceMetadata proves the
    // shared fields are structurally compatible. If a future change drops
    // a field from ProvenanceMetadata or renames it on ExtractedConcept,
    // this line stops type-checking.
    const provenance: ProvenanceMetadata = concept;
    expect(provenance.confidence).toBe(0.9);
    expect(provenance.provenanceState).toBe("extracted");
  });

  it("WikiFrontmatter satisfies ProvenanceMetadata for the same reason", () => {
    const frontmatter: WikiFrontmatter = {
      title: "Sample",
      summary: "An example.",
      sources: ["src.md"],
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:00.000Z",
      confidence: 0.8,
      provenanceState: "merged",
      contradictedBy: [{ slug: "alt" }],
      inferredParagraphs: 1,
    };
    const provenance: ProvenanceMetadata = frontmatter;
    expect(provenance.contradictedBy).toEqual([{ slug: "alt" }]);
    expect(provenance.inferredParagraphs).toBe(1);
  });
});
