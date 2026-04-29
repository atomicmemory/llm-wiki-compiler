/**
 * CLI integration tests for issue #36 — files sharing a basename must not
 * silently overwrite each other in sources/.
 *
 * Before the fix, `saveSource` built the destination path purely from the
 * slugified title:
 *   const filename = `${slugify(title)}.md`;
 * So `a/notes.md` and `b/notes.md` both wrote to `sources/notes.md`,
 * and the second ingest silently won. The fix appends a stable
 * source-derived hash suffix when a destination collides with a different
 * source, while keeping re-ingest of the same source idempotent.
 */

import { describe, it, expect } from "vitest";
import path from "path";
import { mkdir, writeFile, readdir, readFile } from "fs/promises";
import { runCLI, expectCLIExit } from "./fixtures/run-cli.js";
import { useIngestWorkspaces } from "./fixtures/ingest-workspace.js";

const workspaces = useIngestWorkspaces("collision");

/** Make a workspace and write two same-basename files in distinct sub-dirs. */
async function makeCollidingWorkspace(): Promise<{
  cwd: string;
  pathA: string;
  pathB: string;
}> {
  const cwd = await workspaces.makeEmptyWorkspace();
  await mkdir(path.join(cwd, "a"), { recursive: true });
  await mkdir(path.join(cwd, "b"), { recursive: true });
  const pathA = path.join(cwd, "a", "notes.md");
  const pathB = path.join(cwd, "b", "notes.md");
  await writeFile(pathA, "# Notes A\n\nContent from a/notes.md.", "utf-8");
  await writeFile(pathB, "# Notes B\n\nContent from b/notes.md.", "utf-8");
  return { cwd, pathA, pathB };
}

describe("ingest — basename collision (#36)", () => {
  it("two distinct sources with the same basename produce two distinct files", async () => {
    const { cwd, pathA, pathB } = await makeCollidingWorkspace();

    const r1 = await runCLI(["ingest", pathA], cwd);
    expectCLIExit(r1, 0);
    const r2 = await runCLI(["ingest", pathB], cwd);
    expectCLIExit(r2, 0);

    const files = (await readdir(path.join(cwd, "sources"))).sort();
    expect(files.length).toBe(2);
    // First write keeps the bare basename; second write gets a stable hash suffix.
    expect(files).toContain("notes.md");
    expect(files.some((f) => /^notes-[0-9a-f]{8}\.md$/.test(f))).toBe(true);

    // Both contents are present — no silent overwrite.
    const contents = await Promise.all(
      files.map((f) => readFile(path.join(cwd, "sources", f), "utf-8")),
    );
    const joined = contents.join("\n");
    expect(joined).toContain("Content from a/notes.md.");
    expect(joined).toContain("Content from b/notes.md.");
  });

  it("re-ingesting the same source overwrites in place (idempotent, no duplicates)", async () => {
    const { cwd, pathA } = await makeCollidingWorkspace();

    expectCLIExit(await runCLI(["ingest", pathA], cwd), 0);
    expectCLIExit(await runCLI(["ingest", pathA], cwd), 0);
    expectCLIExit(await runCLI(["ingest", pathA], cwd), 0);

    const files = await readdir(path.join(cwd, "sources"));
    // Three ingests of the same file → still exactly one source on disk.
    expect(files).toEqual(["notes.md"]);
  });

  it("disambiguation hash is stable across runs (same source → same suffix)", async () => {
    const { cwd, pathA, pathB } = await makeCollidingWorkspace();

    expectCLIExit(await runCLI(["ingest", pathA], cwd), 0);
    expectCLIExit(await runCLI(["ingest", pathB], cwd), 0);
    const firstRun = (await readdir(path.join(cwd, "sources"))).sort();

    // Re-ingest pathB — should hit the same hashed filename, not generate a new one.
    expectCLIExit(await runCLI(["ingest", pathB], cwd), 0);
    const secondRun = (await readdir(path.join(cwd, "sources"))).sort();

    expect(secondRun).toEqual(firstRun);
  });

  // Edge case: an existing sources/X.md without llmwiki frontmatter (or with
  // missing `source` field) should never be silently overwritten — the
  // resolver must fall through to the hash suffix path.
  it("falls through cleanly when an existing same-basename file is malformed", async () => {
    const { cwd, pathA } = await makeCollidingWorkspace();

    // Pre-seed sources/notes.md with a file that has no llmwiki frontmatter
    // at all — could be a user's hand-written file or stray content.
    await mkdir(path.join(cwd, "sources"), { recursive: true });
    await writeFile(
      path.join(cwd, "sources", "notes.md"),
      "Pre-existing notes with no frontmatter.\n",
      "utf-8",
    );

    const result = await runCLI(["ingest", pathA], cwd);
    expectCLIExit(result, 0);

    const files = (await readdir(path.join(cwd, "sources"))).sort();
    expect(files.length).toBe(2);
    expect(files).toContain("notes.md");
    expect(files.some((f) => /^notes-[0-9a-f]{8}\.md$/.test(f))).toBe(true);

    // The pre-existing file is preserved verbatim — no silent overwrite.
    const original = await readFile(path.join(cwd, "sources", "notes.md"), "utf-8");
    expect(original).toBe("Pre-existing notes with no frontmatter.\n");
  });
});
