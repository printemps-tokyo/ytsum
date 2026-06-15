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
 * Collapse the rolling duplicates that auto-captions produce. A cue is dropped
 * when its text is equal to, or fully contained in, the previously emitted
 * line (case-insensitive). This keeps the last, most complete version of a
 * line that grows token-by-token across cues.
 */
export function dedupeSegments(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  let prev = "";
  for (const seg of segments) {
    const cur = seg.text;
    const a = cur.toLowerCase();
    const b = prev.toLowerCase();
    if (prev !== "" && (a === b || b.includes(a))) {
      // Current is a (possibly stale) subset of what we already emitted: skip.
      continue;
    }
    if (prev !== "" && a.includes(b)) {
      // Current is a superset that grew from the previous line: replace it.
      out[out.length - 1] = seg;
      prev = cur;
      continue;
    }
    out.push(seg);
    prev = cur;
  }
  return out;
}

/** Render segments as readable plain text, one cue per line. */
export function toPlainText(segments: Segment[], opts: PlainTextOptions = {}): string {
  const deduped = dedupeSegments(segments);
  const lines = deduped.map((seg) =>
    opts.timestamps ? `[${formatClock(seg.startMs)}] ${seg.text}` : seg.text,
  );
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
