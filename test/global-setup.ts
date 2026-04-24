/**
 * Vitest globalSetup: build dist/ once before any test file loads.
 *
 * Several test files spawn `node dist/cli.js` to exercise the CLI surface.
 * Without a shared setup, each file's own beforeAll would call `npx tsup`,
 * and vitest's parallel-by-default test workers would race on dist/cli.js
 * (tsup's `clean: true` wipes the file mid-write). Building once globally
 * eliminates the race and saves ~1s per integration test file.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";

const exec = promisify(execFile);

export async function setup(): Promise<void> {
  await exec("npx", ["tsup"], { cwd: path.resolve(".") });
}
