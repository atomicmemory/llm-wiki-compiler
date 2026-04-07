/**
 * Compilation orchestrator for the llmwiki knowledge compiler.
 *
 * Coordinates the full pipeline: lock acquisition, change detection,
 * concept extraction via LLM, wiki page generation with streaming output,
 * orphan marking for deleted sources, interlink resolution, and index
 * generation. Supports incremental compilation — only new or changed
 * sources are processed through the LLM pipeline.
 */

import { readFile, readdir } from "fs/promises";
import path from "path";
import { readState, updateSourceState } from "../utils/state.js";
import {
  atomicWrite,
  safeReadFile,
  validateWikiPage,
  slugify,
  buildFrontmatter,
  parseFrontmatter,
} from "../utils/markdown.js";
import { callClaude } from "../utils/llm.js";
import { acquireLock, releaseLock } from "../utils/lock.js";
import {
  CONCEPT_EXTRACTION_TOOL,
  buildExtractionPrompt,
  buildPagePrompt,
  parseConcepts,
} from "./prompts.js";
import { detectChanges, hashFile } from "./hasher.js";
import {
  findAffectedSources,
  findFrozenSlugs,
  findLateAffectedSources,
  freezeFailedExtractions,
  persistFrozenSlugs,
  type ExtractionResult,
} from "./deps.js";
import { markOrphaned, orphanUnownedFrozenPages } from "./orphan.js";
import { resolveLinks } from "./resolver.js";
import { generateIndex } from "./indexgen.js";
import { addObsidianMeta, generateMOC } from "./obsidian.js";
import * as output from "../utils/output.js";
import {
  COMPILE_CONCURRENCY,
  CONCEPTS_DIR,
  INDEX_FILE,
  SOURCES_DIR,
} from "../utils/constants.js";
import pLimit from "p-limit";
import type { ExtractedConcept, SourceState, SourceChange } from "../utils/types.js";

/**
 * Run the full compilation pipeline with lock protection.
 * Acquires .llmwiki/lock, detects changes, compiles new/changed sources,
 * marks orphaned pages, resolves interlinks, and rebuilds the index.
 * @param root - Project root directory.
 */
export async function compile(root: string): Promise<void> {
  output.header("llmwiki compile");

  const locked = await acquireLock(root);
  if (!locked) {
    output.status("!", output.error("Could not acquire lock. Try again later."));
    return;
  }

  try {
    await runCompilePipeline(root);
  } finally {
    await releaseLock(root);
  }
}

/** Inner pipeline, runs under lock protection. */
async function runCompilePipeline(root: string): Promise<void> {
  const state = await readState(root);
  const changes = await detectChanges(root, state);

  // Semantic dependency tracking: find unchanged sources that share concepts
  // with changed sources and need recompilation to preserve cross-source content
  const affectedFiles = findAffectedSources(state, changes);
  for (const file of affectedFiles) {
    output.status("~", output.info(`${file} [affected by shared concept]`));
    changes.push({ file, status: "changed" });
  }

  const toCompile = changes.filter((c) => c.status === "new" || c.status === "changed");
  const deleted = changes.filter((c) => c.status === "deleted");
  const unchanged = changes.filter((c) => c.status === "unchanged");

  if (toCompile.length === 0 && deleted.length === 0) {
    output.status("✓", output.success("Nothing to compile — all sources up to date."));
    return;
  }

  printChangesSummary(changes);

  // Handle deleted sources: mark their wiki pages as orphaned
  for (const del of deleted) {
    await markOrphaned(root, del.file, state);
  }

  // Frozen slugs: shared concepts that lost a contributor (deleted source).
  const frozenSlugs = findFrozenSlugs(state, changes);
  for (const slug of frozenSlugs) {
    output.status("i", output.dim(`Frozen: ${slug} (shared with deleted source)`));
  }

  // Phase 1: Extract concepts for ALL sources before generating any pages.
  // This eliminates order-dependence: we know which extractions failed
  // before committing any page writes.
  const extractions: ExtractionResult[] = [];
  for (const change of toCompile) {
    extractions.push(await extractForSource(root, change.file));
  }

  // Post-extraction dependency check: new sources may extract concepts
  // that existing unchanged sources already own. findAffectedSources
  // couldn't detect this earlier because new sources had no state entry.
  const lateAffected = findLateAffectedSources(extractions, state, changes);
  for (const file of lateAffected) {
    output.status("~", output.info(`${file} [shares concept with new source]`));
    extractions.push(await extractForSource(root, file));
  }

  // Freeze concepts from failed extractions before page generation.
  await freezeFailedExtractions(root, extractions, frozenSlugs);

  // Phase 2: Merge shared concepts across sources, then generate pages.
  // When multiple sources extract the same concept, combine their content
  // so the LLM sees all contributing material in a single generation call.
  const merged = mergeExtractions(extractions, frozenSlugs);
  const limit = pLimit(COMPILE_CONCURRENCY);
  const pageResults = await Promise.all(
    merged.map((entry) => limit(async () => {
      await generateMergedPage(root, entry);
      return entry;
    })),
  );
  const allChangedSlugs = pageResults.map((e) => e.slug);
  const allNewSlugs = pageResults
    .filter((e) => e.concept.is_new)
    .map((e) => e.slug);

  // Persist state for each successfully extracted source.
  for (const result of extractions) {
    if (result.concepts.length === 0) continue;
    await persistSourceState(root, result.sourcePath, result.sourceFile, result.concepts);
  }

  // Orphan frozen pages that lost all owners after recompilation.
  if (frozenSlugs.size > 0) {
    await orphanUnownedFrozenPages(root, frozenSlugs);
  }

  // Persist frozen slugs: unfreeze any that are now safe to regenerate
  // (all current owners compiled and extracted them), keep the rest.
  await persistFrozenSlugs(root, frozenSlugs, extractions);

  // Interlink resolution: outbound on changed, inbound for new titles
  if (allChangedSlugs.length > 0) {
    output.status("🔗", output.info("Resolving interlinks..."));
    await resolveLinks(root, allChangedSlugs, allNewSlugs);
  }

  await generateIndex(root);
  await generateMOC(root);

  output.header("Compilation complete");
  output.status("✓", output.success(
    `${toCompile.length} compiled, ${unchanged.length} skipped, ${deleted.length} deleted`,
  ));
  if (toCompile.length > 0) {
    output.status("→", output.dim('Next: llmwiki query "your question here"'));
  }
}

