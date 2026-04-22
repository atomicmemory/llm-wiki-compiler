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
 * @throws When no adapter recognises the file or the file is malformed.
 */
export async function parseSessionFile(filePath: string): Promise<NormalizedSession> {
  const adapter = await detectAdapter(filePath);
  if (!adapter) {
    throw new Error(
      `No session adapter recognised the file: ${filePath}\n` +
        `Supported formats: ${ADAPTERS.map((a) => a.name).join(", ")}`
    );
  }
  return adapter.parse(filePath);
}

/**
 * Format a normalised session as a markdown document body.
 * Each turn is rendered as a level-3 heading plus the turn's content.
 */
export function formatSessionAsMarkdown(session: NormalizedSession): string {
  const lines: string[] = [];

  if (session.turns.length === 0) {
    lines.push("_No conversation turns found in this session._");
    return lines.join("\n");
  }

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
