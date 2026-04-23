/**
 * Commander action for `llmwiki compile`.
 * Checks that sources exist, then delegates to the compilation orchestrator
 * to process all new and changed source files into wiki pages.
 */

import { existsSync } from "fs";
import { compile } from "../compiler/index.js";
import * as output from "../utils/output.js";
import { SOURCES_DIR } from "../utils/constants.js";
import type { CompileOptions } from "../utils/types.js";

/**
 * Run the compile command from the current working directory.
 * Exits early if no sources directory exists yet.
 * @param options - Optional behaviour overrides forwarded from the CLI flag set.
 */
export default async function compileCommand(options: CompileOptions = {}): Promise<void> {
  if (!existsSync(SOURCES_DIR)) {
    output.status(
      "!",
      output.warn('No sources found. Run `llmwiki ingest <url>` first.'),
    );
    return;
  }

  await compile(process.cwd(), options);
}
