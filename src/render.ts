/**
 * Pure renderers that turn normalized segments into the output formats ytsum
 * emits: plain text, SRT, WebVTT, and JSON. Auto-generated captions emit
 * rolling, overlapping cues; these renderers collapse that redundancy so the
 * result reads cleanly and is friendly to paste into an LLM.
 */
import type { Segment } from "./parse.js";

export interface VideoMeta {
  id: string;
  title: string;
  url: string;
  lang: string;
  /** True when the chosen track was auto-generated rather than human-authored. */
  isAuto: boolean;
}

export interface PlainTextOptions {
  /** Prefix each line with a "[mm:ss] " timestamp. */
  timestamps?: boolean;
}

/**
 * Collapse the rolling duplicates that auto-captions produce, where each cue
 * repeats the previous line and appends a few more words. Comparison is
 * case-insensitive against the previously emitted line:
 *   - exact repeat            -> drop the duplicate
 *   - current grew from prev  -> replace prev with the longer current
 *     (prev is a prefix of current)
 *   - current is a shorter prefix of prev (stale) -> drop it
 *   - otherwise               -> keep it (a genuinely new line)
 *
 * Only prefix relationships are collapsed, so a short cue that merely happens
 * to be a substring of an earlier line (e.g. "back" after "...and back") is
 * preserved rather than silently lost.
 */
export function dedupeSegments(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const seg of segments) {
    if (out.length === 0) {
      out.push(seg);
      continue;
    }
    const a = seg.text.toLowerCase();
    const b = (out[out.length - 1] as Segment).text.toLowerCase();
    if (a === b) {
      continue;
    }
    if (a.startsWith(b)) {
      // Rolling caption grew from the previous line: keep the longer version.
      out[out.length - 1] = seg;
      continue;
    }
    if (b.startsWith(a)) {
      // Stale shorter prefix of what we already emitted: skip.
      continue;
    }
    out.push(seg);
  }
  return out;
}

/**
 * Truncate text to at most `maxChars` characters, cutting at a line boundary so
 * a cue is never split mid-line, and appending a one-line note. Returns the
 * text unchanged when it already fits or `maxChars` is not positive.
 */
export function truncateText(text: string, maxChars: number): string {
  if (maxChars <= 0 || text.length <= maxChars) {
    return text;
  }
  const head = text.slice(0, maxChars);
  const cut = head.lastIndexOf("\n");
  const kept = cut > 0 ? head.slice(0, cut) : head;
  return `${kept}\n... (truncated at ${maxChars} characters)`;
}

/** Render segments as readable plain text, one cue per line. */
export function toPlainText(segments: Segment[], opts: PlainTextOptions = {}): string {
  const deduped = dedupeSegments(segments);
  const lines = deduped.map((seg) =>
    opts.timestamps ? `[${formatClock(seg.startMs)}] ${seg.text}` : seg.text,
  );
  return lines.join("\n");
}

/** A video chapter: a start time and a heading title. */
export interface Chapter {
  startMs: number;
  title: string;
}

/**
 * Plain text with chapter headings (`## <title>`) inserted before the first cue
 * at or after each chapter's start. Chapters with no following cue are dropped.
 */
export function toPlainTextWithChapters(
  segments: Segment[],
  chapters: Chapter[],
  opts: PlainTextOptions = {},
): string {
  if (chapters.length === 0) {
    return toPlainText(segments, opts);
  }
  const deduped = dedupeSegments(segments);
  const sorted = [...chapters].sort((a, b) => a.startMs - b.startMs);
  const lines: string[] = [];
  let ci = 0;
  for (const seg of deduped) {
    while (ci < sorted.length && (sorted[ci] as Chapter).startMs <= seg.startMs) {
      lines.push(`## ${(sorted[ci] as Chapter).title}`);
      ci++;
    }
    lines.push(opts.timestamps ? `[${formatClock(seg.startMs)}] ${seg.text}` : seg.text);
  }
  return lines.join("\n");
}

/** Render segments as a SubRip (.srt) document. */
export function toSrt(segments: Segment[]): string {
  const deduped = dedupeSegments(segments);
  const blocks = deduped.map((seg, i) => {
    const start = formatSrtTime(seg.startMs);
    const end = formatSrtTime(seg.startMs + seg.durMs);
    return `${i + 1}\n${start} --> ${end}\n${seg.text}\n`;
  });
  return blocks.join("\n");
}

/** Render segments as a WebVTT (.vtt) document. */
export function toVtt(segments: Segment[]): string {
  const deduped = dedupeSegments(segments);
  const blocks = deduped.map((seg) => {
    const start = formatVttTime(seg.startMs);
    const end = formatVttTime(seg.startMs + seg.durMs);
    return `${start} --> ${end}\n${seg.text}\n`;
  });
  return `WEBVTT\n\n${blocks.join("\n")}`;
}

/** Render the video metadata plus segments as a JSON document. */
export function toJson(meta: VideoMeta, segments: Segment[]): string {
  const deduped = dedupeSegments(segments);
  return (
    JSON.stringify(
      {
        id: meta.id,
        title: meta.title,
        url: meta.url,
        lang: meta.lang,
        kind: meta.isAuto ? "auto" : "manual",
        segments: deduped,
      },
      null,
      2,
    ) + "\n"
  );
}

/** Build the per-video header that precedes a transcript (helps the LLM). */
export function renderHeader(meta: VideoMeta): string {
  const kind = meta.isAuto ? "auto" : "manual";
  return `# ${meta.title}\n# ${meta.url}  (lang: ${meta.lang}, ${kind})\n\n`;
}

/** Format ms as "mm:ss" (or "h:mm:ss" past an hour) for inline text timestamps. */
export function formatClock(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${h}:${pad2(m)}:${pad2(s)}`;
  }
  return `${pad2(m)}:${pad2(s)}`;
}

/** Format ms as a SubRip timestamp: HH:MM:SS,mmm. */
export function formatSrtTime(ms: number): string {
  return `${formatHms(ms)},${pad3(ms % 1000)}`;
}

/** Format ms as a WebVTT timestamp: HH:MM:SS.mmm. */
export function formatVttTime(ms: number): string {
  return `${formatHms(ms)}.${pad3(ms % 1000)}`;
}

function formatHms(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function pad3(n: number): string {
  return String(n).padStart(3, "0");
}
