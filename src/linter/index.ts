/**
 * Wiki linter orchestrator.
 *
 * Imports all lint rules, runs them concurrently, and aggregates
 * results into a summary with error/warning/info counts.
 * This is the main entry point for programmatic lint access.
 */

import type { LintResult, LintRule, LintSummary, SchemaAwareLintRule } from "./types.js";
import {
  checkBrokenWikilinks,
  checkOrphanedPages,
  checkMissingSummaries,
  checkDuplicateConcepts,
  checkEmptyPages,
  checkBrokenCitations,
  checkMalformedClaimCitations,
  checkLowConfidencePages,
  checkContradictedPages,
  checkInferredWithoutCitations,
  checkSchemaCrossLinks,
} from "./rules.js";
import { loadSchema } from "../schema/index.js";

/** Rule-only lint checks that don't depend on the schema layer. */
const RULES_WITHOUT_SCHEMA: LintRule[] = [
  checkBrokenWikilinks,
  checkOrphanedPages,
  checkMissingSummaries,
  checkDuplicateConcepts,
  checkEmptyPages,
  checkBrokenCitations,
  checkMalformedClaimCitations,
  checkLowConfidencePages,
  checkContradictedPages,
  checkInferredWithoutCitations,
];

/** Lint rules that need the resolved schema to know per-kind expectations. */
const RULES_WITH_SCHEMA: SchemaAwareLintRule[] = [checkSchemaCrossLinks];

/**
 * Count occurrences of a specific severity level in the results.
 */
function countBySeverity(
  results: LintResult[],
  severity: LintResult["severity"],
): number {
  return results.filter((r) => r.severity === severity).length;
}

/**
 * Run all lint rules concurrently against the wiki at the given root.
 * Loads the project schema (or defaults) so schema-aware rules can enforce
 * per-kind cross-link minimums alongside structural checks.
 * @param root - Absolute path to the project root directory.
 * @returns A summary containing all diagnostics and severity counts.
 */
export async function lint(root: string): Promise<LintSummary> {
  const schema = await loadSchema(root);
  const [plainResults, schemaResults] = await Promise.all([
    Promise.all(RULES_WITHOUT_SCHEMA.map((rule) => rule(root))),
    Promise.all(RULES_WITH_SCHEMA.map((rule) => rule(root, schema))),
  ]);

  const results = [...plainResults.flat(), ...schemaResults.flat()];

  return {
    errors: countBySeverity(results, "error"),
    warnings: countBySeverity(results, "warning"),
    info: countBySeverity(results, "info"),
    results,
  };
}
