/**
 * Commander action for `llmwiki ingest <source>`.
 * Detects whether the source is a URL or local file, delegates to the
 * appropriate ingestion module, and saves the result as a markdown file
 * with YAML frontmatter in the sources/ directory.
 */

import path from "path";
import { mkdir, writeFile } from "fs/promises";
import { slugify, buildFrontmatter } from "../utils/markdown.js";
import { MAX_SOURCE_CHARS, MIN_SOURCE_CHARS, SOURCES_DIR } from "../utils/constants.js";
import * as output from "../utils/output.js";
import ingestWeb from "../ingest/web.js";
import ingestFile from "../ingest/file.js";
import type { IngestResult } from "../utils/types.js";

/** Check whether a source string looks like a URL. */
function isUrl(source: string): boolean {
  return source.startsWith("http://") || source.startsWith("https://");
}

/** Truncate result including whether truncation occurred and original length. */
interface TruncateResult {
  content: string;
  truncated: boolean;
  originalChars: number;
}

/** Truncate content if it exceeds the character limit, logging a warning. */
export function enforceCharLimit(content: string): TruncateResult {
  if (content.length <= MAX_SOURCE_CHARS) {
    return { content, truncated: false, originalChars: content.length };
  }

  output.status(
    "!",
    output.warn(
      `Content truncated from ${content.length.toLocaleString()} to ${MAX_SOURCE_CHARS.toLocaleString()} characters.`
    )
  );
  return {
    content: content.slice(0, MAX_SOURCE_CHARS),
    truncated: true,
    originalChars: content.length,
  };
}

/** Reject empty content and warn when content is trivially short. */
function enforceMinContent(content: string): void {
  const length = content.trim().length;

  if (length === 0) {
    throw new Error(
      "No readable content could be extracted from the source."
    );
  }

  if (length < MIN_SOURCE_CHARS) {
    output.status(
      "!",
      output.warn(
        `Content seems very short (${length} chars, minimum recommended is ${MIN_SOURCE_CHARS}).`
      )
    );
  }
}

/** Build the full markdown document with frontmatter. */
export function buildDocument(
  title: string,
  source: string,
  result: TruncateResult,
): string {
  const meta: Record<string, unknown> = {
    title,
    source,
    ingestedAt: new Date().toISOString(),
  };
  if (result.truncated) {
    meta.truncated = true;
    meta.originalChars = result.originalChars;
  }
  const frontmatter = buildFrontmatter(meta);

  return `${frontmatter}\n\n${result.content}\n`;
}

/** Write the ingested document to the sources/ directory. */
async function saveSource(title: string, document: string): Promise<string> {
  const filename = `${slugify(title)}.md`;
  const destPath = path.join(SOURCES_DIR, filename);

  await mkdir(SOURCES_DIR, { recursive: true });
  await writeFile(destPath, document, "utf-8");

  return destPath;
}

/**
 * Programmatic ingest entry point. Identical fetch + write logic to the CLI
 * command but returns a structured IngestResult instead of writing to stdout.
 * Used by the MCP server's ingest_source tool.
 *
 * @param source - A URL (http/https) or a local file path (.md or .txt).
 * @returns Saved filename, character count, truncation flag, and source URI.
 */
export async function ingestSource(source: string): Promise<IngestResult> {
  output.status("*", output.info(`Ingesting: ${source}`));

  const { title, content } = isUrl(source)
    ? await ingestWeb(source)
    : await ingestFile(source);

  const result = enforceCharLimit(content);
  enforceMinContent(result.content);
  const document = buildDocument(title, source, result);
  const savedPath = await saveSource(title, document);

  return {
    filename: path.basename(savedPath),
    charCount: result.content.length,
    truncated: result.truncated,
    source,
  };
}

/**
 * Ingest a source (URL or local file) and save it to the sources/ directory.
 * @param source - A URL (http/https) or a local file path (.md or .txt).
 */
export default async function ingest(source: string): Promise<void> {
  const result = await ingestSource(source);
  const savedPath = path.join(SOURCES_DIR, result.filename);

  output.status(
    "+",
    output.success(`Saved ${output.bold(result.filename)} → ${output.source(savedPath)}`)
  );
  output.status("→", output.dim("Next: llmwiki compile"));
}
