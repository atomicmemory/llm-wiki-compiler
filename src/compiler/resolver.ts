/**
 * Interlink resolution for wiki pages.
 *
 * Rule-based (not LLM-based) pass that scans wiki pages for concept title
 * mentions and wraps them in [[slug|Title]] wikilinks. The piped alias form
 * keeps Obsidian link resolution stable when a page's filename (slug) differs
 * from its display title.
 *
 * Complexity: O(changed * total) per incremental compile.
 * Full recompile degrades to O(total^2).
 */

import { readdir, readFile } from "fs/promises";
import path from "path";
import { existsSync } from "fs";
import { atomicWrite, parseFrontmatter } from "../utils/markdown.js";
import { CONCEPTS_DIR } from "../utils/constants.js";
import * as output from "../utils/output.js";

interface PageInfo {
  slug: string;
  title: string;
  filePath: string;
}

/** Build an index of all wiki page titles from the concepts directory. */
async function buildTitleIndex(root: string): Promise<PageInfo[]> {
  const conceptsDir = path.join(root, CONCEPTS_DIR);
  if (!existsSync(conceptsDir)) return [];

  const files = await readdir(conceptsDir);
  const pages: PageInfo[] = [];

  for (const file of files) {
    if (!file.endsWith(".md")) continue;

    const filePath = path.join(conceptsDir, file);
    const content = await readFile(filePath, "utf-8");
    const { meta } = parseFrontmatter(content);

    if (meta.title && typeof meta.title === "string" && !meta.orphaned) {
      pages.push({
        slug: file.replace(/\.md$/, ""),
        title: meta.title,
        filePath,
      });
    }
  }

  return pages;
}

/** Check if a position is inside an existing [[wikilink]]. */
function isInsideWikilink(text: string, position: number): boolean {
  const before = text.lastIndexOf("[[", position);
  const after = text.indexOf("]]", position);
  if (before === -1 || after === -1) return false;

  const closeBefore = text.indexOf("]]", before);
  return closeBefore >= position;
}

/** Check if a position is inside a ^[...] citation marker. */
function isInsideCitation(text: string, position: number): boolean {
  const before = text.lastIndexOf("^[", position);
  const after = text.indexOf("]", position);
  if (before === -1 || after === -1) return false;

  const closeBefore = text.indexOf("]", before);
  return closeBefore >= position;
}

/** Check if a match is at a word boundary. */
function isWordBoundary(text: string, start: number, end: number): boolean {
  const before = start === 0 || /[\s,.:;!?()\[\]{}/"']/.test(text[start - 1]);
  const after = end >= text.length || /[\s,.:;!?()\[\]{}/"']/.test(text[end]);
  return before && after;
}

/** Find all regex matches for a title in the text, returned as position spans. */
function findTitleMatches(text: string, title: string): { start: number; end: number }[] {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(escaped, "gi");
  const matches: { start: number; end: number }[] = [];
  let match;

  while ((match = regex.exec(text)) !== null) {
    matches.push({ start: match.index, end: match.index + match[0].length });
  }

  return matches;
}

/** Determine whether a match position is eligible for wikilink insertion. */
function isLinkablePosition(text: string, start: number, end: number): boolean {
  if (isInsideWikilink(text, start)) return false;
  if (isInsideCitation(text, start)) return false;
  return isWordBoundary(text, start, end);
}

/**
 * Add [[wikilinks]] to a page's body for any title mentions.
 * Skips already-linked text and non-word-boundary matches.
 */
function addWikilinks(body: string, titles: PageInfo[], selfTitle: string): string {
  let result = body;
  const selfLower = selfTitle.toLowerCase();

  for (const page of titles) {
    if (page.title.toLowerCase() === selfLower) continue;

    const matches = findTitleMatches(result, page.title);

    // Process matches in reverse to preserve positions
    for (const m of matches.reverse()) {
      if (!isLinkablePosition(result, m.start, m.end)) continue;
      result = result.slice(0, m.start) + `[[${page.slug}|${page.title}]]` + result.slice(m.end);
    }
  }

  return result;
}

/**
 * Run interlink resolution on changed and affected pages.
 *
 * Two passes:
 * 1. Outbound: changed pages get [[wikilinks]] for any title they mention.
 * 2. Inbound: ALL pages get scanned for mentions of newly created titles.
 *    This ensures existing pages link to new concepts without a full recompile.
 *
 * Complexity: O(changed * total) for outbound, O(newTitles * total) for inbound.
 */
export async function resolveLinks(
  root: string,
  changedSlugs: string[],
  newSlugs: string[],
): Promise<number> {
  const titleIndex = await buildTitleIndex(root);
  if (titleIndex.length === 0) return 0;

  let linkCount = 0;

  // Pass 1: outbound links on changed pages
  linkCount += await resolveOutboundLinks(titleIndex, changedSlugs);

  // Pass 2: inbound links on all pages for new titles
  linkCount += await resolveInboundLinks(titleIndex, newSlugs);

  if (linkCount > 0) {
    output.status("🔗", output.dim(`Resolved links in ${linkCount} page(s)`));
  }

  return linkCount;
}

/** Add outbound [[wikilinks]] to changed pages for any title they mention. */
async function resolveOutboundLinks(
  titleIndex: PageInfo[],
  changedSlugs: string[],
): Promise<number> {
  let count = 0;

  for (const page of titleIndex) {
    if (!changedSlugs.includes(page.slug)) continue;
    const didLink = await linkPage(page, titleIndex);
    if (didLink) count++;
  }

  return count;
}

/** Scan ALL pages for mentions of newly created concept titles. */
async function resolveInboundLinks(
  titleIndex: PageInfo[],
  newSlugs: string[],
): Promise<number> {
  if (newSlugs.length === 0) return 0;

  const newTitles = titleIndex.filter((p) => newSlugs.includes(p.slug));
  if (newTitles.length === 0) return 0;

  let count = 0;

  for (const page of titleIndex) {
    // Skip pages that were already processed in outbound pass
    if (newSlugs.includes(page.slug)) continue;

    const content = await readFile(page.filePath, "utf-8");
    const { body } = parseFrontmatter(content);
    const linked = addWikilinks(body, newTitles, page.title);

    if (linked !== body) {
      const newContent = content.replace(body, linked);
      await atomicWrite(page.filePath, newContent);
      count++;
    }
  }

  return count;
}

/** Add wikilinks to a single page, writing atomically if changed. */
async function linkPage(page: PageInfo, titleIndex: PageInfo[]): Promise<boolean> {
  const content = await readFile(page.filePath, "utf-8");
  const { body } = parseFrontmatter(content);
  const linked = addWikilinks(body, titleIndex, page.title);

  if (linked === body) return false;

  const newContent = content.replace(body, linked);
  await atomicWrite(page.filePath, newContent);
  return true;
}
