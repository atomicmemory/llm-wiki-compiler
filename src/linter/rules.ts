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
import { parseFrontmatter, parseProvenanceMetadata, slugify } from "../utils/markdown.js";
import {
  CONCEPTS_DIR,
  LOW_CONFIDENCE_THRESHOLD,
  MAX_INFERRED_PARAGRAPHS_WITHOUT_CITATIONS,
  QUERIES_DIR,
  SOURCES_DIR,
} from "../utils/constants.js";
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

/**
 * Flag pages whose frontmatter declares confidence below the threshold.
 * Pages without a confidence field are silently skipped to preserve
 * backward-compatibility with pre-existing wikis.
 */
export async function checkLowConfidencePages(root: string): Promise<LintResult[]> {
  const pages = await collectAllPages(root);
  const results: LintResult[] = [];

  for (const page of pages) {
    const { meta } = parseFrontmatter(page.content);
    const { confidence } = parseProvenanceMetadata(meta);
    if (confidence === undefined || confidence >= LOW_CONFIDENCE_THRESHOLD) continue;
    results.push({
      rule: "low-confidence",
      severity: "warning",
      file: page.filePath,
      message: `Page confidence ${confidence.toFixed(2)} is below ${LOW_CONFIDENCE_THRESHOLD}`,
    });
  }

  return results;
}

/** Flag pages whose frontmatter records contradictions with other pages. */
export async function checkContradictedPages(root: string): Promise<LintResult[]> {
  const pages = await collectAllPages(root);
  const results: LintResult[] = [];

  for (const page of pages) {
    const { meta } = parseFrontmatter(page.content);
    const { contradictedBy } = parseProvenanceMetadata(meta);
    if (!contradictedBy || contradictedBy.length === 0) continue;
    const slugs = contradictedBy.map((r) => r.slug).join(", ");
    results.push({
      rule: "contradicted-page",
      severity: "warning",
      file: page.filePath,
      message: `Page contradicts: ${slugs}`,
    });
  }

  return results;
}

/**
 * Flag pages with too many inferred paragraphs unsupported by direct citations.
 * Uses the metadata-reported count when present and falls back to counting
 * uncited prose paragraphs in the body.
 */
export async function checkInferredWithoutCitations(root: string): Promise<LintResult[]> {
  const pages = await collectAllPages(root);
  const results: LintResult[] = [];

  for (const page of pages) {
    const { meta, body } = parseFrontmatter(page.content);
    const provenance = parseProvenanceMetadata(meta);
    const inferred = provenance.inferredParagraphs ?? countUncitedProseParagraphs(body);
    if (inferred <= MAX_INFERRED_PARAGRAPHS_WITHOUT_CITATIONS) continue;
    results.push({
      rule: "excess-inferred-paragraphs",
      severity: "warning",
      file: page.filePath,
      message: `Page has ${inferred} inferred paragraphs without citations (max ${MAX_INFERRED_PARAGRAPHS_WITHOUT_CITATIONS})`,
    });
  }

  return results;
}

/** Match a paragraph that looks like prose (not a heading, list, or code block). */
const PROSE_PARAGRAPH_LEAD = /^[A-Za-z]/;

/** Count prose paragraphs in a body that lack a ^[citation] marker. */
function countUncitedProseParagraphs(body: string): number {
  const paragraphs = body.split(/\n\s*\n/);
  let count = 0;
  for (const block of paragraphs) {
    const trimmed = block.trim();
    if (trimmed.length === 0) continue;
    if (!PROSE_PARAGRAPH_LEAD.test(trimmed)) continue;
    if (CITATION_PATTERN.test(trimmed)) {
      CITATION_PATTERN.lastIndex = 0;
      continue;
    }
    CITATION_PATTERN.lastIndex = 0;
    count += 1;
  }
  return count;
}

/**
 * Expand a captured citation string into individual source filenames.
 * A multi-source citation like "a.md, b.md" is split on commas so each
 * filename can be checked independently. Single-source citations are
 * returned as a one-element array unchanged.
 */
function splitCitationFilenames(captured: string): string[] {
  return captured.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
}

/** Find ^[filename.md] citations referencing source files that don't exist.
 * Handles both single-source ^[file.md] and multi-source ^[a.md, b.md] forms.
 * Each filename in a multi-source citation is checked independently — only the
 * missing ones are reported, not the entire captured text as one filename.
 */
export async function checkBrokenCitations(root: string): Promise<LintResult[]> {
  const pages = await collectAllPages(root);
  const sourcesDir = path.join(root, SOURCES_DIR);
  const results: LintResult[] = [];

  for (const page of pages) {
    for (const { captured, line } of findMatchesInContent(page.content, CITATION_PATTERN)) {
      for (const filename of splitCitationFilenames(captured)) {
        const citedPath = path.join(sourcesDir, filename);
        if (!existsSync(citedPath)) {
          results.push({
            rule: "broken-citation",
            severity: "error",
            file: page.filePath,
            message: `Broken citation ^[${filename}] — source file not found`,
            line,
          });
        }
      }
    }
  }

  return results;
}