/** Print a summary of detected source file changes. */
function printChangesSummary(changes: SourceChange[]): void {
  const iconMap: Record<string, string> = {
    new: "+", changed: "~", unchanged: ".", deleted: "-",
  };
  const fmtMap: Record<string, (s: string) => string> = {
    new: output.success, changed: output.warn, unchanged: output.dim, deleted: output.error,
  };

  for (const c of changes) {
    const icon = iconMap[c.status] ?? "?";
    const fmt = fmtMap[c.status] ?? output.dim;
    output.status(icon, fmt(`${c.file} [${c.status}]`));
  }
}

/**
 * Phase 1: Extract concepts from a source without generating pages.
 * Returns extraction data for the generation phase.
 */
async function extractForSource(
  root: string,
  sourceFile: string,
): Promise<ExtractionResult> {
  output.status("*", output.info(`Extracting: ${sourceFile}`));

  const sourcePath = path.join(root, SOURCES_DIR, sourceFile);
  const sourceContent = await readFile(sourcePath, "utf-8");
  const existingIndex = await safeReadFile(path.join(root, INDEX_FILE));
  const concepts = await extractConcepts(sourceContent, existingIndex);

  if (concepts.length > 0) {
    const names = concepts.map((c) => c.concept).join(", ");
    output.status("*", output.dim(`  Found ${concepts.length} concepts: ${names}`));
  }
  return { sourceFile, sourcePath, sourceContent, concepts };
}

/** A concept with all contributing sources merged for generation. */
interface MergedConcept {
  slug: string;
  concept: ExtractedConcept;
  sourceFiles: string[];
  combinedContent: string;
}

/**
 * Merge extractions so each concept slug maps to ALL contributing sources.
 * When sources A and B both extract concept X, the LLM receives combined
 * content from both sources, producing a single page that reflects all
 * contributing material rather than just the last source processed.
 */
function mergeExtractions(
  extractions: ExtractionResult[],
  frozenSlugs: Set<string>,
): MergedConcept[] {
  const bySlug = new Map<string, MergedConcept>();

  for (const result of extractions) {
    if (result.concepts.length === 0) continue;

    for (const concept of result.concepts) {
      const slug = slugify(concept.concept);
      if (frozenSlugs.has(slug)) continue;

      const existing = bySlug.get(slug);
      if (existing) {
        existing.sourceFiles.push(result.sourceFile);
        existing.combinedContent += `\n\n--- SOURCE: ${result.sourceFile} ---\n\n${result.sourceContent}`;
      } else {
        bySlug.set(slug, {
          slug,
          concept,
          sourceFiles: [result.sourceFile],
          combinedContent: `--- SOURCE: ${result.sourceFile} ---\n\n${result.sourceContent}`,
        });
      }
    }
  }

  return Array.from(bySlug.values());
}

