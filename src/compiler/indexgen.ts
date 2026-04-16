/**
 * Wiki index generator.
 *
 * Scans all concept pages in wiki/concepts/, extracts frontmatter metadata,
 * and produces wiki/index.md with a sorted list of all concepts and their
 * summaries. Used after each compilation pass.
 */

import { readdir } from "fs/promises";
import path from "path";
import { atomicWrite, safeReadFile, parseFrontmatter } from "../utils/markdown.js";
import { CONCEPTS_DIR, QUERIES_DIR, INDEX_FILE } from "../utils/constants.js";
import * as output from "../utils/output.js";
import type { PageSummary } from "../utils/types.js";

/**
 * Generate the wiki/index.md listing all concept pages with summaries.
 * @param root - Project root directory.
 */
export async function generateIndex(root: string): Promise<void> {
  output.status("*", output.info("Generating index..."));

  const conceptsPath = path.join(root, CONCEPTS_DIR);
  const queriesPath = path.join(root, QUERIES_DIR);
  const concepts = await collectPageSummaries(conceptsPath);
  const queries = await collectPageSummaries(queriesPath);

  concepts.sort((a, b) => a.title.localeCompare(b.title));
  queries.sort((a, b) => a.title.localeCompare(b.title));

  const indexContent = buildIndexContent(concepts, queries);
  const indexPath = path.join(root, INDEX_FILE);
  await atomicWrite(indexPath, indexContent);

  const total = concepts.length + queries.length;
  output.status("+", output.success(`Index updated with ${total} pages.`));
}

/** A scanned page paired with its parsed frontmatter. */
interface ScannedPage {
  slug: string;
  meta: Record<string, unknown>;
}

/**
 * Scan a wiki directory and return every .md page paired with its parsed
 * frontmatter. Read-only utility shared by index generation and the MCP
 * server's status tool.
 * @param dirPath - Absolute path to a wiki page directory.
 * @returns Array of {slug, meta} entries — empty when the directory is missing.
 */
export async function scanWikiPages(dirPath: string): Promise<ScannedPage[]> {
  let files: string[];
  try {
    files = await readdir(dirPath);
  } catch {
    return [];
  }

  const scanned: ScannedPage[] = [];
  for (const file of files.filter((f) => f.endsWith(".md"))) {
    const content = await safeReadFile(path.join(dirPath, file));
    const { meta } = parseFrontmatter(content);
    scanned.push({ slug: file.replace(/\.md$/, ""), meta });
  }
  return scanned;
}

/**
 * Project a wiki directory into PageSummary entries (excludes orphaned and
 * untitled pages). Built on top of scanWikiPages so the MCP server can share
 * the underlying scan logic without re-reading the directory.
 * @param conceptsPath - Absolute path to wiki/concepts/.
 * @returns Array of page summary objects.
 */
export async function collectPageSummaries(
  conceptsPath: string,
): Promise<PageSummary[]> {
  const scanned = await scanWikiPages(conceptsPath);
  return scanned
    .filter(({ meta }) => meta.title && typeof meta.title === "string" && !meta.orphaned)
    .map(({ slug, meta }) => ({
      title: meta.title as string,
      slug,
      summary: typeof meta.summary === "string" ? meta.summary : "",
    }));
}

/** Strip [[wikilink]] brackets from text, leaving the inner text intact. */
function stripWikilinks(text: string): string {
  return text.replace(/\[\[([^\]]+)\]\]/g, "$1");
}

/**
 * Build the index.md markdown content from page summaries.
 * @param pages - Sorted array of page summaries.
 * @returns Full index.md content string.
 */
function buildIndexContent(concepts: PageSummary[], queries: PageSummary[]): string {
  const lines = ["# Knowledge Wiki", "", "## Concepts", ""];

  for (const page of concepts) {
    lines.push(`- **[[${page.title}]]** — ${stripWikilinks(page.summary)}`);
  }

  if (queries.length > 0) {
    lines.push("", "## Saved Queries", "");
    for (const page of queries) {
      lines.push(`- **[[${page.title}]]** — ${stripWikilinks(page.summary)}`);
    }
  }

  const total = concepts.length + queries.length;
  lines.push("");
  lines.push(`_${total} pages | Generated ${new Date().toISOString()}_`);
  lines.push("");

  return lines.join("\n");
}
