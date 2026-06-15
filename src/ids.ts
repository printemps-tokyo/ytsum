/**
 * Pure helpers for resolving a user-supplied input (URL or bare id) into a
 * YouTube video id. Kept side-effect-free so the parsing rules are easy to
 * unit test.
 */

/** A YouTube video id is exactly 11 characters of [A-Za-z0-9_-]. */
const ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** True when the input is already a bare 11-character video id. */
export function isVideoId(input: string): boolean {
  return ID_RE.test(input);
}

/**
 * Extract the 11-character video id from a YouTube URL or a bare id.
 *
 * Supported forms:
 *   - a bare 11-char id (e.g. "dQw4w9WgXcQ")
 *   - https://youtu.be/<id>
 *   - https://www.youtube.com/watch?v=<id>&...
 *   - https://www.youtube.com/shorts/<id>
 *   - https://www.youtube.com/embed/<id>
 *   - https://www.youtube.com/live/<id>
 *
 * Throws on anything it cannot recognize.
 */
export function extractVideoId(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "") {
    throw new Error("empty input: expected a YouTube URL or 11-character id");
  }

  // Bare id.
  if (isVideoId(trimmed)) {
    return trimmed;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`could not parse a YouTube video id from "${input}"`);
  }

  const host = url.hostname.replace(/^www\./, "").toLowerCase();

  // youtu.be/<id>
  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0];
    if (id && isVideoId(id)) return id;
  }

  if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    // watch?v=<id>
    const v = url.searchParams.get("v");
    if (v && isVideoId(v)) return v;

    // /shorts/<id>, /embed/<id>, /live/<id>, /v/<id>
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length >= 2 && ["shorts", "embed", "live", "v"].includes(parts[0] as string)) {
      const id = parts[1] as string;
      if (isVideoId(id)) return id;
    }
  }

  throw new Error(`could not parse a YouTube video id from "${input}"`);
}
