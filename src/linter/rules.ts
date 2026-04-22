/**
 * Lint rules for wiki quality checks.
 *
 * Each rule is a function that takes a project root path and returns
 * an array of LintResult diagnostics. Rules perform pure static analysis
 * with no LLM calls — they inspect frontmatter, wikilinks, citations,
 * and file structure to find potential issues.
 */

import { readdir, readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import {
  isMalformedCitationEntry,
  parseFrontmatter,
  slugify,
} from "../utils/markdown.js";
import { CONCEPTS_DIR, QUERIES_DIR, SOURCES_DIR } from "../utils/constants.js";
import type { LintResult } from "./types.js";

/** Minimum body length (in characters) for a page to be considered non-empty. */
const MIN_BODY_LENGTH = 50;

/** Pattern matching [[Wikilink Title]] references in markdown content. */
const WIKILINK_PATTERN = /\[\[([^\]]+)\]\]/g;

/** Pattern matching ^[filename.md] citation markers in markdown content. */
const CITATION_PATTERN = /\^\[([^\]]+)\]/g;

/** Match result with its line number and captured group. */
interface LineMatch {
  captured: string;
  line: number;
}

/**
 * Scan all lines of a page's content and return regex matches with line numbers.
 * Shared by rules that need to locate patterns within page bodies.
 */
function findMatchesInContent(content: string, pattern: RegExp): LineMatch[] {
  const results: LineMatch[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const matches = lines[i].matchAll(pattern);
    for (const match of matches) {
      results.push({ captured: match[1], line: i + 1 });
    }
  }
  return results;
}

/**
 * Read all .md files from a directory, returning their paths and parsed content.
 * Returns an empty array if the directory does not exist.
 */
async function readMarkdownFiles(
  dirPath: string,
): Promise<Array<{ filePath: string; content: string }>> {
  if (!existsSync(dirPath)) return [];

  const entries = await readdir(dirPath);
  const mdFiles = entries.filter((f) => f.endsWith(".md"));

  const results = await Promise.all(
    mdFiles.map(async (fileName) => {
      const filePath = path.join(dirPath, fileName);
      const content = await readFile(filePath, "utf-8");
      return { filePath, content };
    }),
  );

  return results;
}

/**
 * Collect all wiki pages from both concepts/ and queries/ directories.
 */
async function collectAllPages(
  root: string,
): Promise<Array<{ filePath: string; content: string }>> {
  const conceptPages = await readMarkdownFiles(path.join(root, CONCEPTS_DIR));
  const queryPages = await readMarkdownFiles(path.join(root, QUERIES_DIR));
  return [...conceptPages, ...queryPages];
}

/**
 * Build a set of slugs for all existing wiki pages.
 * Used to verify that wikilink targets actually exist.
 */
function buildPageSlugSet(
  pages: Array<{ filePath: string }>,
): Set<string> {
  const slugs = new Set<string>();
  for (const page of pages) {
    const baseName = path.basename(page.filePath, ".md");
    slugs.add(baseName.toLowerCase());
  }
  return slugs;
}

/** Find [[Title]] wikilinks that don't match any existing wiki page. */
export async function checkBrokenWikilinks(root: string): Promise<LintResult[]> {
  const pages = await collectAllPages(root);
  const existingSlugs = buildPageSlugSet(pages);
  const results: LintResult[] = [];

  for (const page of pages) {
    for (const { captured, line } of findMatchesInContent(page.content, WIKILINK_PATTERN)) {
      const linkSlug = slugify(captured);
      if (!existingSlugs.has(linkSlug)) {
        results.push({
          rule: "broken-wikilink",
          severity: "error",
          file: page.filePath,
          message: `Broken wikilink [[${captured}]] — no matching page found`,
          line,
        });
      }
    }
  }

  return results;
}

/** Find pages with `orphaned: true` in their frontmatter. */
export async function checkOrphanedPages(root: string): Promise<LintResult[]> {
  const pages = await collectAllPages(root);
  const results: LintResult[] = [];

  for (const page of pages) {
    const { meta } = parseFrontmatter(page.content);
    if (meta.orphaned === true) {
      results.push({
        rule: "orphaned-page",
        severity: "warning",
        file: page.filePath,
        message: `Page is marked as orphaned`,
      });
    }
  }

  return results;
}

/** Find pages with empty or missing `summary` in frontmatter. */
export async function checkMissingSummaries(root: string): Promise<LintResult[]> {
  const pages = await collectAllPages(root);
  const results: LintResult[] = [];

  for (const page of pages) {
    const { meta } = parseFrontmatter(page.content);
    const summary = meta.summary;
    const isMissing = !summary || (typeof summary === "string" && summary.trim() === "");

    if (isMissing) {
      results.push({
        rule: "missing-summary",
        severity: "warning",
        file: page.filePath,
        message: `Page has no summary in frontmatter`,
      });
    }
  }

  return results;
}

