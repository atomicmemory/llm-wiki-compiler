/**
 * Shared test helper for creating temporary llmwiki project roots.
 * Used by tests that need a realistic filesystem layout (wiki/concepts, wiki/queries).
 */

import { mkdir } from "fs/promises";
import path from "path";
import os from "os";

/**
 * Create a temp directory simulating an llmwiki project root.
 * Creates wiki/concepts and wiki/queries subdirectories.
 * @param prefix - Short label for the temp directory name.
 * @returns Absolute path to the temporary root.
 */
export async function makeTempRoot(prefix: string): Promise<string> {
  const root = path.join(
    os.tmpdir(),
    `llmwiki-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(path.join(root, "wiki/concepts"), { recursive: true });
  await mkdir(path.join(root, "wiki/queries"), { recursive: true });
  return root;
}
