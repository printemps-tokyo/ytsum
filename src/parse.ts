/**
 * Pure parsers that turn yt-dlp's downloaded subtitle files into a normalized
 * list of timed segments. Side-effect-free so they can be unit tested against
 * inline fixtures without touching the filesystem or network.
 */

export interface Segment {
  /** Cue start time in milliseconds. */
  startMs: number;
  /** Cue duration in milliseconds. */
  durMs: number;
  /** Cue text (already trimmed; never empty). */
  text: string;
}

interface Json3Event {
  tStartMs?: number;
  dDurationMs?: number;
  segs?: Array<{ utf8?: string }>;
}

/**
 * Parse YouTube's "json3" subtitle format. Each event carries a start time, a
 * duration, and an array of text segments whose `utf8` parts are concatenated.
 * Empty (whitespace-only) cues are dropped.
 */
export function parseJson3(text: string): Segment[] {
  let data: { events?: Json3Event[] };
  try {
    data = JSON.parse(text) as { events?: Json3Event[] };
  } catch {
    throw new Error("could not parse json3 subtitles: invalid JSON");
  }

  const events = data.events ?? [];
  const out: Segment[] = [];
  for (const ev of events) {
    if (!ev.segs) continue;
    const joined = ev.segs.map((s) => s.utf8 ?? "").join("");
    const cue = joined.trim();
    if (cue === "") continue;
    out.push({
      startMs: Math.max(0, Math.round(ev.tStartMs ?? 0)),
      durMs: Math.max(0, Math.round(ev.dDurationMs ?? 0)),
      text: collapseWhitespace(cue),
    });
  }
  return out;
}

// Hours are optional: WebVTT allows both "HH:MM:SS.mmm" and "MM:SS.mmm".
const VTT_TIME_RE =
  /^(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})\s+-->\s+(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})/;

/**
 * Parse a WebVTT subtitle file into segments. Inline timing tags like
 * `<00:00:00.000>` and styling tags like `<c>...</c>` are stripped, and
 * empty cues are dropped.
 */
export function parseVtt(text: string): Segment[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: Segment[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] as string;
    const m = VTT_TIME_RE.exec(line);
    if (!m) {
      i++;
      continue;
    }

    // Groups: [1]=opt start hours, 2=min, 3=sec, 4=ms; [5]=opt end hours, 6-8.
    const g = m as unknown as Array<string | undefined>;
    const startMs = hmsToMs(g[1] ?? "0", g[2]!, g[3]!, g[4]!);
    const endMs = hmsToMs(g[5] ?? "0", g[6]!, g[7]!, g[8]!);

    // Collect the cue payload lines until a blank line.
    i++;
    const payload: string[] = [];
    while (i < lines.length && (lines[i] as string).trim() !== "") {
      payload.push(lines[i] as string);
      i++;
    }

    const cleaned = collapseWhitespace(stripVttTags(payload.join("\n")));
    if (cleaned !== "") {
      out.push({
        startMs,
        durMs: Math.max(0, endMs - startMs),
        text: cleaned,
      });
    }
  }
  return out;
}

/** Strip WebVTT inline timestamp tags (<00:00:00.000>) and styling tags (<c>...</c>, <i>, etc.). */
function stripVttTags(text: string): string {
  return text.replace(/<[^>]*>/g, "");
}

/** Collapse runs of whitespace (including newlines) into single spaces and trim. */
function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function hmsToMs(h: string, m: string, s: string, ms: string): number {
  return (
    Number(h) * 3_600_000 + Number(m) * 60_000 + Number(s) * 1000 + Number(ms)
  );
}
