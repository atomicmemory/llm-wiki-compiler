/**
 * Local file ingestion module.
 * Reads .md and .txt files from the local filesystem and returns their
 * content as markdown. Markdown files are returned as-is; plain text files
 * are wrapped in a markdown code block. All other extensions are rejected.
 */

import { readFile } from "fs/promises";
import path from "path";
import { titleFromFilename, type IngestedSource } from "./shared.js";

/** Plain-text file extensions handled directly by this module. */
const SUPPORTED_EXTENSIONS = new Set([".md", ".txt"]);

/** Wrap plain text content in a markdown fenced block. */
function wrapPlainText(text: string): string {
  return `\`\`\`\n${text}\n\`\`\``;
}

/**
 * Ingest a local file and return its content as markdown.
 * @param filePath - Absolute or relative path to a .md or .txt file.
 * @returns An object with a title derived from the filename and the markdown content.
 * @throws On unsupported file type or read failure.
 */
export default async function ingestFile(filePath: string): Promise<IngestedSource> {
  const ext = path.extname(filePath).toLowerCase();

  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    throw new Error(
      `Unsupported file type "${ext}". Only .md and .txt files are supported.`
    );
  }

  const raw = await readFile(filePath, "utf-8");
  const title = titleFromFilename(filePath);
  const content = ext === ".md" ? raw : wrapPlainText(raw);

  return { title, content };
}
