/**
 * Commander action for `llmwiki ingest-session <path>`.
 *
 * Accepts a single session export file or a directory of session files.
 * Each file is detected, parsed, and written to `sources/` as a markdown
 * document with YAML frontmatter recording the adapter name and timestamps.
 *
 * Supported formats (auto-detected): Claude, Codex, Cursor.
 */

import path from "path";
import { mkdir, writeFile, readdir, stat } from "fs/promises";
import { slugify, buildFrontmatter } from "../utils/markdown.js";
import { SOURCES_DIR } from "../utils/constants.js";
import * as output from "../utils/output.js";
import { parseSessionFile, formatSessionAsMarkdown } from "../adapters/registry.js";
import type { NormalizedSession } from "../adapters/types.js";

/** Result of ingesting a single session file. */
interface SessionIngestResult {
  filename: string;
  adapter: string;
  title: string;
  source: string;
}

/** Build the YAML frontmatter for a session source. */
function buildSessionFrontmatter(session: NormalizedSession, sourcePath: string): string {
  const meta: Record<string, unknown> = {
    title: session.title,
    source: sourcePath,
    adapter: session.adapter,
    ingestedAt: new Date().toISOString(),
  };
  if (session.startedAt) meta.sessionStartedAt = session.startedAt;
  if (session.endedAt) meta.sessionEndedAt = session.endedAt;
  if (session.participantIdentity) meta.participant = session.participantIdentity;

  return buildFrontmatter(meta);
}

/** Write a session as a markdown file in sources/. Returns the saved path. */
async function saveSessionSource(session: NormalizedSession, sourcePath: string): Promise<string> {
  const frontmatter = buildSessionFrontmatter(session, sourcePath);
  const body = formatSessionAsMarkdown(session);
  const document = `${frontmatter}\n\n${body}\n`;

  const filename = `${slugify(session.title)}.md`;
  const destPath = path.join(SOURCES_DIR, filename);

  await mkdir(SOURCES_DIR, { recursive: true });
  await writeFile(destPath, document, "utf-8");

  return destPath;
}

/**
 * Ingest a single session file.
 * @throws When the file is not recognised or is malformed.
 */
export async function ingestSessionFile(filePath: string): Promise<SessionIngestResult> {
  output.status("*", output.info(`Ingesting session: ${filePath}`));

  const session = await parseSessionFile(filePath);
  const savedPath = await saveSessionSource(session, filePath);

  output.status(
    "+",
    output.success(
      `Saved ${output.bold(path.basename(savedPath))} [${session.adapter}] → ${output.source(savedPath)}`
    )
  );

  return {
    filename: path.basename(savedPath),
    adapter: session.adapter,
    title: session.title,
    source: filePath,
  };
}

/** Collect all files directly inside a directory (non-recursive). */
async function listDirectoryFiles(dirPath: string): Promise<string[]> {
  const entries = await readdir(dirPath);
  const files: string[] = [];

  for (const entry of entries) {
    const full = path.join(dirPath, entry);
    const info = await stat(full);
    if (info.isFile()) files.push(full);
  }

  return files;
}

/**
 * Ingest all session files in a directory.
 * Skips files that no adapter recognises, rather than failing the whole batch.
 */
async function ingestDirectory(dirPath: string): Promise<void> {
  const files = await listDirectoryFiles(dirPath);

  if (files.length === 0) {
    throw new Error(`No files found in directory: ${dirPath}`);
  }

  output.status("*", output.info(`Scanning ${files.length} file(s) in: ${dirPath}`));

  let imported = 0;
  let skipped = 0;

  for (const file of files) {
    try {
      await ingestSessionFile(file);
      imported++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      output.status("!", output.warn(`Skipped ${path.basename(file)}: ${message}`));
      skipped++;
    }
  }

  output.status(
    "→",
    output.dim(`Imported ${imported} session(s), skipped ${skipped}.`)
  );
}

/**
 * Entry point for `llmwiki ingest-session <pathOrDir>`.
 * Dispatches to single-file or directory import based on the target type.
 */
export default async function ingestSession(targetPath: string): Promise<void> {
  const info = await stat(targetPath).catch(() => {
    throw new Error(`Path not found: ${targetPath}`);
  });

  if (info.isDirectory()) {
    await ingestDirectory(targetPath);
  } else {
    await ingestSessionFile(targetPath);
  }

  output.status("→", output.dim("Next: llmwiki compile"));
}
