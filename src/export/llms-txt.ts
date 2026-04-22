/**
 * llms.txt export format writer.
 *
 * Produces a concise machine-readable index per the llmstxt.org spec:
 *   - H1 title
 *   - Optional block quote description
 *   - Bullet-list of page entries: title, summary, relative link
 *
 * The companion llms-full.txt format appends the full body of every page
 * so a model can read the entire wiki in one file.
 */

import type { ExportPage } from "./types.js";

/**
 * Build the concise llms.txt index content.
 * @param pages - Sorted array of export pages.
 * @param projectTitle - Human-readable wiki title shown as the H1.
 * @returns Full llms.txt string.
 */
export function buildLlmsTxt(pages: ExportPage[], projectTitle: string): string {
  const lines: string[] = [
    `# ${projectTitle}`,
    "",
    `> ${pages.length} pages — exported ${new Date().toISOString()}`,
    "",
  ];

  for (const page of pages) {
    const summaryClause = page.summary ? ` — ${page.summary}` : "";
    lines.push(`- [${page.title}](wiki/concepts/${page.slug}.md)${summaryClause}`);
  }

  lines.push("");
  return lines.join("\n");
}

/**
 * Build the full llms-full.txt content (index + full page bodies).
 * Each page is separated by a horizontal rule and includes its metadata block.
 * @param pages - Sorted array of export pages.
 * @param projectTitle - Human-readable wiki title shown as the H1.
 * @returns Full llms-full.txt string.
 */
export function buildLlmsFullTxt(pages: ExportPage[], projectTitle: string): string {
  const sections: string[] = [buildLlmsTxt(pages, projectTitle)];

  for (const page of pages) {
    const tags = page.tags.length > 0 ? `\nTags: ${page.tags.join(", ")}` : "";
    const sources = page.sources.length > 0 ? `\nSources: ${page.sources.join(", ")}` : "";
    const header = [
      "---",
      `## ${page.title}`,
      `> ${page.summary}${tags}${sources}`,
      "",
    ].join("\n");
    sections.push(`${header}\n${page.body.trim()}\n`);
  }

  return sections.join("\n");
}
