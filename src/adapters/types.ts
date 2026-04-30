/**
 * Core types for session adapters.
 *
 * Each adapter normalizes a provider-specific export format (Claude, Codex, Cursor)
 * into a `NormalizedSession` so the `ingest-session` command can write a consistent
 * markdown source file regardless of which tool produced the export.
 */

/** A single turn in a session (user prompt or assistant/tool response). */
export interface SessionTurn {
  /** Speaker role — either the human or the AI / tool. */
  role: "user" | "assistant" | "tool";
  /** Markdown-safe content of this turn. */
  content: string;
  /** ISO-8601 timestamp, if the export provides one. */
  timestamp?: string;
}

/** Structured session data produced by any adapter. */
export interface NormalizedSession {
  /** Human-readable title derived from metadata or the first user message. */
  title: string;
  /** Adapter that produced this session (e.g. "claude", "codex", "cursor"). */
  adapter: string;
  /** ISO-8601 timestamp of the earliest recorded turn, if available. */
  startedAt?: string;
  /** ISO-8601 timestamp of the latest recorded turn, if available. */
  endedAt?: string;
  /** Tool or agent identity when the export includes it (e.g. "Claude Code"). */
  participantIdentity?: string;
  /** Ordered list of conversation turns. */
  turns: SessionTurn[];
}

/**
 * Contract that every session adapter must satisfy.
 * Adapters are stateless — each method is a pure transformation of the file.
 */
export interface SessionAdapter {
  /** Short identifier used in source frontmatter (e.g. "claude", "codex", "cursor"). */
  name: string;
  /**
   * Return true if this adapter recognises the file at `filePath`.
   * Implementations should probe extension + first-line content only.
   */
  detect(filePath: string): Promise<boolean>;
  /**
   * Parse the file and return a normalised session.
   * @throws With an actionable message when the file is malformed.
   */
  parse(filePath: string): Promise<NormalizedSession>;
}
