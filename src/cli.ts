/**
 * CLI entry point for llmwiki — the knowledge compiler.
 *
 * Registers all commands (ingest, compile, query, watch, lint) via Commander.
 * Validates the correct API key for the selected LLM provider.
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
import { startMCPServer } from "./mcp/server.js";
import { DEFAULT_PROVIDER } from "./utils/constants.js";
import { resolveAnthropicAuthFromEnv } from "./utils/claude-settings.js";

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
    try {
      requireProvider();
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
    try {
      requireProvider();
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
    try {
      requireProvider();
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

program
  .command("serve")
  .description("Start an MCP server exposing wiki tools and resources over stdio")
  .option("--root <dir>", "Project root directory", process.cwd())
  .action(async (options: { root: string }) => {
    try {
      // Per-tool credential checks happen inside the MCP layer so read-only
      // tools and ingest still work without an API key.
      await startMCPServer({ root: options.root, version });
    } catch (err) {
      console.error(`\x1b[31mError:\x1b[0m ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  });

/** API key env var required per provider. Null means no key needed. */
const PROVIDER_KEY_VARS: Record<string, string | null> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  ollama: null,
  minimax: "MINIMAX_API_KEY",
};

/** Exit with a helpful message if the selected provider's API key is missing. */
function requireProvider(): void {
  const provider = process.env.LLMWIKI_PROVIDER ?? DEFAULT_PROVIDER;

  if (provider === "anthropic") {
    const auth = resolveAnthropicAuthFromEnv();
    if (!auth.apiKey && !auth.authToken) {
      console.error(
        `\x1b[31mError:\x1b[0m Anthropic credentials are required for the "anthropic" provider.\n` +
          `  Set one of: export ANTHROPIC_API_KEY=<your-key> OR export ANTHROPIC_AUTH_TOKEN=<your-token>`,
      );
      process.exit(1);
    }
    return;
  }

  const keyVar = PROVIDER_KEY_VARS[provider];

  if (keyVar === undefined) {
    console.error(
      `\x1b[31mError:\x1b[0m Unknown provider "${provider}".\n` +
        `  Supported: ${Object.keys(PROVIDER_KEY_VARS).join(", ")}`,
    );
    process.exit(1);
  }

  if (keyVar && !process.env[keyVar]) {
    console.error(
      `\x1b[31mError:\x1b[0m ${keyVar} environment variable is required for the "${provider}" provider.\n` +
        `  Set it with: export ${keyVar}=<your-key>`,
    );
    process.exit(1);
  }
}

program.parse();
