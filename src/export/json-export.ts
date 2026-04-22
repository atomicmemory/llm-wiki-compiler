/**
 * JSON export format writer.
 *
 * Produces a structured JSON document containing all wiki pages and their
 * metadata. The schema is intentionally simple and human-readable so it can
 * be consumed directly by scripts, agents, or downstream pipelines without
 * additional transformation.
 *
 * Schema:
 *   { exportedAt, pageCount, pages: ExportPage[] }
 */

import type { ExportPage } from "./types.js";

/** Top-level shape of the JSON export file. */
interface JsonExportDocument {
  exportedAt: string;
  pageCount: number;
  pages: ExportPage[];
}

/**
 * Build the JSON export document from a list of export pages.
 * @param pages - Sorted array of export pages.
 * @returns Pretty-printed JSON string.
 */
export function buildJsonExport(pages: ExportPage[]): string {
  const doc: JsonExportDocument = {
    exportedAt: new Date().toISOString(),
    pageCount: pages.length,
    pages,
  };
  return JSON.stringify(doc, null, 2);
}
