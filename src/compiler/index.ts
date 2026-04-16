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
import { updateEmbeddings } from "../utils/embeddings.js";
import * as output from "../utils/output.js";
import {
  COMPILE_CONCURRENCY,
  CONCEPTS_DIR,
  INDEX_FILE,
  SOURCES_DIR,
} from "../utils/constants.js";
import pLimit from "p-limit";
import type {
  CompileResult,
  ExtractedConcept,
  SourceChange,
  SourceState,
  WikiState,
} from "../utils/types.js";

/** Empty CompileResult used when no pipeline work runs (e.g. lock contention). */
function emptyCompileResult(): CompileResult {
  return { compiled: 0, skipped: 0, deleted: 0, concepts: [], pages: [], errors: [] };
}

/**
 * Run the full compilation pipeline with lock protection.
 * Acquires .llmwiki/lock, detects changes, compiles new/changed sources,
 * marks orphaned pages, resolves interlinks, and rebuilds the index.
 * @param root - Project root directory.
 */
export async function compile(root: string): Promise<void> {
  await compileAndReport(root);
}

/**
 * Run the full compilation pipeline and return a structured result.
 * Same behaviour as compile() but exposes counts, slugs, and errors so
 * non-CLI consumers (the MCP server, programmatic callers) can report
 * meaningful data without scraping terminal output.
 * @param root - Project root directory.
 * @returns Structured result describing what was compiled.
 */
export async function compileAndReport(root: string): Promise<CompileResult> {
  output.header("llmwiki compile");

  const locked = await acquireLock(root);
  if (!locked) {
    output.status("!", output.error("Could not acquire lock. Try again later."));
    return {
      ...emptyCompileResult(),
      errors: ["Could not acquire .llmwiki/lock — another compile is in progress."],
    };
  }

  try {
    return await runCompilePipeline(root);
  } finally {
    await releaseLock(root);
  }
}

/** Buckets of source changes used by the compile pipeline. */
interface ChangeBuckets {
  toCompile: SourceChange[];
  deleted: SourceChange[];
  unchanged: SourceChange[];
}

/** Sort source changes into the buckets the pipeline acts on. */
function bucketChanges(changes: SourceChange[]): ChangeBuckets {
  return {
    toCompile: changes.filter((c) => c.status === "new" || c.status === "changed"),
    deleted: changes.filter((c) => c.status === "deleted"),
    unchanged: changes.filter((c) => c.status === "unchanged"),
  };
}

/** Result of phase 2: page writes plus any errors collected along the way. */
interface PageGenerationResult {
  pages: MergedConcept[];
  errors: string[];
}

/** Phase 2: generate pages for merged concepts in parallel, capturing errors. */
async function generatePagesPhase(
  root: string,
  extractions: ExtractionResult[],
  frozenSlugs: Set<string>,
): Promise<PageGenerationResult> {
  const merged = mergeExtractions(extractions, frozenSlugs);
  const limit = pLimit(COMPILE_CONCURRENCY);
  const errors: string[] = [];
  const pages = await Promise.all(
    merged.map((entry) => limit(async () => {
      const writeError = await generateMergedPage(root, entry);
      if (writeError) errors.push(writeError);
      return entry;
    })),
  );
  return { pages, errors };
}

/** Persist source state for every extraction that produced concepts. */
async function persistExtractionStates(
  root: string,
  extractions: ExtractionResult[],
): Promise<void> {
  for (const result of extractions) {
    if (result.concepts.length === 0) continue;
    await persistSourceState(root, result.sourcePath, result.sourceFile, result.concepts);
  }
}

/** Build the structured CompileResult and emit the CLI completion banner. */
function summarizeCompile(
  buckets: ChangeBuckets,
  generation: PageGenerationResult,
  extractions: ExtractionResult[],
): CompileResult {
  output.header("Compilation complete");
  output.status("✓", output.success(
    `${buckets.toCompile.length} compiled, ${buckets.unchanged.length} skipped, ${buckets.deleted.length} deleted`,
  ));
  if (buckets.toCompile.length > 0) {
    output.status("→", output.dim('Next: llmwiki query "your question here"'));
  }

  const errors = [...generation.errors];
  for (const result of extractions) {
    if (result.concepts.length === 0) {
      errors.push(`No concepts extracted from ${result.sourceFile}`);
    }
  }

  return {
    compiled: buckets.toCompile.length,
    skipped: buckets.unchanged.length,
    deleted: buckets.deleted.length,
    concepts: generation.pages.map((entry) => entry.concept.concept),
    pages: generation.pages.map((entry) => entry.slug),
    errors,
  };
}

