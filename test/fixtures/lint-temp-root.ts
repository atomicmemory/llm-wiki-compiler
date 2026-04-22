/**
 * Shared test fixtures for lint-style tests that need a tmp wiki layout
 * (concepts + queries + sources directories) and helpers for writing
 * raw markdown strings into them.
 */

import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import path from "path";
import os from "os";
import { beforeEach, afterEach } from "vitest";

/** Live state populated by `useLintTempRoot` for each test. */
export interface LintTempRoot {
  /** Absolute path to the temp project root, valid inside `it` blocks. */
  dir: string;
  /** Write a raw markdown string to wiki/concepts/<slug>.md. */
  writeConcept: (slug: string, content: string) => Promise<void>;
  /** Write a raw markdown string to wiki/queries/<slug>.md. */
  writeQuery: (slug: string, content: string) => Promise<void>;
  /** Write a source markdown file by name. */
  writeSource: (name: string, content: string) => Promise<void>;
}

/**
 * Provision a tmp wiki root and wire vitest before/afterEach hooks so callers
 * just access `env.dir` etc. inside `it` blocks. Eliminates the duplicated
 * lifecycle boilerplate previously copy-pasted across lint test files.
 * @param prefix - Short label for the temp directory name.
 * @returns A live handle whose fields refresh per test.
 */
export function useLintTempRoot(prefix: string): LintTempRoot {
  const env: LintTempRoot = {
    dir: "",
    writeConcept: notInitialized,
    writeQuery: notInitialized,
    writeSource: notInitialized,
  };

  beforeEach(async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
    await mkdir(path.join(dir, "wiki", "concepts"), { recursive: true });
    await mkdir(path.join(dir, "wiki", "queries"), { recursive: true });
    await mkdir(path.join(dir, "sources"), { recursive: true });
    env.dir = dir;
    env.writeConcept = (slug, content) =>
      writeFile(path.join(dir, "wiki", "concepts", `${slug}.md`), content);
    env.writeQuery = (slug, content) =>
      writeFile(path.join(dir, "wiki", "queries", `${slug}.md`), content);
    env.writeSource = (name, content) =>
      writeFile(path.join(dir, "sources", name), content);
  });

  afterEach(async () => {
    if (env.dir) await rm(env.dir, { recursive: true, force: true });
  });

  return env;
}

/** Throws if a writer is invoked before vitest has run beforeEach. */
function notInitialized(): Promise<void> {
  throw new Error("LintTempRoot used outside of an it() block");
}
