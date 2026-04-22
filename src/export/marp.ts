/**
 * Marp slide export format writer.
 *
 * Produces a single Markdown file with Marp frontmatter that can be rendered
 * as a slide deck by the Marp CLI or VS Code Marp extension. Each wiki page
 * becomes one slide showing the title, summary, tags, and an excerpt of the
 * body (first paragraph, up to a readable limit).
 *
 * Reference: https://marp.app/
 */

import type { ExportPage } from "./types.js";

/** Maximum characters of body text to include per slide. */
const SLIDE_BODY_MAX_CHARS = 300;

/** Extract the first prose paragraph from a markdown body. */
function extractFirstParagraph(body: string): string {
  const trimmed = body.trim();
  // Take the first non-empty block separated by a blank line.
  const firstBlock = trimmed.split(/\n\s*\n/)[0] ?? "";
  // Strip markdown headings and list markers so slides read cleanly.
  const stripped = firstBlock
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .trim();
  if (stripped.length <= SLIDE_BODY_MAX_CHARS) return stripped;
  return `${stripped.slice(0, SLIDE_BODY_MAX_CHARS)}…`;
}

/** Render one ExportPage as a Marp slide. */
function pageToSlide(page: ExportPage): string {
  const tagLine = page.tags.length > 0 ? `\n_Tags: ${page.tags.join(", ")}_` : "";
  const excerpt = extractFirstParagraph(page.body);
  return [
    `## ${page.title}`,
    "",
    `> ${page.summary}${tagLine}`,
    "",
    excerpt,
  ].join("\n");
}

/**
 * Build the Marp slide deck content from a list of export pages.
 * @param pages - Array of export pages to include (caller may pre-filter).
 * @param projectTitle - Shown on the title slide.
 * @returns Full Marp markdown string.
 */
export function buildMarp(pages: ExportPage[], projectTitle: string): string {
  const frontmatter = [
    "---",
    "marp: true",
    "theme: default",
    "paginate: true",
    `title: "${projectTitle}"`,
    "---",
  ].join("\n");

  const titleSlide = [
    "",
    `# ${projectTitle}`,
    "",
    `${pages.length} pages | ${new Date().toISOString()}`,
  ].join("\n");

  const slides = pages.map((p) => `---\n\n${pageToSlide(p)}`);

  return [frontmatter, titleSlide, ...slides, ""].join("\n\n");
}