/** Inner pipeline, runs under lock protection. Returns structured CompileResult. */
async function runCompilePipeline(root: string): Promise<CompileResult> {
  const state = await readState(root);
  const changes = await detectChanges(root, state);
  augmentWithAffectedSources(changes, findAffectedSources(state, changes));

  const buckets = bucketChanges(changes);
  if (buckets.toCompile.length === 0 && buckets.deleted.length === 0) {
    output.status("✓", output.success("Nothing to compile — all sources up to date."));
    return { ...emptyCompileResult(), skipped: buckets.unchanged.length };
  }

  printChangesSummary(changes);
  await markDeletedAsOrphaned(root, buckets.deleted, state);

  const frozenSlugs = findFrozenSlugs(state, changes);
  reportFrozenSlugs(frozenSlugs);

  const extractions = await runExtractionPhases(root, buckets.toCompile, state, changes);
  await freezeFailedExtractions(root, extractions, frozenSlugs);

  const generation = await generatePagesPhase(root, extractions, frozenSlugs);
  await persistExtractionStates(root, extractions);

  if (frozenSlugs.size > 0) {
    await orphanUnownedFrozenPages(root, frozenSlugs);
  }
  await persistFrozenSlugs(root, frozenSlugs, extractions);

  await finalizeWiki(root, generation.pages);
  return summarizeCompile(buckets, generation, extractions);
}

/** Append affected-source changes (logging each addition) to the change list. */
function augmentWithAffectedSources(changes: SourceChange[], affected: string[]): void {
  for (const file of affected) {
    output.status("~", output.info(`${file} [affected by shared concept]`));
    changes.push({ file, status: "changed" });
  }
}

/** Mark wiki pages owned solely by deleted sources as orphaned. */
async function markDeletedAsOrphaned(
  root: string,
  deleted: SourceChange[],
  state: WikiState,
): Promise<void> {
  for (const del of deleted) {
    await markOrphaned(root, del.file, state);
  }
}

/** Log frozen slugs (shared concepts whose deletion-pinned content must persist). */
function reportFrozenSlugs(frozenSlugs: Set<string>): void {
  for (const slug of frozenSlugs) {
    output.status("i", output.dim(`Frozen: ${slug} (shared with deleted source)`));
  }
}

/**
 * Phase 1: extract concepts for the directly-changed batch, then expand to
 * any unchanged sources whose concepts overlap with newly extracted slugs.
 */
async function runExtractionPhases(
  root: string,
  toCompile: SourceChange[],
  state: WikiState,
  allChanges: SourceChange[],
): Promise<ExtractionResult[]> {
  const extractions: ExtractionResult[] = [];
  for (const change of toCompile) {
    extractions.push(await extractForSource(root, change.file));
  }

  const lateAffected = findLateAffectedSources(extractions, state, allChanges);
  for (const file of lateAffected) {
    output.status("~", output.info(`${file} [shares concept with new source]`));
    extractions.push(await extractForSource(root, file));
  }

  return extractions;
}

/** Resolve interlinks, regenerate index/MOC, refresh embeddings post-write. */
async function finalizeWiki(root: string, pages: MergedConcept[]): Promise<void> {
  const allChangedSlugs = pages.map((entry) => entry.slug);
  const allNewSlugs = pages.filter((entry) => entry.concept.is_new).map((entry) => entry.slug);

  if (allChangedSlugs.length > 0) {
    output.status("🔗", output.info("Resolving interlinks..."));
    await resolveLinks(root, allChangedSlugs, allNewSlugs);
  }

  await generateIndex(root);
  await generateMOC(root);
  await safelyUpdateEmbeddings(root, allChangedSlugs);
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
): Promise<string | null> {
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
  return await writePageIfValid(pagePath, fullPage, entry.concept.concept);
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
): Promise<string | null> {
  if (!validateWikiPage(content)) {
    output.status("!", output.warn(`Invalid page for "${conceptTitle}" — skipped.`));
    return `Invalid page for "${conceptTitle}" — failed validation`;
  }

  await atomicWrite(pagePath, content);
  return null;
}

/**
 * Refresh the embeddings store without failing compilation.
 * Semantic search is a non-critical enhancement — missing API keys or
 * transient provider errors should produce a warning, not a broken build.
 */
async function safelyUpdateEmbeddings(root: string, changedSlugs: string[]): Promise<void> {
  try {
    await updateEmbeddings(root, changedSlugs);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    output.status("!", output.warn(`Skipped embeddings update: ${message}`));
  }
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