/**
 * Generate a wiki page from merged source content.
 * For shared concepts, the LLM sees content from all contributing sources
 * and frontmatter records every source file.
 */
async function generateMergedPage(
  root: string,
  entry: MergedConcept,
): Promise<void> {
  const pagePath = path.join(root, CONCEPTS_DIR, `${entry.slug}.md`);
  const existingPage = await safeReadFile(pagePath);
  const relatedPages = await loadRelatedPages(root, entry.slug);

  const system = buildPagePrompt(
    entry.concept.concept,
    entry.combinedContent,
    existingPage,
    relatedPages,
  );

  const pageBody = await callClaude({
    system,
    messages: [
      { role: "user", content: `Write the wiki page for "${entry.concept.concept}".` },
    ],
  });

  const now = new Date().toISOString();
  const existing = existingPage ? parseFrontmatter(existingPage) : null;
  const createdAt = (existing?.meta.createdAt && typeof existing.meta.createdAt === "string")
    ? existing.meta.createdAt
    : now;
  const frontmatterFields: Record<string, unknown> = {
    title: entry.concept.concept,
    summary: entry.concept.summary,
    sources: entry.sourceFiles,
    createdAt,
    updatedAt: now,
  };
  addObsidianMeta(frontmatterFields, entry.concept.concept, entry.concept.tags ?? []);
  const frontmatter = buildFrontmatter(frontmatterFields);
  const fullPage = `${frontmatter}\n\n${pageBody}\n`;
  await writePageIfValid(pagePath, fullPage, entry.concept.concept);
}

/**
 * Call Claude to extract concepts from a source document.
 * @param sourceContent - Full source document text.
 * @param existingIndex - Current wiki index for deduplication.
 * @returns Parsed array of extracted concepts.
 */
async function extractConcepts(
  sourceContent: string,
  existingIndex: string,
): Promise<ExtractedConcept[]> {
  const system = buildExtractionPrompt(sourceContent, existingIndex);
  const rawOutput = await callClaude({
    system,
    messages: [{ role: "user", content: "Extract the key concepts from this source." }],
    tools: [CONCEPT_EXTRACTION_TOOL],
  });

  return parseConcepts(rawOutput);
}


/**
 * Load related wiki pages to provide cross-referencing context.
 * Returns concatenated content of up to 5 existing concept pages.
 * @param root - Project root directory.
 * @param excludeSlug - Slug of the current page to exclude.
 * @returns Concatenated related page contents.
 */
async function loadRelatedPages(
  root: string,
  excludeSlug: string,
): Promise<string> {
  const conceptsPath = path.join(root, CONCEPTS_DIR);
  let files: string[];

  try {
    files = await readdir(conceptsPath);
  } catch {
    return "";
  }

  const related = files
    .filter((f) => f.endsWith(".md") && f !== `${excludeSlug}.md`)
    .slice(0, 5);

  const contents: string[] = [];
  for (const f of related) {
    const content = await safeReadFile(path.join(conceptsPath, f));
    if (!content) continue;
    const { meta } = parseFrontmatter(content);
    if (meta.orphaned) continue;
    contents.push(content);
  }

  return contents.join("\n\n---\n\n");
}

/**
 * Validate and atomically write a wiki page, logging the result.
 * @param pagePath - Absolute path to write the page.
 * @param content - Full page content including frontmatter.
 * @param conceptTitle - Title for logging purposes.
 */
async function writePageIfValid(
  pagePath: string,
  content: string,
  conceptTitle: string,
): Promise<void> {
  if (!validateWikiPage(content)) {
    output.status("!", output.warn(`Invalid page for "${conceptTitle}" — skipped.`));
    return;
  }

  await atomicWrite(pagePath, content);
}

/**
 * Update the persisted state for a compiled source file.
 * @param root - Project root directory.
 * @param sourcePath - Absolute path to the source file.
 * @param sourceFile - Filename within sources/.
 * @param concepts - Concepts extracted from this source.
 */
async function persistSourceState(
  root: string,
  sourcePath: string,
  sourceFile: string,
  concepts: ReturnType<typeof parseConcepts>,
): Promise<void> {
  const hash = await hashFile(sourcePath);
  const entry: SourceState = {
    hash,
    concepts: concepts.map((c) => slugify(c.concept)),
    compiledAt: new Date().toISOString(),
  };

  await updateSourceState(root, sourceFile, entry);
}
