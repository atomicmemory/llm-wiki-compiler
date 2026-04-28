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

import { describe, it, expect, afterEach } from "vitest";
import path from "path";
import { mkdtemp, mkdir, rm, writeFile, readdir, readFile } from "fs/promises";
import { tmpdir } from "os";
import { runCLI, expectCLIExit } from "./fixtures/run-cli.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

/** Make a workspace and write two same-basename files in distinct sub-dirs. */
async function makeCollidingWorkspace(): Promise<{
  cwd: string;
  pathA: string;
  pathB: string;
}> {
  const cwd = await mkdtemp(path.join(tmpdir(), "llmwiki-collision-"));
  tempDirs.push(cwd);
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
});
