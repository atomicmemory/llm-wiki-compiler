/**
 * Shared CLI subprocess helper for integration tests.
 *
 * Provides a single `runCLI` function used by both review-integration and
 * schema-integration tests to spawn the compiled CLI binary and capture its
 * output and exit code without throwing on non-zero exits.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";

const exec = promisify(execFile);

/** Absolute path to the compiled CLI entry point. */
export const CLI = path.resolve("dist/cli.js");

/** Result shape returned by {@link runCLI}. */
export interface CLIResult {
  stdout: string;
  stderr: string;
  code: number;
}

/**
 * Run the llmwiki CLI with the given arguments and return its output.
 * Never throws — non-zero exits are captured as `code` in the result.
 * @param args - CLI arguments to pass after `node dist/cli.js`.
 * @param cwd - Working directory for the subprocess.
 * @param envOverrides - Optional environment variable overrides.
 */
export async function runCLI(
  args: string[],
  cwd: string,
  envOverrides: NodeJS.ProcessEnv = {},
): Promise<CLIResult> {
  try {
    const { stdout, stderr } = await exec("node", [CLI, ...args], {
      cwd,
      env: { ...process.env, ...envOverrides },
    });
    return { stdout, stderr, code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", code: e.code ?? 1 };
  }
}