/** Find multiple pages whose titles match case-insensitively. */
export async function checkDuplicateConcepts(root: string): Promise<LintResult[]> {
  const pages = await collectAllPages(root);
  const titleMap = new Map<string, string[]>();

  for (const page of pages) {
    const { meta } = parseFrontmatter(page.content);
    const title = typeof meta.title === "string" ? meta.title : "";
    if (!title) continue;

    const normalizedTitle = title.toLowerCase().trim();
    const existing = titleMap.get(normalizedTitle) ?? [];
    existing.push(page.filePath);
    titleMap.set(normalizedTitle, existing);
  }

  const results: LintResult[] = [];
  for (const [title, files] of titleMap) {
    if (files.length <= 1) continue;
    for (const file of files) {
      results.push({
        rule: "duplicate-concept",
        severity: "error",
        file,
        message: `Duplicate title "${title}" — also in ${files.filter((f) => f !== file).join(", ")}`,
      });
    }
  }

  return results;
}

/** Find pages with frontmatter but very short or empty body content. */
export async function checkEmptyPages(root: string): Promise<LintResult[]> {
  const pages = await collectAllPages(root);
  const results: LintResult[] = [];

  for (const page of pages) {
    const { meta, body } = parseFrontmatter(page.content);
    const hasTitle = typeof meta.title === "string" && meta.title.trim() !== "";
    const isBodyEmpty = body.trim().length < MIN_BODY_LENGTH;

    if (hasTitle && isBodyEmpty) {
      results.push({
        rule: "empty-page",
        severity: "warning",
        file: page.filePath,
        message: `Page body is empty or too short (< ${MIN_BODY_LENGTH} chars)`,
      });
    }
  }

  return results;
}

/** Strip an optional `:start-end` or `#Lstart-Lend` span suffix from a citation entry. */
function stripSpanSuffix(entry: string): string {
  const colonIdx = entry.indexOf(":");
  const hashIdx = entry.indexOf("#");
  const cuts = [colonIdx, hashIdx].filter((i) => i >= 0);
  if (cuts.length === 0) return entry;
  return entry.slice(0, Math.min(...cuts));
}

/**
 * Find ^[filename.md] citations referencing source files that don't exist.
 * Accepts both paragraph form and the claim-level extension; for the latter,
 * only the filename portion is checked against the sources directory because
 * line ranges have no on-disk representation to validate.
 */
export async function checkBrokenCitations(root: string): Promise<LintResult[]> {
  const pages = await collectAllPages(root);
  const sourcesDir = path.join(root, SOURCES_DIR);
  const results: LintResult[] = [];

  for (const page of pages) {
    for (const { captured, line } of findMatchesInContent(page.content, CITATION_PATTERN)) {
      collectBrokenForMarker(captured, line, page.filePath, sourcesDir, results);
    }
  }

  return results;
}

/** Append broken-citation diagnostics for every entry inside a single ^[...] marker. */
function collectBrokenForMarker(
  captured: string,
  line: number,
  pageFile: string,
  sourcesDir: string,
  out: LintResult[],
): void {
  for (const part of captured.split(",")) {
    const trimmed = part.trim();
    if (trimmed.length === 0) continue;
    const filename = stripSpanSuffix(trimmed);
    const citedPath = path.join(sourcesDir, filename);
    if (existsSync(citedPath)) continue;
    out.push({
      rule: "broken-citation",
      severity: "error",
      file: pageFile,
      message: `Broken citation ^[${captured}] — source file not found`,
      line,
    });
  }
}

/**
 * Find ^[...] markers whose entries do not parse against the documented
 * paragraph or claim-level grammar (e.g. `^[file.md:abc]` or `^[file.md#X]`).
 * Detects malformed claim-level citations without breaking the paragraph form.
 */
export async function checkMalformedClaimCitations(root: string): Promise<LintResult[]> {
  const pages = await collectAllPages(root);
  const results: LintResult[] = [];

  for (const page of pages) {
    for (const { captured, line } of findMatchesInContent(page.content, CITATION_PATTERN)) {
      for (const part of captured.split(",")) {
        if (!isMalformedCitationEntry(part)) continue;
        results.push({
          rule: "malformed-claim-citation",
          severity: "error",
          file: page.filePath,
          message: `Malformed claim citation ^[${captured}] — expected file.md, file.md:N-N, or file.md#LN-LN`,
          line,
        });
      }
    }
  }

  return results;
}
