/**
 * Commander action for `llmwiki query <question>`.
 * Two-step LLM-powered wiki query that first selects relevant pages from the
 * wiki index, then streams an answer grounded in those pages. Optionally saves
 * the response as a new page in wiki/queries/.
 *
 * Step 1 - Page Selection: Reads wiki/index.md and asks Claude (via tool_use)
 * to pick the most relevant concept pages for the question.
 *
 * Step 2 - Answer Generation: Loads the selected pages in full and streams
 * a cited answer to the terminal.
 */

import { existsSync } from "fs";
import path from "path";
import { callClaude } from "../utils/llm.js";
import type { LLMTool } from "../utils/provider.js";
import { atomicWrite, safeReadFile, slugify, buildFrontmatter, parseFrontmatter } from "../utils/markdown.js";
import { generateIndex } from "../compiler/indexgen.js";
import * as output from "../utils/output.js";
import { QUERY_PAGE_LIMIT, INDEX_FILE, CONCEPTS_DIR, QUERIES_DIR } from "../utils/constants.js";

/** Directories to search when loading selected pages, in priority order. */
const PAGE_DIRS = [CONCEPTS_DIR, QUERIES_DIR];

/** Tool schema for page selection (provider-agnostic). */
const PAGE_SELECTION_TOOL: LLMTool = {
  name: "select_pages",
  description: "Select the most relevant wiki pages to answer a question",
  input_schema: {
    type: "object" as const,
    properties: {
      pages: {
        type: "array",
        items: {
          type: "string",
          description: "Slug of a relevant wiki page (e.g. 'llm-knowledge-bases')",
        },
        maxItems: QUERY_PAGE_LIMIT,
      },
      reasoning: {
        type: "string",
        description: "Brief explanation of why these pages were selected",
      },
    },
    required: ["pages", "reasoning"],
  },
};

interface PageSelectionResult {
  pages: string[];
  reasoning: string;
}

/**
 * Select the most relevant wiki pages for a question using Claude tool_use.
 * @param question - The user's natural language question.
 * @param indexContent - The full text of wiki/index.md.
 * @returns Parsed page slugs and reasoning from Claude.
 */
async function selectPages(
  question: string,
  indexContent: string,
): Promise<PageSelectionResult> {
  const systemPrompt =
    "You are a knowledge base assistant. Given a question and a wiki index, select the most relevant pages.";

  const userMessage = `Question: ${question}\n\nWiki Index:\n${indexContent}`;

  const rawResult = await callClaude({
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
    tools: [PAGE_SELECTION_TOOL],
  });

  try {
    const parsed = JSON.parse(rawResult);
    return {
      pages: Array.isArray(parsed.pages) ? parsed.pages.filter((p: unknown) => typeof p === "string") : [],
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "No reasoning provided",
    };
  } catch {
    return { pages: [], reasoning: "Failed to parse page selection response" };
  }
}

/**
 * Load the full content of each selected wiki page.
 * Skips pages that don't exist and warns the user.
 * @param root - Absolute path to the project root directory.
 * @param slugs - Array of page slugs to load from wiki/concepts/.
 * @returns Combined page contents with slug headers for context.
 */
export async function loadSelectedPages(root: string, slugs: string[]): Promise<string> {
  const sections: string[] = [];

  for (const slug of slugs) {
    let content = "";
    for (const dir of PAGE_DIRS) {
      const candidate = await safeReadFile(path.join(root, dir, `${slug}.md`));
      if (!candidate) continue;
      const { meta } = parseFrontmatter(candidate);
      if (meta.orphaned) continue;
      content = candidate;
      break;
    }

    if (!content) {
      output.status("?", output.warn(`Page not found: ${slug}.md — skipping`));
      continue;
    }

    sections.push(`--- Page: ${slug} ---\n${content}`);
  }

  return sections.join("\n\n");
}

