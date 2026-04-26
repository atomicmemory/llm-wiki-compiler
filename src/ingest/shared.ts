/**
 * Shared helpers used by every ingest module.
 *
 * Centralizes the IngestedSource result shape and title-derivation logic so
 * each per-format ingester (file, pdf, image, transcript, web) doesn't
 * reimplement the same primitives.
 */

import path from "path";

/** Common shape returned by every ingest module. */
export interface IngestedSource {
  title: string;
  content: string;
}

/**
 * Derive a human-readable title from a filename.
 *
 * Strips the extension and converts dashes/underscores to spaces so that
 * "quarterly_report.pdf" becomes "quarterly report".
 *
 * @param filePath - Path to a source file.
 * @returns Humanized title (lowercase preserved, no extension).
 */
export function titleFromFilename(filePath: string): string {
  const basename = path.basename(filePath, path.extname(filePath));
  return basename.replace(/[-_]+/g, " ").trim();
}
