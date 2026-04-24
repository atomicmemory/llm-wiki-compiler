/**
 * Shared CLI subprocess helper for integration tests.
 *
 * Spawns the compiled CLI binary and captures full subprocess diagnostics
 * (code, signal, killed flag, error message, stdout, stderr) so test
 * failures can be diagnosed without rerunning.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { access } from "fs/promises";
import path from "path";

const exec = promisify(execFile);

/** Absolute path to the compiled CLI entry point. */
export const CLI = path.resolve("dist/cli.js");

/** Result shape returned by {@link runCLI}. */
export interface CLIResult {
  stdout: string;
  stderr: string;
  code: number;
  /** Signal that terminated the process (null if exit was via code). */
  signal: string | null;
  /** True when the process was killed (timeout, signal, etc). */
  killed: boolean;
  /** Error message from child_process when the spawn itself fails (ENOENT etc). */
  message: string | null;
  /** Original args for inclusion in assertion-failure messages. */
  args: string[];
  /** Working directory passed to the subprocess. */
  cwd: string;
}

/**
 * Format a CLIResult into a multi-line diagnostic string. Callers should
 * include this in assertion failure messages so CI logs capture everything.
 * @param result - The CLIResult to format.
 * @returns Multi-line diagnostic string.
 */
export function formatCLIFailure(result: CLIResult): string {
  return [
    `  args: ${JSON.stringify(result.args)}`,
    `  cwd: ${result.cwd}`,
    `  code: ${result.code}`,
    `  signal: ${result.signal}`,
    `  killed: ${result.killed}`,
    `  message: ${result.message}`,
    `  stdout: ${JSON.stringify(result.stdout.slice(0, 500))}`,
    `  stderr: ${JSON.stringify(result.stderr.slice(0, 500))}`,
  ].join("\n");
}

/**
 * Run the llmwiki CLI with the given arguments and return its output +
 * rich diagnostics. Never throws — non-zero exits and spawn errors are
 * captured into the returned CLIResult.
 * @param args - CLI arguments to pass after `node dist/cli.js`.
 * @param cwd - Working directory for the subprocess. Must exist.
 * @param envOverrides - Optional environment variable overrides.
 */
export async function runCLI(
  args: string[],
  cwd: string,
  envOverrides: NodeJS.ProcessEnv = {},
): Promise<CLIResult> {
  // Guard against the temp-dir race: if cwd doesn't exist yet, the subprocess
  // will fail in a way that's hard to diagnose. Surface it explicitly.
  await access(cwd);

  try {
    const { stdout, stderr } = await exec("node", [CLI, ...args], {
      cwd,
      env: { ...process.env, ...envOverrides },
    });
    return {
      stdout,
      stderr,
      code: 0,
      signal: null,
      killed: false,
      message: null,
      args,
      cwd,
    };
  } catch (err: unknown) {
    const e = err as {
      stdout?: string;
      stderr?: string;
      code?: number;
      signal?: string | null;
      killed?: boolean;
      message?: string;
    };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      code: typeof e.code === "number" ? e.code : 1,
      signal: e.signal ?? null,
      killed: e.killed ?? false,
      message: e.message ?? null,
      args,
      cwd,
    };
  }
}
