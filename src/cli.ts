/**
 * CLI entry point for llmwiki — the knowledge compiler.
 *
 * Registers all commands (ingest, compile, query, watch) via Commander.
 * Validates ANTHROPIC_API_KEY for commands that need LLM access.
 * Designed for `npx llmwiki` or global install via `npm install -g llm-wiki-compiler`.
 */

import "dotenv/config";
import { createRequire } from "module";
import { Command } from "commander";
import ingestCommand from "./commands/ingest.js";
import compileCommand from "./commands/compile.js";
import queryCommand from "./commands/query.js";
import watchCommand from "./commands/watch.js";
import lintCommand from "./commands/lint.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

const program = new Command();

program
  .name("llmwiki")
  .description("The knowledge compiler — raw sources in, interlinked wiki out")
  .version(version);

program
  .command("ingest <source>")
  .description("Ingest a URL or local file into sources/")
  .action(async (source: string) => {
    try {
      await ingestCommand(source);
    } catch (err) {
      console.error(`\x1b[31mError:\x1b[0m ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  });

program
  .command("compile")
  .description("Compile sources/ into an interlinked wiki")
  .action(async () => {
    requireApiKey();
    try {
      await compileCommand();
    } catch (err) {
      console.error(`\x1b[31mError:\x1b[0m ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  });

program
  .command("query <question>")
  .description("Ask a question against the wiki")
  .option("--save", "Save the answer as a wiki page")
  .action(async (question: string, options: { save?: boolean }) => {
    requireApiKey();
    try {
      await queryCommand(process.cwd(), question, options);
    } catch (err) {
      console.error(`\x1b[31mError:\x1b[0m ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  });

program
  .command("watch")
  .description("Watch sources/ and auto-recompile on changes")
  .action(async () => {
    requireApiKey();
    try {
      await watchCommand();
    } catch (err) {
      console.error(`\x1b[31mError:\x1b[0m ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  });

program
  .command("lint")
  .description("Run rule-based quality checks against the wiki")
  .action(async () => {
    try {
      await lintCommand();
    } catch (err) {
      console.error(`\x1b[31mError:\x1b[0m ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  });

program.parse();

/** Exit with a helpful message if ANTHROPIC_API_KEY is missing. */
function requireApiKey(): void {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(
      "\x1b[31mError:\x1b[0m ANTHROPIC_API_KEY environment variable is required.\n" +
        "  Set it with: export ANTHROPIC_API_KEY=sk-ant-...\n" +
        "  Get a key at: https://console.anthropic.com/settings/keys",
    );
    process.exit(1);
  }
}
