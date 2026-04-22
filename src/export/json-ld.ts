/**
 * JSON-LD graph export format writer.
 *
 * Produces a JSON-LD document using schema.org vocabulary so the wiki graph
 * can be consumed by linked-data tooling, knowledge graph platforms, or any
 * agent that understands the Schema.org ontology.
 *
 * Each wiki page is represented as a schema:Article node. Links derived from
 * [[wikilinks]] are expressed as schema:mentions relationships between nodes.
 */

import type { ExportPage } from "./types.js";

/** Base URL used for page IRIs when no external URL is configured. */
const LOCAL_BASE = "urn:llmwiki:";

/** Build the IRI for a page slug. */
function pageIri(slug: string): string {
  return `${LOCAL_BASE}${slug}`;
}

/** Serialise one ExportPage as a JSON-LD Article node. */
function pageToJsonLd(page: ExportPage): Record<string, unknown> {
  const node: Record<string, unknown> = {
    "@id": pageIri(page.slug),
    "@type": "Article",
    name: page.title,
    description: page.summary,
    dateCreated: page.createdAt,
    dateModified: page.updatedAt,
  };

  if (page.tags.length > 0) {
    node["keywords"] = page.tags;
  }

  if (page.links.length > 0) {
    node["mentions"] = page.links.map((slug) => ({ "@id": pageIri(slug) }));
  }

  return node;
}

/**
 * Build the JSON-LD graph document from a list of export pages.
 * @param pages - Sorted array of export pages.
 * @returns Pretty-printed JSON-LD string.
 */
export function buildJsonLd(pages: ExportPage[]): string {
  const doc = {
    "@context": "https://schema.org",
    "@graph": pages.map(pageToJsonLd),
  };
  return JSON.stringify(doc, null, 2);
}
