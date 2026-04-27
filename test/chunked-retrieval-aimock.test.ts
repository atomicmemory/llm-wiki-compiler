/**
 * Subprocess CLI coverage for chunked-retrieval that requires a working LLM.
 *
 * The existing chunked-retrieval-integration.test.ts file documents two
 * specific gaps that couldn't be exercised at the CLI boundary without a
 * live LLM:
 *
 *   1. Full `compile` → extract → page generation → chunk embedding pipeline
 *      producing a v2 store with chunks on disk.
 *   2. (Followup) full `query --debug` flow printing chunk slugs/scores.
 *
 * Now that aimock is in the project (see test/fixtures/aimock-helper.ts),
 * the first gap is closeable. This file covers it. The query-debug test
 * needs both completion + embedding stubs that span Anthropic + Voyage; it
 * is left as a follow-up once the aimock embedding path is understood.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdir, mkdtemp, rm, readFile, writeFile, readdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { tmpdir } from "os";
import {
  startMockClaude,
  stopMockClaude,
  mockOpenAIEnv,
  type MockClaudeHandle,
} from "./fixtures/aimock-helper.js";
import { runCLI, expectCLIExit, formatCLIFailure } from "./fixtures/run-cli.js";

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

/** Temp project workspace seeded with a single source file. */
async function makeWorkspaceWithSource(content: string): Promise<string> {
  const cwd = await mkdtemp(path.join(tmpdir(), "llmwiki-cr-aimock-"));
  tempDirs.push(cwd);
  await mkdir(path.join(cwd, "sources"), { recursive: true });
  await writeFile(path.join(cwd, "sources", "intro.md"), content, "utf-8");
  return cwd;
}

describe("chunked-retrieval subprocess coverage via aimock", () => {
  it("compile populates a v2 embedding store with chunks for newly-generated pages", async () => {
    mockHandle = await startMockClaude();

    // Stub extraction → one new concept the page generator can render.
    mockHandle.mock.onToolCall("extract_concepts", {
      toolCalls: [
        {
          name: "extract_concepts",
          arguments: {
            concepts: [
              {
                concept: "Chunked Retrieval",
                summary: "Splitting wiki pages into chunks before vector search.",
                is_new: true,
                tags: ["retrieval"],
                confidence: 0.9,
              },
            ],
          },
        },
      ],
    });

    // Stub page-body generation. Body must be long enough to produce at least
    // one chunk (CHUNK_MIN_CHARS gates trailing-fragment merging).
    mockHandle.mock.onMessage(/.*/, {
      content:
        "Chunked retrieval breaks long wiki pages into smaller passages before " +
        "comparing them against a query vector. Each chunk is embedded with the " +
        "active provider's embedding model and persisted on disk under the " +
        "chunks array of .llmwiki/embeddings.json. Reusing chunks across compiles " +
        "via content hashes keeps embedding costs proportional to actual edits, " +
        "not the size of the wiki.",
    });

    // Stub the embedding endpoint. aimock recognises Voyage/Anthropic-compatible
    // /embeddings calls and returns the canned vector for any input.
    mockHandle.mock.onEmbedding(/.*/, {
      embedding: Array.from({ length: 8 }, (_, i) => i / 10),
    });

    const cwd = await makeWorkspaceWithSource(
      "# Chunked Retrieval\n\nA long-form note about chunk-based vector search.\n",
    );

    const result = await runCLI(["compile"], cwd, mockOpenAIEnv(mockHandle));
    expectCLIExit(result, 0);

    // Assert: a wiki page was generated.
    const conceptsDir = path.join(cwd, "wiki", "concepts");
    const conceptFiles = await readdir(conceptsDir);
    const conceptMd = conceptFiles.find((f) => f.endsWith(".md"));
    expect(conceptMd, formatCLIFailure(result)).toBeDefined();

    // Assert: the embedding store exists, version 2, with chunks populated.
    const storePath = path.join(cwd, ".llmwiki", "embeddings.json");
    expect(existsSync(storePath)).toBe(true);
    const store = JSON.parse(await readFile(storePath, "utf-8")) as {
      version: number;
      entries: unknown[];
      chunks?: unknown[];
    };
    expect(store.version, formatCLIFailure(result)).toBe(2);
    expect(store.entries.length, formatCLIFailure(result)).toBeGreaterThan(0);
    expect((store.chunks ?? []).length, formatCLIFailure(result)).toBeGreaterThan(0);
  }, 30_000);
});
