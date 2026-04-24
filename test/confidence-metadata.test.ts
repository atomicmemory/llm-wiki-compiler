/**
 * Tests for confidence/contradiction/provenance metadata.
 *
 * Covers parsing of the new optional frontmatter fields, frontmatter
 * round-trip with the new metadata, the provenance-aware lint rules, and
 * backward-compatibility with pages that omit the new fields.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm } from "fs/promises";
import {
  buildFrontmatter,
  parseFrontmatter,
  parseProvenanceMetadata,
} from "../src/utils/markdown.js";
import {
  checkLowConfidencePages,
  checkContradictedPages,
  checkInferredWithoutCitations,
} from "../src/linter/rules.js";
import { parseConcepts } from "../src/compiler/prompts.js";
import { reconcileConceptMetadata } from "../src/compiler/index.js";
import { makeLintTempRoot } from "./fixtures/lint-temp-root.js";

let tmpDir: string;
let writeConcept: (slug: string, content: string) => Promise<void>;

beforeEach(async () => {
  const fx = await makeLintTempRoot("provenance-test");
  tmpDir = fx.root;
  writeConcept = fx.writeConceptPage;
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("parseProvenanceMetadata", () => {
  it("returns empty object for frontmatter without provenance fields", () => {
    const result = parseProvenanceMetadata({ title: "Test" });
    expect(result.confidence).toBeUndefined();
    expect(result.provenanceState).toBeUndefined();
    expect(result.contradictedBy).toBeUndefined();
    expect(result.inferredParagraphs).toBeUndefined();
  });

  it("parses confidence as a number in [0, 1]", () => {
    expect(parseProvenanceMetadata({ confidence: 0.7 }).confidence).toBe(0.7);
    expect(parseProvenanceMetadata({ confidence: -1 }).confidence).toBe(0);
    expect(parseProvenanceMetadata({ confidence: 5 }).confidence).toBe(1);
    expect(parseProvenanceMetadata({ confidence: "high" }).confidence).toBeUndefined();
  });

  it("accepts only known provenanceState values", () => {
    expect(parseProvenanceMetadata({ provenanceState: "extracted" }).provenanceState).toBe(
      "extracted",
    );
    expect(parseProvenanceMetadata({ provenanceState: "merged" }).provenanceState).toBe("merged");
    expect(parseProvenanceMetadata({ provenanceState: "bogus" }).provenanceState).toBeUndefined();
  });

  it("parses contradictedBy from string list and object list", () => {
    const fromStrings = parseProvenanceMetadata({ contradictedBy: ["other-slug"] });
    expect(fromStrings.contradictedBy).toEqual([{ slug: "other-slug" }]);

    const fromObjects = parseProvenanceMetadata({
      contradictedBy: [{ slug: "x", reason: "conflicting numbers" }],
    });
    expect(fromObjects.contradictedBy).toEqual([
      { slug: "x", reason: "conflicting numbers" },
    ]);
  });

  it("rejects invalid inferredParagraphs values", () => {
    expect(parseProvenanceMetadata({ inferredParagraphs: 3 }).inferredParagraphs).toBe(3);
    expect(parseProvenanceMetadata({ inferredParagraphs: -1 }).inferredParagraphs).toBeUndefined();
    expect(parseProvenanceMetadata({ inferredParagraphs: 1.5 }).inferredParagraphs).toBeUndefined();
  });
});

describe("frontmatter round-trip with provenance", () => {
  it("preserves provenance fields through buildFrontmatter and parseFrontmatter", () => {
    const fields = {
      title: "Test",
      confidence: 0.42,
      provenanceState: "inferred",
      contradictedBy: [{ slug: "rival-page", reason: "different number" }],
      inferredParagraphs: 4,
    };
    const built = buildFrontmatter(fields);
    const { meta } = parseFrontmatter(`${built}\n\nBody.`);
    const provenance = parseProvenanceMetadata(meta);
    expect(provenance.confidence).toBe(0.42);
    expect(provenance.provenanceState).toBe("inferred");
    expect(provenance.contradictedBy).toEqual([
      { slug: "rival-page", reason: "different number" },
    ]);
    expect(provenance.inferredParagraphs).toBe(4);
  });
});

describe("parseConcepts handles new optional fields", () => {
  it("passes through provenance fields from tool output", () => {
    const raw = JSON.stringify({
      concepts: [
        {
          concept: "Demo",
          summary: "A demo concept",
          is_new: true,
          confidence: 0.3,
          provenance_state: "inferred",
          contradicted_by: [{ slug: "rival" }],
          inferred_paragraphs: 2,
        },
      ],
    });
    const [concept] = parseConcepts(raw);
    expect(concept.confidence).toBe(0.3);
    expect(concept.provenanceState).toBe("inferred");
    expect(concept.contradictedBy).toEqual([{ slug: "rival" }]);
    expect(concept.inferredParagraphs).toBe(2);
  });

  it("still parses concepts with no provenance fields", () => {
    const raw = JSON.stringify({
      concepts: [{ concept: "Plain", summary: "no extras", is_new: false }],
    });
    const [concept] = parseConcepts(raw);
    expect(concept.confidence).toBeUndefined();
    expect(concept.provenanceState).toBeUndefined();
    expect(concept.contradictedBy).toBeUndefined();
  });
});

describe("checkLowConfidencePages", () => {
  it("flags pages whose confidence is below the threshold", async () => {
    await writeConcept(
      "shaky",
      "---\ntitle: Shaky\nconfidence: 0.2\n---\nBody.",
    );
    const results = await checkLowConfidencePages(tmpDir);
    expect(results).toHaveLength(1);
    expect(results[0].rule).toBe("low-confidence");
    expect(results[0].severity).toBe("warning");
  });

  it("ignores pages without a confidence field", async () => {
    await writeConcept("plain", "---\ntitle: Plain\n---\nBody.");
    const results = await checkLowConfidencePages(tmpDir);
    expect(results).toHaveLength(0);
  });

  it("ignores pages above the threshold", async () => {
    await writeConcept("solid", "---\ntitle: Solid\nconfidence: 0.9\n---\nBody.");
    const results = await checkLowConfidencePages(tmpDir);
    expect(results).toHaveLength(0);
  });
});

describe("checkContradictedPages", () => {
  it("flags pages with contradictedBy entries", async () => {
    const fm = "---\ntitle: Conflicted\ncontradictedBy:\n  - slug: rival\n    reason: disagrees\n---\n";
    await writeConcept("conflicted", `${fm}Body.`);
    const results = await checkContradictedPages(tmpDir);
    expect(results).toHaveLength(1);
    expect(results[0].rule).toBe("contradicted-page");
    expect(results[0].message).toContain("rival");
  });

  it("ignores pages without contradictedBy", async () => {
    await writeConcept("clean", "---\ntitle: Clean\n---\nBody.");
    const results = await checkContradictedPages(tmpDir);
    expect(results).toHaveLength(0);
  });
});

describe("checkInferredWithoutCitations", () => {
  it("flags pages whose metadata reports too many inferred paragraphs", async () => {
    await writeConcept(
      "infer",
      "---\ntitle: Infer\ninferredParagraphs: 5\n---\nA cited paragraph. ^[src.md]",
    );
    const results = await checkInferredWithoutCitations(tmpDir);
    expect(results).toHaveLength(1);
    expect(results[0].rule).toBe("excess-inferred-paragraphs");
  });

  it("falls back to counting uncited prose paragraphs when metadata is absent", async () => {
    const body = [
      "First uncited prose paragraph here.",
      "Second uncited prose paragraph here.",
      "Third uncited prose paragraph here.",
    ].join("\n\n");
    await writeConcept("nocitations", `---\ntitle: NoCites\n---\n${body}`);
    const results = await checkInferredWithoutCitations(tmpDir);
    expect(results).toHaveLength(1);
  });

  it("does not flag pages whose paragraphs are all cited", async () => {
    const body = "A well-cited paragraph. ^[src.md]\n\nAnother cited one. ^[src.md]";
    await writeConcept("good", `---\ntitle: Good\n---\n${body}`);
    const results = await checkInferredWithoutCitations(tmpDir);
    expect(results).toHaveLength(0);
  });
});

describe("reconcileConceptMetadata", () => {
  it("takes the minimum confidence across two concepts", () => {
    const first = { concept: "X", summary: "s", is_new: true, confidence: 0.8 };
    const second = { concept: "X", summary: "s", is_new: false, confidence: 0.3 };
    const result = reconcileConceptMetadata(first, second);
    expect(result.confidence).toBe(0.3);
  });

  it("sets provenanceState to 'merged' regardless of input states", () => {
    const first = { concept: "X", summary: "s", is_new: true, provenanceState: "extracted" as const };
    const second = { concept: "X", summary: "s", is_new: false, provenanceState: "inferred" as const };
    const result = reconcileConceptMetadata(first, second);
    expect(result.provenanceState).toBe("merged");
  });

  it("unions contradictedBy entries, deduplicating by slug", () => {
    const first = {
      concept: "X", summary: "s", is_new: true,
      contradictedBy: [{ slug: "a", reason: "r1" }, { slug: "b" }],
    };
    const second = {
      concept: "X", summary: "s", is_new: false,
      contradictedBy: [{ slug: "b", reason: "dup" }, { slug: "c" }],
    };
    const result = reconcileConceptMetadata(first, second);
    const slugs = result.contradictedBy?.map((r) => r.slug);
    expect(slugs).toEqual(["a", "b", "c"]);
    expect(result.contradictedBy).toHaveLength(3);
  });

  it("takes the maximum inferredParagraphs across two concepts", () => {
    const first = { concept: "X", summary: "s", is_new: true, inferredParagraphs: 1 };
    const second = { concept: "X", summary: "s", is_new: false, inferredParagraphs: 4 };
    const result = reconcileConceptMetadata(first, second);
    expect(result.inferredParagraphs).toBe(4);
  });

  it("inherits incoming confidence when existing has none", () => {
    const first = { concept: "X", summary: "s", is_new: true };
    const second = { concept: "X", summary: "s", is_new: false, confidence: 0.5 };
    const result = reconcileConceptMetadata(first, second);
    expect(result.confidence).toBe(0.5);
  });

  it("preserves concept title and summary from the first entry", () => {
    const first = { concept: "X", summary: "First summary", is_new: true };
    const second = { concept: "X", summary: "Second summary", is_new: false };
    const result = reconcileConceptMetadata(first, second);
    expect(result.concept).toBe("X");
    expect(result.summary).toBe("First summary");
  });
});
