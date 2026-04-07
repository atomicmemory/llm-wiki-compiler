import { describe, it, expect, beforeEach } from "vitest";
import { writeFile, readFile } from "fs/promises";
import path from "path";
import { generateIndex } from "../src/compiler/indexgen.js";
import { buildFrontmatter } from "../src/utils/markdown.js";
import { makeTempRoot } from "./fixtures/temp-root.js";

/** Write a minimal wiki page with frontmatter into a directory. */
async function writePage(dir: string, slug: string, title: string, summary: string): Promise<void> {
  const fm = buildFrontmatter({ title, summary });
  await writeFile(path.join(dir, `${slug}.md`), `${fm}\n\nBody of ${title}.\n`);
}

describe("generateIndex", () => {
  let root: string;

  beforeEach(async () => {
    root = await makeTempRoot("idx");
  });

  it("includes concept pages in the index", async () => {
    await writePage(path.join(root, "wiki/concepts"), "alpha", "Alpha", "First concept");
    await generateIndex(root);

    const index = await readFile(path.join(root, "wiki/index.md"), "utf-8");
    expect(index).toContain("[[Alpha]]");
    expect(index).toContain("First concept");
    expect(index).toContain("## Concepts");
  });

  it("includes saved query pages in a separate section", async () => {
    await writePage(path.join(root, "wiki/concepts"), "alpha", "Alpha", "A concept");
    await writePage(path.join(root, "wiki/queries"), "what-is-alpha", "What is Alpha?", "A query answer");
    await generateIndex(root);

    const index = await readFile(path.join(root, "wiki/index.md"), "utf-8");
    expect(index).toContain("## Concepts");
    expect(index).toContain("[[Alpha]]");
    expect(index).toContain("## Saved Queries");
    expect(index).toContain("[[What is Alpha?]]");
  });

  it("omits Saved Queries section when no queries exist", async () => {
    await writePage(path.join(root, "wiki/concepts"), "beta", "Beta", "A concept");
    await generateIndex(root);

    const index = await readFile(path.join(root, "wiki/index.md"), "utf-8");
    expect(index).toContain("## Concepts");
    expect(index).not.toContain("## Saved Queries");
  });

  it("reports correct total page count", async () => {
    await writePage(path.join(root, "wiki/concepts"), "a", "A", "s");
    await writePage(path.join(root, "wiki/concepts"), "b", "B", "s");
    await writePage(path.join(root, "wiki/queries"), "q", "Q", "s");
    await generateIndex(root);

    const index = await readFile(path.join(root, "wiki/index.md"), "utf-8");
    expect(index).toContain("3 pages");
  });

  it("handles empty wiki gracefully", async () => {
    await generateIndex(root);

    const index = await readFile(path.join(root, "wiki/index.md"), "utf-8");
    expect(index).toContain("0 pages");
  });

  it("excludes orphaned pages from the index", async () => {
    await writePage(path.join(root, "wiki/concepts"), "alive", "Alive", "Still here");
    const orphanFm = buildFrontmatter({ title: "Dead", summary: "Gone", orphaned: true });
    await writeFile(
      path.join(root, "wiki/concepts/dead.md"),
      `${orphanFm}\n\nOrphaned content.\n`,
    );
    await generateIndex(root);

    const index = await readFile(path.join(root, "wiki/index.md"), "utf-8");
    expect(index).toContain("[[Alive]]");
    expect(index).not.toContain("[[Dead]]");
    expect(index).toContain("1 pages");
  });
});
