/**
 * ytsum — public API.
 * Fetch YouTube subtitles/transcripts (via yt-dlp) and emit clean,
 * LLM-ready text. yt-dlp does all the networking; ytsum orchestrates it,
 * parses the downloaded subtitles, and formats the output.
 */
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractVideoId } from "./ids.js";
import { parseJson3, parseVtt, type Segment } from "./parse.js";
import { type VideoMeta } from "./render.js";
import {
  assertYtDlp,
  downloadSubs,
  fetchInfo,
  pickTrack,
  type SubtitlePolicy,
  type VideoInfo,
} from "./ytdlp.js";

export { extractVideoId, isVideoId } from "./ids.js";
export { parseJson3, parseVtt, type Segment } from "./parse.js";
export {
  toPlainText,
  toSrt,
  toVtt,
  toJson,
  renderHeader,
  dedupeSegments,
  formatClock,
  formatSrtTime,
  formatVttTime,
  type VideoMeta,
  type PlainTextOptions,
} from "./render.js";
export {
  buildInfoArgs,
  buildSubsArgs,
  pickTrack,
  assertYtDlp,
  fetchInfo,
  downloadSubs,
  type VideoInfo,
  type SubTrack,
  type SubtitlePolicy,
  type PickedTrack,
} from "./ytdlp.js";

/** Available subtitle tracks for a video, split by kind, as `--list` reports. */
export interface TrackListing {
  meta: Pick<VideoMeta, "id" | "title" | "url">;
  manual: string[];
  auto: string[];
}

export interface FetchOptions {
  /** Preferred languages, in priority order. Default ["ja", "en"]. */
  langs?: string[];
  /** Manual/auto selection policy. Default "prefer-manual". */
  policy?: SubtitlePolicy;
  /** Proxy URL passed through to yt-dlp. */
  proxy?: string;
  /** Path to the yt-dlp binary. Default "yt-dlp". */
  ytDlpPath?: string;
}

/** A fetched transcript: the chosen track's segments plus video metadata. */
export interface Transcript {
  meta: VideoMeta;
  segments: Segment[];
}

function listLangs(pool: Record<string, unknown> | undefined): string[] {
  return pool ? Object.keys(pool).sort() : [];
}

/** List the subtitle tracks available for a video without downloading them. */
export async function listTracks(
  input: string,
  opts: FetchOptions = {},
): Promise<TrackListing> {
  await assertYtDlp(opts.ytDlpPath);
  const id = extractVideoId(input);
  const url = `https://www.youtube.com/watch?v=${id}`;
  const info = await fetchInfo(url, { proxy: opts.proxy, bin: opts.ytDlpPath });
  return {
    meta: { id: info.id ?? id, title: info.title ?? id, url: info.webpage_url ?? url },
    manual: listLangs(info.subtitles),
    auto: listLangs(info.automatic_captions),
  };
}

/**
 * Fetch a transcript for a single video. Discovers tracks via yt-dlp, picks a
 * language/kind by policy, downloads just that subtitle into a temp dir,
 * parses it, and returns timed segments. The temp dir is always cleaned up.
 */
export async function fetchTranscript(
  input: string,
  opts: FetchOptions = {},
): Promise<Transcript> {
  await assertYtDlp(opts.ytDlpPath);

  const langs = opts.langs ?? ["ja", "en"];
  const policy = opts.policy ?? "prefer-manual";
  const id = extractVideoId(input);
  const url = `https://www.youtube.com/watch?v=${id}`;

  const info = await fetchInfo(url, { proxy: opts.proxy, bin: opts.ytDlpPath });
  const picked = pickTrack(info, langs, policy);
  if (!picked) {
    throw new Error(
      `no subtitles found for ${id} matching langs [${langs.join(", ")}] ` +
        `(policy: ${policy})`,
    );
  }

  const segments = await downloadAndParse(url, info, picked.lang, picked.isAuto, opts);

  return {
    meta: {
      id: info.id ?? id,
      title: info.title ?? id,
      url: info.webpage_url ?? url,
      lang: picked.lang,
      isAuto: picked.isAuto,
    },
    segments,
  };
}

/** Download the chosen subtitle into a temp dir, read it, and parse it. */
async function downloadAndParse(
  url: string,
  info: VideoInfo,
  lang: string,
  isAuto: boolean,
  opts: FetchOptions,
): Promise<Segment[]> {
  const dir = await mkdtemp(join(tmpdir(), "ytsum-"));
  try {
    await downloadSubs({
      url,
      lang,
      isAuto,
      outTemplate: join(dir, "%(id)s.%(ext)s"),
      proxy: opts.proxy,
      bin: opts.ytDlpPath,
    });

    const files = await readdir(dir);
    const id = info.id;
    // yt-dlp names the file "<id>.<lang>.<ext>". Prefer the file for the chosen
    // language, then any json3, then any vtt, so a stray sibling file (e.g. an
    // "en-US" variant) does not get picked over the requested one.
    const json3 =
      files.find((f) => f.endsWith(`.${lang}.json3`)) ??
      files.find((f) => f.endsWith(".json3"));
    const vtt =
      files.find((f) => f.endsWith(`.${lang}.vtt`)) ??
      files.find((f) => f.endsWith(".vtt"));

    if (json3) {
      const text = await readFile(join(dir, json3), "utf8");
      return parseJson3(text);
    }
    if (vtt) {
      const text = await readFile(join(dir, vtt), "utf8");
      return parseVtt(text);
    }
    throw new Error(
      `yt-dlp produced no subtitle file for ${id} (lang: ${lang}, ` +
        `${isAuto ? "auto" : "manual"})`,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
