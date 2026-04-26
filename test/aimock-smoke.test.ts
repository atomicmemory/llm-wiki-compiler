/**
 * Smoke test for the aimock subprocess pattern.
 *
 * Proves that a `compile --review` subprocess invocation routes through
 * the aimock LLM stub and produces a candidate JSON record on disk —
 * closing the long-standing "no subprocess test for the compile happy
 * path" gap that has been documented on several branches' merged PRs.
 *
 * If this passes, the same pattern can be applied to backfill subprocess
 * coverage on any feature whose code path needs an LLM (compile, query,
 * compile --review, image vision, etc).
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, readdir, readFile } from "fs/promises";
import path from "path";
import { tmpdir } from "os";
import {
  startMockClaude,
  stopMockClaude,
  mockClaudeEnv,
  type MockClaudeHandle,
} from "./fixtures/aimock-helper.js";
import { runCLI, expectCLIExit } from "./fixtures/run-cli.js";

const tempDirs: string[] = [];
let mockHandle: MockClaudeHandle | null = null;

afterEach(async () => {
  if (mockHandle) {
    await stopMockClaude(mockHandle);
    mockHandle = null;
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

/** Make a temp project workspace with one source file ready for compile. */
async function makeWorkspace(sourceContent: string): Promise<string> {
  const cwd = await mkdtemp(path.join(tmpdir(), "llmwiki-aimock-smoke-"));
  tempDirs.push(cwd);
  await mkdir(path.join(cwd, "sources"), { recursive: true });
  await writeFile(path.join(cwd, "sources", "intro.md"), sourceContent, "utf-8");
  return cwd;
}

describe("aimock subprocess smoke", () => {
  it("compile --review writes a candidate using the mocked Claude response", async () => {
    mockHandle = await startMockClaude();

    // Stub the extraction tool call: one new concept named "Mock Concept".
    mockHandle.mock.onToolCall("extract_concepts", {
      toolCalls: [
        {
          name: "extract_concepts",
          arguments: {
            concepts: [
              {
                concept: "Mock Concept",
                summary: "A canned concept returned by aimock.",
                is_new: true,
                tags: ["smoke-test"],
                confidence: 0.95,
              },
            ],
          },
        },
      ],
    });

    // Stub the page-body generation: any subsequent message → canned body.
    mockHandle.mock.onMessage(/.*/, {
      content: "Mock concept body produced via aimock for the smoke test.",
    });

    const cwd = await makeWorkspace(
      "# Mock Source\n\nA short source document for the smoke test.\n",
    );

    const result = await runCLI(
      ["compile", "--review"],
      cwd,
      mockClaudeEnv(mockHandle),
    );

    expectCLIExit(result, 0);

    // Candidate JSON should land in .llmwiki/candidates/.
    const candidatesDir = path.join(cwd, ".llmwiki", "candidates");
    const candidateFiles = await readdir(candidatesDir);
    const jsonCandidates = candidateFiles.filter((f) => f.endsWith(".json"));
    expect(jsonCandidates.length).toBeGreaterThan(0);

    const candidatePath = path.join(candidatesDir, jsonCandidates[0]);
    const candidateText = await readFile(candidatePath, "utf-8");
    const candidate = JSON.parse(candidateText) as {
      title: string;
      slug: string;
      body: string;
    };

    expect(candidate.title).toBe("Mock Concept");
    expect(candidate.slug).toBe("mock-concept");
    expect(candidate.body).toContain("Mock concept body produced via aimock");

    // Review-mode contract: wiki/concepts/ must NOT have any pages written.
    const conceptsDir = path.join(cwd, "wiki", "concepts");
    const conceptFiles = await readdir(conceptsDir).catch(() => [] as string[]);
    expect(conceptFiles.filter((f) => f.endsWith(".md"))).toHaveLength(0);
  }, 30_000);
});
