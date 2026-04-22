/**
 * Review candidate persistence for the llmwiki compile pipeline.
 *
 * When `llmwiki compile --review` runs, generated wiki pages are routed
 * here as JSON candidate records under `.llmwiki/candidates/` instead of
 * being written directly to `wiki/`. Reviewers then approve or reject the
 * proposals via the `llmwiki review` subcommands.
 *
 * Candidates are deliberately kept as standalone JSON so they survive across
 * compile runs and can be inspected manually without the CLI. Each record
 * stores the full page body so approval is a pure copy — the LLM is never
 * called again at approval time.
 */

import { readdir, rename, unlink, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { randomBytes } from "crypto";
import { atomicWrite, safeReadFile } from "../utils/markdown.js";
import * as output from "../utils/output.js";
import {
  CANDIDATES_DIR,
  CANDIDATES_ARCHIVE_DIR,
} from "../utils/constants.js";
import type { ReviewCandidate } from "../utils/types.js";

/** Length (bytes) of the random suffix appended to candidate ids. */
const ID_SUFFIX_BYTES = 4;

/** Filesystem extension used for candidate JSON files. */
const CANDIDATE_EXT = ".json";

/** Input shape for creating a new candidate (id + timestamp generated here). */
interface CandidateDraft {
  title: string;
  slug: string;
  summary: string;
  sources: string[];
  body: string;
}

/** Build a deterministic-but-unique id from a slug and a short random suffix. */
function buildCandidateId(slug: string): string {
  const suffix = randomBytes(ID_SUFFIX_BYTES).toString("hex");
  return `${slug}-${suffix}`;
}

/** Absolute path to a candidate's JSON file. */
function candidatePath(root: string, id: string): string {
  return path.join(root, CANDIDATES_DIR, `${id}${CANDIDATE_EXT}`);
}

/** Absolute path to the archived JSON file for a rejected candidate. */
function archivePath(root: string, id: string): string {
  return path.join(root, CANDIDATES_ARCHIVE_DIR, `${id}${CANDIDATE_EXT}`);
}

/**
 * Persist a new candidate record and return it. The id is generated from the
 * slug plus a short random suffix so multiple compile runs can co-exist.
 * @param root - Project root directory.
 * @param draft - The candidate fields to persist.
 * @returns The full ReviewCandidate (with id + generatedAt populated).
 */
export async function writeCandidate(
  root: string,
  draft: CandidateDraft,
): Promise<ReviewCandidate> {
  const candidate: ReviewCandidate = {
    id: buildCandidateId(draft.slug),
    title: draft.title,
    slug: draft.slug,
    summary: draft.summary,
    sources: draft.sources,
    body: draft.body,
    generatedAt: new Date().toISOString(),
  };

  await atomicWrite(candidatePath(root, candidate.id), JSON.stringify(candidate, null, 2));
  return candidate;
}

/**
 * Load a candidate by id and, if missing, emit the standard "not found" CLI
 * error and set process.exitCode = 1. Returns null when the candidate is
 * missing so callers can early-return without re-implementing the same
 * error block in every review subcommand.
 * @param root - Project root directory.
 * @param id - Candidate id to look up.
 */
export async function loadCandidateOrFail(
  root: string,
  id: string,
): Promise<ReviewCandidate | null> {
  const candidate = await readCandidate(root, id);
  if (!candidate) {
    output.status("!", output.error(`Candidate not found: ${id}`));
    process.exitCode = 1;
    return null;
  }
  return candidate;
}

/** Parse a single candidate JSON file. Returns null when the file is missing or malformed. */
export async function readCandidate(
  root: string,
  id: string,
): Promise<ReviewCandidate | null> {
  const raw = await safeReadFile(candidatePath(root, id));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ReviewCandidate;
    if (!isValidCandidate(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Defensive type-guard so corrupted candidate files don't blow up the CLI. */
function isValidCandidate(value: unknown): value is ReviewCandidate {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.slug === "string" &&
    typeof candidate.body === "string" &&
    Array.isArray(candidate.sources)
  );
}

/**
 * List every candidate currently pending review, sorted by generation time.
 * Skips files that aren't candidate JSON (e.g. the archive subdirectory).
 * @param root - Project root directory.
 * @returns All pending review candidates.
 */
export async function listCandidates(root: string): Promise<ReviewCandidate[]> {
  const dir = path.join(root, CANDIDATES_DIR);
  if (!existsSync(dir)) return [];

  const entries = await readdir(dir, { withFileTypes: true });
  const candidates: ReviewCandidate[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(CANDIDATE_EXT)) continue;
    const id = entry.name.slice(0, -CANDIDATE_EXT.length);
    const candidate = await readCandidate(root, id);
    if (candidate) candidates.push(candidate);
  }

  candidates.sort((a, b) => a.generatedAt.localeCompare(b.generatedAt));
  return candidates;
}

/** Count pending candidates without parsing each file's body. */
export async function countCandidates(root: string): Promise<number> {
  const dir = path.join(root, CANDIDATES_DIR);
  if (!existsSync(dir)) return 0;

  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith(CANDIDATE_EXT)).length;
}

/** Remove a pending candidate from disk. Returns false when nothing existed to remove. */
export async function deleteCandidate(root: string, id: string): Promise<boolean> {
  const filePath = candidatePath(root, id);
  if (!existsSync(filePath)) return false;
  await unlink(filePath);
  return true;
}

/**
 * Move a candidate from the pending area into the archive subdirectory so
 * rejected proposals stay auditable without touching `wiki/`.
 * @param root - Project root directory.
 * @param id - Candidate id to archive.
 * @returns True when the candidate was found and archived.
 */
export async function archiveCandidate(root: string, id: string): Promise<boolean> {
  const sourcePath = candidatePath(root, id);
  if (!existsSync(sourcePath)) return false;

  const target = archivePath(root, id);
  await mkdir(path.dirname(target), { recursive: true });
  // Copy via writeFile + unlink to support cross-filesystem rename failures.
  try {
    await rename(sourcePath, target);
  } catch {
    const raw = await safeReadFile(sourcePath);
    await writeFile(target, raw, "utf-8");
    await unlink(sourcePath);
  }
  return true;
}
