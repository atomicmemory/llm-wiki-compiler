/**
 * Commander actions for `llmwiki schema` subcommands.
 *
 * Exposes two operations:
 * - `schema init` writes a starter schema file seeded with sensible defaults
 *   so users can customise page kinds and cross-link minimums without
 *   hand-rolling the format.
 * - `schema show` prints the resolved schema a project would use, including
 *   which file (if any) it was loaded from — helpful for debugging.
 */

import { existsSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import * as output from "../utils/output.js";
import {
  buildDefaultSchema,
  defaultSchemaInitPath,
  loadSchema,
  serializeSchemaToYaml,
} from "../schema/index.js";

/**
 * Write a starter schema file to `.llmwiki/schema.json` under the project root.
 * Refuses to overwrite an existing file so `schema init` is safe to re-run.
 */
export async function schemaInitCommand(): Promise<void> {
  const root = process.cwd();
  const defaults = buildDefaultSchema();
  const targetPath = defaultSchemaInitPath(root);

  if (existsSync(targetPath)) {
    output.status("!", output.warn(`Schema file already exists at ${targetPath}`));
    return;
  }

  await mkdir(path.dirname(targetPath), { recursive: true });
  const serializable = {
    version: defaults.version,
    defaultKind: defaults.defaultKind,
    kinds: defaults.kinds,
    seedPages: defaults.seedPages,
  };
  await writeFile(targetPath, `${JSON.stringify(serializable, null, 2)}\n`, "utf-8");
  output.status("+", output.success(`Wrote schema to ${targetPath}`));
}

/**
 * Print the resolved schema for the current project, showing defaults and
 * whichever file (if any) supplied overrides.
 */
export async function schemaShowCommand(): Promise<void> {
  const schema = await loadSchema(process.cwd());
  const loadedFrom = schema.loadedFrom ?? "(defaults — no schema file found)";
  output.header(`Schema (${loadedFrom})`);
  console.log(serializeSchemaToYaml(schema));
}
