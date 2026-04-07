/**
 * LLM prompt templates and tool schemas for the compilation pipeline.
 * Contains the Anthropic tool definition for concept extraction,
 * prompt builders for both extraction and page generation phases,
 * and a parser for the structured tool output.
 */

import type { ExtractedConcept } from "../utils/types.js";

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
    "Place citations only at the end of prose paragraphs — not on headings, list items, or code blocks.",
    "Source filenames are visible as `--- SOURCE: filename.md ---` headers in the content below.",
    existingSection,
    relatedSection,
    "\n\n--- SOURCE MATERIAL ---\n\n",
    sourceContent,
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
    const concepts: ExtractedConcept[] = parsed.concepts ?? [];
    return concepts
      .filter(
        (c) =>
          typeof c.concept === "string" &&
          typeof c.summary === "string" &&
          typeof c.is_new === "boolean" &&
          (c.tags === undefined || Array.isArray(c.tags)),
      )
      .map((c) => ({
        concept: c.concept,
        summary: c.summary,
        is_new: c.is_new,
        tags: Array.isArray(c.tags) ? c.tags : undefined,
      }));
  } catch {
    return [];
  }
}
