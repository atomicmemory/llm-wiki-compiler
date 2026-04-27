/**
 * Transcript ingestion module.
 *
 * Handles three transcript source types:
 *   1. YouTube URLs — fetched via the youtube-transcript package.
 *   2. WebVTT (.vtt) — speaker/time markers preserved in output.
 *   3. SubRip (.srt) — speaker/time markers preserved in output.
 *   4. Plain-text (.txt) with speaker tags (e.g. "Speaker: text").
 *
 * Speaker and timing metadata are kept in the output so downstream
 * compilation can reference them. Content is returned as markdown.
 */

import { readFile } from "fs/promises";
import path from "path";
import { titleFromFilename, type IngestedSource } from "./shared.js";
// The youtube-transcript@1.3.0 package ships a CJS file as its `main` entry
// while declaring `"type": "module"` in its package.json — the main entry is
// unloadable from native ESM at runtime. Bypass the broken main by importing
// the bundled ESM dist file directly. We attach a local type for the only
// method we use because the deep import path lacks bundled .d.ts.
// @ts-expect-error -- deep import: see comment above.
import { YoutubeTranscript as YoutubeTranscriptUntyped } from "youtube-transcript/dist/youtube-transcript.esm.js";

interface YoutubeTranscriptSegment {
  text: string;
  offset: number;
  duration: number;
}

interface YoutubeTranscriptApi {
  fetchTranscript(videoId: string): Promise<YoutubeTranscriptSegment[]>;
}

const YoutubeTranscript = YoutubeTranscriptUntyped as YoutubeTranscriptApi;

/** Pattern that identifies a YouTube URL. */
const YOUTUBE_URL_PATTERN = /^https?:\/\/(www\.)?(youtube\.com\/watch|youtu\.be\/)/;

/** Pattern for SRT sequence number lines (numeric-only). */
const SRT_SEQUENCE_PATTERN = /^\d+$/;

/** Pattern for SRT/VTT timestamp lines. */
const TIMESTAMP_PATTERN = /\d{2}:\d{2}[:.]\d{2}/;

/** Number of milliseconds in one minute. */
const MS_PER_MINUTE = 60_000;

/** Number of milliseconds in one second. */
const MS_PER_SECOND = 1_000;

/** Check whether a source string is a YouTube URL. */
export function isYoutubeUrl(source: string): boolean {
  return YOUTUBE_URL_PATTERN.test(source);
}

/** Extract the YouTube video ID from a URL. */
function extractVideoId(url: string): string {
  const match = url.match(/(?:v=|youtu\.be\/)([^&?/]+)/);
  if (!match) {
    throw new Error(`Could not extract video ID from YouTube URL: ${url}`);
  }
  return match[1];
}

/** Format a millisecond offset as a "MM:SS" timestamp. */
function formatOffset(offsetMs: number): string {
  const minutes = Math.floor(offsetMs / MS_PER_MINUTE);
  const seconds = Math.floor((offsetMs % MS_PER_MINUTE) / MS_PER_SECOND);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** Fetch and format a YouTube transcript as markdown. */
async function fetchYoutubeTranscript(url: string): Promise<IngestedSource> {
  const videoId = extractVideoId(url);
  const segments = await YoutubeTranscript.fetchTranscript(videoId);

  if (!segments || segments.length === 0) {
    throw new Error(`No transcript available for YouTube video: ${url}`);
  }

  const lines = segments.map((seg) => `[${formatOffset(seg.offset)}] ${seg.text}`);

  return {
    title: `YouTube Transcript ${videoId}`,
    content: lines.join("\n"),
  };
}

/** Decide whether a trimmed line is a VTT/SRT cue timestamp marker. */
function isCueTimestamp(trimmed: string): boolean {
  return TIMESTAMP_PATTERN.test(trimmed) && trimmed.includes("-->");
}

/** Parse a VTT file, preserving speaker cues and timestamps. */
function parseVtt(raw: string, filePath: string): IngestedSource {
  const lines = raw.split("\n");
  const output: string[] = [];
  let inCue = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "WEBVTT" || trimmed === "") {
      inCue = false;
      continue;
    }
    if (isCueTimestamp(trimmed)) {
      output.push(`\n**[${trimmed}]**`);
      inCue = true;
      continue;
    }
    if (inCue && trimmed.length > 0) {
      output.push(trimmed);
    }
  }

  return { title: titleFromFilename(filePath), content: output.join("\n").trim() };
}

/** Parse an SRT file, preserving speaker cues and timestamps. */
function parseSrt(raw: string, filePath: string): IngestedSource {
  const lines = raw.split("\n");
  const output: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "" || SRT_SEQUENCE_PATTERN.test(trimmed)) {
      continue;
    }
    if (isCueTimestamp(trimmed)) {
      output.push(`\n**[${trimmed}]**`);
      continue;
    }
    if (trimmed.length > 0) {
      output.push(trimmed);
    }
  }

  return { title: titleFromFilename(filePath), content: output.join("\n").trim() };
}

/** Parse a plain-text transcript, preserving speaker tags. */
function parsePlainTranscript(raw: string, filePath: string): IngestedSource {
  // Plain .txt transcripts are returned as-is; speaker lines like "Alice: ..."
  // are naturally readable.
  return { title: titleFromFilename(filePath), content: raw.trim() };
}

/**
 * Ingest a transcript source: a YouTube URL or a local .vtt/.srt/.txt file.
 *
 * @param source - YouTube URL or path to a transcript file.
 * @returns Title and markdown-formatted content with speaker/time markers.
 * @throws On network failure, missing transcript, or unsupported file type.
 */
export default async function ingestTranscript(source: string): Promise<IngestedSource> {
  if (isYoutubeUrl(source)) {
    return fetchYoutubeTranscript(source);
  }

  const ext = path.extname(source).toLowerCase();
  const raw = await readFile(source, "utf-8");

  if (ext === ".vtt") return parseVtt(raw, source);
  if (ext === ".srt") return parseSrt(raw, source);
  if (ext === ".txt") return parsePlainTranscript(raw, source);

  throw new Error(
    `Unsupported transcript file type "${ext}". Supported: .vtt, .srt, .txt`,
  );
}