/**
 * Stream an answer from Claude using the loaded wiki pages as context.
 * @param question - The user's natural language question.
 * @param pagesContent - Combined content of the selected wiki pages.
 * @returns The full answer text after streaming completes.
 */
async function streamAnswer(question: string, pagesContent: string): Promise<string> {
  const systemPrompt =
    "You are a knowledge assistant. Answer the question using ONLY the wiki content provided. " +
    "Cite specific pages using [[Page Title]] wikilinks. " +
    "If the wiki doesn't contain enough information, say so.";

  const userMessage = `Question: ${question}\n\nRelevant wiki pages:\n${pagesContent}`;

  const answer = await callClaude({
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
    stream: true,
    onToken: (text: string) => process.stdout.write(text),
  });

  // Ensure terminal output ends on a new line after streaming
  process.stdout.write("\n");
  return answer;
}

/**
 * Generate a one-line summary from the answer for use in the wiki index.
 * Takes the first sentence (up to 120 chars) so the page-selection LLM
 * has retrieval signal beyond just the title.
 * @param answer - The full answer text.
 * @returns A short summary string.
 */
export function summarizeAnswer(answer: string): string {
  const firstLine = answer.trim().split(/\n/)[0] ?? "";
  const firstSentence = firstLine.split(/(?<=[.!?])\s/)[0] ?? firstLine;
  return firstSentence.slice(0, 120);
}

/**
 * Save a query answer as a wiki page in the queries/ directory,
 * then regenerate the wiki index so the answer is immediately retrievable.
 * @param root - Absolute path to the project root directory.
 * @param question - The original question used as the page title.
 * @param answer - The generated answer body.
 */
async function saveQueryPage(root: string, question: string, answer: string): Promise<void> {
  const slug = slugify(question);
  const filePath = path.join(root, QUERIES_DIR, `${slug}.md`);

  const frontmatter = buildFrontmatter({
    title: question,
    summary: summarizeAnswer(answer),
    type: "query",
    createdAt: new Date().toISOString(),
  });

  const document = `${frontmatter}\n\n${answer}\n`;
  await atomicWrite(filePath, document);

  output.status(
    "+",
    output.success(`Saved query → ${output.source(filePath)}`),
  );

  // Regenerate the index so the saved query is immediately discoverable
  // by the next query's page-selection step.
  await generateIndex(root);
}

/**
 * Run a two-step LLM-powered query against the knowledge wiki.
 * @param root - Absolute path to the project root directory.
 * @param question - The natural language question to answer.
 * @param options - Command options (e.g. --save to persist the answer).
 */
export default async function queryCommand(
  root: string,
  question: string,
  options: { save?: boolean },
): Promise<void> {
  if (!existsSync(path.join(root, INDEX_FILE))) {
    output.status("!", output.error("Wiki index not found. Run `llmwiki compile` first."));
    return;
  }

  // Step 1: Select relevant pages
  output.header("Selecting relevant pages");

  const indexContent = await safeReadFile(path.join(root, INDEX_FILE));
  const { pages: rawPages, reasoning } = await selectPages(question, indexContent);
  const pages = rawPages.map((p) => slugify(p));

  output.status("i", output.dim(`Reasoning: ${reasoning}`));
  output.status("*", output.info(`Selected ${pages.length} page(s): ${rawPages.join(", ")}`));

  // Step 2: Load pages and stream the answer
  output.header("Generating answer");

  const pagesContent = await loadSelectedPages(root, pages);

  if (!pagesContent) {
    output.status("!", output.error("No matching pages found. Try refining your question."));
    return;
  }

  const answer = await streamAnswer(question, pagesContent);

  // Optional: save the answer as a query page
  if (options.save) {
    await saveQueryPage(root, question, answer);
    output.status("→", output.dim("Saved. Future queries will use this answer as context."));
  } else {
    output.status("→", output.dim("Tip: use --save to add this answer to your wiki"));
  }
}
