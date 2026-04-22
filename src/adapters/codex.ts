/**
 * Adapter for OpenAI Codex / ChatGPT session exports.
 *
 * OpenAI's conversation export format (`conversations.json`) is an array of
 * conversation objects. Each conversation contains a `mapping` of nodes, where
 * each node holds a `message` with `author.role` and `content.parts`.
 *
 * Supported schema (as documented in OpenAI's data export):
 * ```json
 * [{ "title": "...", "create_time": 1234, "update_time": 5678,
 *    "mapping": { "<id>": { "message": { "author": { "role": "user" },
 *                            "content": { "parts": ["..."] },
 *                            "create_time": 1234 } } } }]
 * ```
 *
 * When the file contains multiple conversations, only the first is parsed.
 * For bulk import, callers should split the array and pass each element
 * as a separate file (or use the directory bulk-import path).
 */

import { readFile } from "fs/promises";
import path from "path";
import type { SessionAdapter, NormalizedSession, SessionTurn } from "./types.js";
import { resolveSessionTitle, parseJsonOrThrow } from "./utils.js";

const CODEX_EXTENSION = ".json";

interface CodexAuthor {
  role: string;
}

interface CodexContent {
  parts: string[];
}

interface CodexMessage {
  author: CodexAuthor;
  content: CodexContent;
  create_time?: number;
}

interface CodexNode {
  message?: CodexMessage | null;
}

interface CodexConversation {
  title?: string;
  create_time?: number;
  update_time?: number;
  mapping?: Record<string, CodexNode>;
}

/** Convert a Unix timestamp (seconds) to an ISO-8601 string. */
function unixToIso(ts: number): string {
  return new Date(ts * 1000).toISOString();
}

/** Extract conversation turns from the mapping, sorted by create_time. */
function extractTurns(mapping: Record<string, CodexNode>): SessionTurn[] {
  const turns: SessionTurn[] = [];

  for (const node of Object.values(mapping)) {
    const msg = node.message;
    if (!msg) continue;
    const role = msg.author?.role;
    if (role !== "user" && role !== "assistant") continue;
    const content = (msg.content?.parts ?? []).join("\n").trim();
    if (content.length === 0) continue;
    turns.push({
      role,
      content,
      timestamp: msg.create_time != null ? unixToIso(msg.create_time) : undefined,
    });
  }

  // Sort by timestamp when available so turns appear in chronological order.
  turns.sort((a, b) => {
    if (!a.timestamp || !b.timestamp) return 0;
    return a.timestamp.localeCompare(b.timestamp);
  });

  return turns;
}

/** Return true if `value` looks like a Codex conversation export array. */
function isCodexExport(value: unknown): value is CodexConversation[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    typeof (value[0] as CodexConversation).mapping === "object"
  );
}

export const codexAdapter: SessionAdapter = {
  name: "codex",

  async detect(filePath: string): Promise<boolean> {
    if (path.extname(filePath).toLowerCase() !== CODEX_EXTENSION) return false;
    const raw = await readFile(filePath, "utf-8").catch(() => "");
    if (raw.trimStart()[0] !== "[") return false;
    try {
      return isCodexExport(JSON.parse(raw));
    } catch {
      return false;
    }
  },

  async parse(filePath: string): Promise<NormalizedSession> {
    const raw = await readFile(filePath, "utf-8");
    const parsed = parseJsonOrThrow(raw, filePath);

    if (!isCodexExport(parsed)) {
      throw new Error(
        `Codex session file does not contain a conversation array: ${filePath}`
      );
    }

    const conv = parsed[0];
    const turns = extractTurns(conv.mapping ?? {});
    const firstUser = turns.find((t) => t.role === "user");

    return {
      title: resolveSessionTitle(conv.title, firstUser?.content, "Codex Session"),
      adapter: "codex",
      startedAt: conv.create_time != null ? unixToIso(conv.create_time) : undefined,
      endedAt: conv.update_time != null ? unixToIso(conv.update_time) : undefined,
      participantIdentity: "OpenAI Codex",
      turns,
    };
  },
};
