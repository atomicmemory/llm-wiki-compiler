/**
 * LLM prompt templates and tool schemas for the compilation pipeline.
 * Contains the Anthropic tool definition for concept extraction,
 * prompt builders for both extraction and page generation phases,
 * and a parser for the structured tool output.
 */

import type {
  ContradictionRef,
  ExtractedConcept,
  ProvenanceState,
} from "../utils/types.js";
import type { PageKindRule, SeedPage } from "../schema/index.js";

/** Allowed provenance state strings emitted by the LLM tool schema. */
const PROVENANCE_STATE_VALUES: ProvenanceState[] = [
  "extracted",
  "merged",
  "inferred",
  "ambiguous",
];

/**
 * Anthropic Tool definition for extracting knowledge concepts from a source.
 * Used with callClaude's tool_use mode to get structured concept data.
 */
export const CONCEPT_EXTRACTION_TOOL = {
  name: "extract_concepts",
  description: "Extract knowledge concepts from a source document",
  input_schema: {
    type: "object" as const,
    properties: {
      concepts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            concept: {
              type: "string",
              description: "Human-readable concept title",
            },
            summary: {
              type: "string",
              description: "One-line description",
            },
            is_new: {
              type: "boolean",
              description: "True if this is a new concept not in existing wiki",
            },
            tags: {
              type: "array",
              items: { type: "string" },
              description:
                "2-4 categorical tags for organizing this concept (e.g., 'machine-learning', 'optimization')",
            },
            confidence: {
              type: "number",
              description:
                "Confidence in this concept on a 0..1 scale (1 = directly stated, 0 = highly speculative).",
            },
            provenance_state: {
              type: "string",
              enum: PROVENANCE_STATE_VALUES,
              description:
                "How this concept was produced: 'extracted' (direct from source), 'merged' (synthesised across sources), 'inferred' (model deduction), or 'ambiguous' (sources disagree).",
            },
            contradicted_by: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  slug: { type: "string", description: "Slug of the contradicting concept." },
                  reason: { type: "string", description: "Brief reason for the contradiction." },
                },
                required: ["slug"],
              },
              description: "Slugs of other concepts whose evidence contradicts this one.",
            },
            inferred_paragraphs: {
              type: "integer",
              description:
                "Estimated number of paragraphs in the page that will be inferred rather than directly cited.",
            },
          },
          required: ["concept", "summary", "is_new"],
        },
      },
    },
    required: ["concepts"],
  },
};

/**
 * Build the system prompt for the concept extraction phase.
 * Instructs the LLM to analyze a source document and identify distinct concepts.
 * @param sourceContent - The full text of the source document.
 * @param existingIndex - The current wiki index.md contents (may be empty).
 * @returns System prompt string for the extraction call.
 */
export function buildExtractionPrompt(
  sourceContent: string,
  existingIndex: string,
): string {
  const indexSection = existingIndex
    ? `\n\nHere is the existing wiki index — avoid duplicating concepts already covered:\n\n${existingIndex}`
    : "\n\nNo existing wiki pages yet.";

  return [
    "You are a knowledge extraction engine. Analyze the following source document",
    "and identify 3-8 distinct, meaningful concepts worth documenting as wiki pages.",
    "Each concept should be a standalone topic that someone might look up.",
    "Focus on key ideas, techniques, patterns, or entities — not trivial details.",
    "Use the extract_concepts tool to return your findings.",
    "",
    "For every concept, emit provenance metadata so downstream tools can reason",
    "about reliability:",
    "  - confidence: 0..1 — how certain you are the source supports this concept.",
    "  - provenance_state: 'extracted' if directly stated, 'merged' if synthesised",
    "    from multiple parts of the source, 'inferred' if reasoned from context,",
    "    or 'ambiguous' if the source is contradictory or unclear.",
    "  - contradicted_by: slugs of other concepts (in this batch or the index)",
    "    whose evidence conflicts with this one.",
    "  - inferred_paragraphs: estimated number of paragraphs in the resulting",
    "    page that will be inferred rather than directly citable.",
    indexSection,
    "\n\n--- SOURCE DOCUMENT ---\n\n",
    sourceContent,
  ].join("\n");
}

/**
 * Build the system prompt for wiki page generation.
 * Instructs the LLM to write a complete wiki page for a single concept.
 * @param concept - The concept title to write about.
 * @param sourceContent - The source material to draw from.
 * @param existingPage - The current page content if updating (empty for new pages).
 * @param relatedPages - Concatenated content of related wiki pages for context.
 * @returns System prompt string for the page generation call.
 */
