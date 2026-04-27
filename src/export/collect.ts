/**
 * Wiki page collector for the export subsystem.
 *
 * Reads all non-orphaned concept and query pages, parses their frontmatter and
 * body, extracts [[wikilink]] edges, and returns a normalised list of
 * ExportPage objects consumed by every format writer.
 */

import { readdir, readFile } from "fs/promises";
import path from "path";
import { parseFrontmatter } from "../utils/markdown.js";
import { slugify } from "../utils/markdown.js";
import { CONCEPTS_DIR, QUERIES_DIR } from "../utils/constants.js";
import type { ExportPage, PageKind } from "./types.js";

/** Regex that matches [[wikilink]] or [[wikilink|alias]] patterns. */
const WIKILINK_RE = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

/**
 * Extract the slugs of all pages linked via [[wikilinks]] in the body.
 * @param body - The markdown body text.
 * @returns Deduplicated array of target slugs.
 */
export function extractWikilinkSlugs(body: string): string[] {
  const slugs = new Set<string>();
  let match;
  while ((match = WIKILINK_RE.exec(body)) !== null) {
    slugs.add(slugify(match[1].trim()));
  }
  return [...slugs];
}

/**
 * Parse a single markdown file into an ExportPage.
 * Returns null when the page is orphaned or missing a title.
 */
async function parsePageFile(
  filePath: string,
  slug: string,
  kind: PageKind,
): Promise<ExportPage | null> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch {
    return null;
  }

  const { meta, body } = parseFrontmatter(raw);

  if (!meta.title || typeof meta.title !== "string") return null;
  if (meta.orphaned === true) return null;

  return {
    title: meta.title,
    slug,
    kind,
    summary: typeof meta.summary === "string" ? meta.summary : "",
    sources: Array.isArray(meta.sources)
      ? (meta.sources as unknown[]).filter((s): s is string => typeof s === "string")
      : [],
    tags: Array.isArray(meta.tags)
      ? (meta.tags as unknown[]).filter((t): t is string => typeof t === "string")
      : [],
    createdAt: typeof meta.createdAt === "string" ? meta.createdAt : new Date().toISOString(),
    updatedAt: typeof meta.updatedAt === "string" ? meta.updatedAt : new Date().toISOString(),
    links: extractWikilinkSlugs(body),
    body,
  };
}

/**
 * Collect all valid ExportPage entries from a single wiki directory.
 * @param dirPath - Absolute path to a wiki page directory.
 * @param kind - The kind of pages in this directory.
 */
async function collectFromDir(dirPath: string, kind: PageKind): Promise<ExportPage[]> {
  let files: string[];
  try {
    files = await readdir(dirPath);
  } catch {
    return [];
  }

  const pages: ExportPage[] = [];
  for (const file of files.filter((f) => f.endsWith(".md"))) {
    const slug = file.replace(/\.md$/, "");
    const page = await parsePageFile(path.join(dirPath, file), slug, kind);
    if (page) pages.push(page);
  }
  return pages;
}

/**
 * Collect all exportable wiki pages from wiki/concepts/ and wiki/queries/.
 * @param root - Absolute path to the project root.
 * @returns Sorted array of ExportPage objects.
 */
export async function collectExportPages(root: string): Promise<ExportPage[]> {
  const conceptsPath = path.join(root, CONCEPTS_DIR);
  const queriesPath = path.join(root, QUERIES_DIR);

  const [concepts, queries] = await Promise.all([
    collectFromDir(conceptsPath, "concepts"),
    collectFromDir(queriesPath, "queries"),
  ]);

  const all = [...concepts, ...queries];
  all.sort((a, b) => a.title.localeCompare(b.title));
  return all;
}
