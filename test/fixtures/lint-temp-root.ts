/**
 * Shared test helper for creating a temporary llmwiki layout used by
 * lint-rule tests. Sets up wiki/concepts, wiki/queries, and sources/
 * directories under a unique temp root.
 */

import { mkdtemp, mkdir, writeFile } from "fs/promises";
import path from "path";
import os from "os";

/** Common shape returned by makeLintTempRoot — root path and writers. */
export interface LintTempRoot {
  root: string;
  writeConceptPage: (slug: string, content: string) => Promise<void>;
  writeQueryPage: (slug: string, content: string) => Promise<void>;
  writeSourceFile: (name: string, content: string) => Promise<void>;
}

/**
 * Create a temp directory with the standard wiki/sources layout that lint
 * rules expect. Each call returns a fresh isolated path along with helpers
 * for writing concept pages, query pages, and source files.
 * @param prefix - Short label appended to the temp directory name.
 */
export async function makeLintTempRoot(prefix: string): Promise<LintTempRoot> {
  const root = await mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
  await mkdir(path.join(root, "wiki", "concepts"), { recursive: true });
  await mkdir(path.join(root, "wiki", "queries"), { recursive: true });
  await mkdir(path.join(root, "sources"), { recursive: true });
  return {
    root,
    writeConceptPage: (slug, content) =>
      writeFile(path.join(root, "wiki", "concepts", `${slug}.md`), content),
    writeQueryPage: (slug, content) =>
      writeFile(path.join(root, "wiki", "queries", `${slug}.md`), content),
    writeSourceFile: (name, content) =>
      writeFile(path.join(root, "sources", name), content),
  };
}