export function buildPagePrompt(
  concept: string,
  sourceContent: string,
  existingPage: string,
  relatedPages: string,
): string {
  const existingSection = existingPage
    ? `\n\nExisting page to update:\n\n${existingPage}`
    : "";

  const relatedSection = relatedPages
    ? `\n\nRelated wiki pages for cross-referencing:\n\n${relatedPages}`
    : "";

  return [
    `You are a wiki author. Write a clear, well-structured markdown page about "${concept}".`,
    "Draw facts only from the provided source material.",
    "Include a ## Sources section at the end listing the source document.",
    "Suggest [[wikilinks]] to related concepts where appropriate.",
    "Write in a neutral, informative tone. Be concise but thorough.",
    "",
    "Source attribution: at the end of each prose paragraph, append a citation",
    "marker showing which source file(s) the paragraph drew from.",
    "Format: ^[filename.md] for single-source, ^[source-a.md, source-b.md] for multi-source.",
    "When a single sentence makes a specific factual claim and you can identify the",
    "exact line range it came from, you may use the claim-level form",
    "^[filename.md:START-END] (or ^[filename.md#LSTART-LEND]) at the end of that",
    "sentence — START and END are 1-indexed line numbers in the source file.",
    "Paragraph-level citations remain the default; only switch to claim-level form",
    "when it materially improves verifiability and the line range is unambiguous.",
    "Place citations only at the end of prose paragraphs or sentences — not on",
    "headings, list items, or code blocks.",
    "Source filenames are visible as `--- SOURCE: filename.md ---` headers in the content below.",
    "",
    "If a paragraph is your inference rather than a direct extraction, leave it",
    "uncited — downstream lint rules will count uncited paragraphs as 'inferred'",
    "to compute the page's provenance metadata.",
    existingSection,
    relatedSection,
    "\n\n--- SOURCE MATERIAL ---\n\n",
    sourceContent,
  ].join("\n");
}

/** Raw concept shape as it arrives from the tool JSON. */
interface RawConcept {
  concept: unknown;
  summary: unknown;
  is_new: unknown;
  tags?: unknown;
  confidence?: unknown;
  provenance_state?: unknown;
  contradicted_by?: unknown;
  inferred_paragraphs?: unknown;
}

/** True if the raw concept has the required string/boolean fields. */
function isValidRawConcept(c: RawConcept): boolean {
  return (
    typeof c.concept === "string" &&
    typeof c.summary === "string" &&
    typeof c.is_new === "boolean" &&
    (c.tags === undefined || Array.isArray(c.tags))
  );
}

/** Coerce raw contradiction entries from the tool into typed refs. */
function coerceContradictedBy(raw: unknown): ContradictionRef[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const refs: ContradictionRef[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const obj = entry as { slug?: unknown; reason?: unknown };
    if (typeof obj.slug !== "string" || obj.slug.trim().length === 0) continue;
    const ref: ContradictionRef = { slug: obj.slug.trim() };
    if (typeof obj.reason === "string") ref.reason = obj.reason;
    refs.push(ref);
  }
  return refs.length > 0 ? refs : undefined;
}

/** Map a validated raw concept into an ExtractedConcept. */
function mapRawConcept(c: RawConcept): ExtractedConcept {
  const provenance = typeof c.provenance_state === "string" &&
    PROVENANCE_STATE_VALUES.includes(c.provenance_state as ProvenanceState)
    ? (c.provenance_state as ProvenanceState)
    : undefined;
  return {
    concept: c.concept as string,
    summary: c.summary as string,
    is_new: c.is_new as boolean,
    tags: Array.isArray(c.tags) ? (c.tags as string[]) : undefined,
    confidence: typeof c.confidence === "number" ? c.confidence : undefined,
    provenanceState: provenance,
    contradictedBy: coerceContradictedBy(c.contradicted_by),
    inferredParagraphs: typeof c.inferred_paragraphs === "number" &&
      Number.isInteger(c.inferred_paragraphs) && c.inferred_paragraphs >= 0
      ? c.inferred_paragraphs
      : undefined,
  };
}

/**
 * Build a system prompt for generating a seed page (overview / comparison /
 * entity) declared in the project's schema config. Seed pages weave together
 * material from related concept pages rather than from raw source files.
 * @param seed - Seed page definition pulled from the schema.
 * @param rule - Per-kind rule (used for the description and link minimum).
 * @param relatedPagesContent - Concatenated content of related concept pages.
 * @returns System prompt string for the page generation call.
 */
export function buildSeedPagePrompt(
  seed: SeedPage,
  rule: PageKindRule,
  relatedPagesContent: string,
): string {
  const minLinks = rule.minWikilinks;
  const linkExpectation = minLinks > 0
    ? `Include at least ${minLinks} [[wikilinks]] to related pages.`
    : "Use [[wikilinks]] when referencing other pages.";
  return [
    `You are a wiki author. Write a ${seed.kind} page titled "${seed.title}".`,
    `Page-kind guidance: ${rule.description}`,
    `Summary line for context: ${seed.summary}`,
    "Draw facts only from the related wiki pages provided below.",
    linkExpectation,
    "Write in a neutral, informative tone. Be concise but thorough.",
    "\n\n--- RELATED PAGES ---\n\n",
    relatedPagesContent,
  ].join("\n");
}

/**
 * Parse the JSON tool output from concept extraction into typed objects.
 * @param toolOutput - Raw JSON string returned from the extract_concepts tool.
 * @returns Array of ExtractedConcept objects.
 */
export function parseConcepts(toolOutput: string): ExtractedConcept[] {
  try {
    const parsed = JSON.parse(toolOutput);
    const concepts: RawConcept[] = parsed.concepts ?? [];
    return concepts.filter(isValidRawConcept).map(mapRawConcept);
  } catch {
    return [];
  }
}
