/**
 * Adapter registry and auto-detection for session files.
 *
 * `detectAdapter` probes a file against each registered adapter in priority
 * order and returns the first match. New adapters are added to `ADAPTERS`.
 */

import type { SessionAdapter, NormalizedSession } from "./types.js";
import { claudeAdapter } from "./claude.js";
import { codexAdapter } from "./codex.js";
import { cursorAdapter } from "./cursor.js";

/** All registered session adapters, checked in order during detection. */
export const ADAPTERS: SessionAdapter[] = [claudeAdapter, codexAdapter, cursorAdapter];

/**
 * Probe `filePath` against each adapter and return the first match.
 * Returns `null` when no adapter recognises the file.
 */
export async function detectAdapter(filePath: string): Promise<SessionAdapter | null> {
  for (const adapter of ADAPTERS) {
    if (await adapter.detect(filePath)) return adapter;
  }
  return null;
}

/**
 * Parse a session file using automatic adapter detection.
 *
 * After parsing, requires the session to contain at least one user or
 * assistant turn with non-empty content. Detection is intentionally
 * shape-based and lenient (file extension + first-line/JSON-shape match)
 * to avoid false-negatives on slightly-malformed-but-intelligible
 * exports — but a "recognised-looking" file with zero valid turns is
 * almost always a corrupted or empty export and should fail loudly,
 * not import as a content-free `sources/` page.
 *
 * @throws When no adapter recognises the file, the file is malformed,
 *   or the parsed session has no usable turns.
 */
export async function parseSessionFile(filePath: string): Promise<NormalizedSession> {
  const adapter = await detectAdapter(filePath);
  if (!adapter) {
    throw new Error(
      `No session adapter recognised the file: ${filePath}\n` +
        `Supported formats: ${ADAPTERS.map((a) => a.name).join(", ")}`
    );
  }
  const session = await adapter.parse(filePath);
  assertSessionHasUsableTurns(session, filePath);
  return session;
}

/**
 * Reject sessions where every adapter-side filter dropped the input —
 * shape-based detection passed, but no usable user/assistant turn
 * survived. Throws with an actionable error rather than producing a
 * markdown file with "No conversation turns found".
 */
function assertSessionHasUsableTurns(session: NormalizedSession, filePath: string): void {
  const hasUsableTurn = session.turns.some(
    (t) => (t.role === "user" || t.role === "assistant") && t.content.trim().length > 0,
  );
  if (!hasUsableTurn) {
    throw new Error(
      `${session.adapter} session has no usable turns: ${filePath}\n` +
        `The file matches the ${session.adapter} export shape, but no user or ` +
        `assistant message with content was found. Re-export the session or ` +
        `delete the file if it is empty.`,
    );
  }
}

/**
 * Format a normalised session as a markdown document body.
 * Each turn is rendered as a level-3 heading plus the turn's content.
 *
 * Note: callers should obtain `session` via {@link parseSessionFile},
 * which enforces ≥1 usable turn. Direct construction with an empty
 * turns array would render as nothing — there is no fallback line
 * because the empty case should fail before reaching here.
 */
export function formatSessionAsMarkdown(session: NormalizedSession): string {
  const lines: string[] = [];

  for (const turn of session.turns) {
    const label = turn.role === "user" ? "User" : session.participantIdentity ?? "Assistant";
    const heading = turn.timestamp
      ? `### ${label} _(${turn.timestamp})_`
      : `### ${label}`;
    lines.push(heading);
    lines.push("");
    lines.push(turn.content);
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}
