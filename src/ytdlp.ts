/**
 * Thin wrapper around the external `yt-dlp` CLI. yt-dlp does all the
 * networking (and proxying / block-evasion); this module only builds its
 * arguments, runs it, and parses what it produces. The argument-building and
 * track-selection logic are pure functions so they are unit-testable without
 * ever invoking yt-dlp.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pexecFile = promisify(execFile);

/** A single subtitle track advertised by yt-dlp. */
export interface SubTrack {
  ext: string;
  url?: string;
  name?: string;
}

/** The subset of yt-dlp's `-J` info JSON that ytsum consumes. */
export interface VideoInfo {
  id: string;
  title: string;
  webpage_url: string;
  /** Human-authored subtitle tracks, keyed by language. */
  subtitles?: Record<string, SubTrack[]>;
  /** Auto-generated caption tracks, keyed by language. */
  automatic_captions?: Record<string, SubTrack[]>;
  /** Video chapters, when the video defines them. */
  chapters?: Array<{ start_time?: number; title?: string }>;
}

/** How to choose between human-authored and auto-generated tracks. */
export type SubtitlePolicy = "prefer-manual" | "manual-only" | "auto-only";

export interface PickedTrack {
  lang: string;
  isAuto: boolean;
}

export interface ProxyOptions {
  /** Explicit proxy URL passed through to yt-dlp's --proxy. */
  proxy?: string;
}

export interface SubsArgsOptions extends ProxyOptions {
  url: string;
  lang: string;
  isAuto: boolean;
  /** yt-dlp -o output template, e.g. "/tmp/x/%(id)s.%(ext)s". */
  outTemplate: string;
}

/**
 * Build the args for the "discover available tracks" invocation:
 * `yt-dlp -J --no-playlist --skip-download [--proxy P] <url>`.
 */
export function buildInfoArgs(url: string, opts: ProxyOptions = {}): string[] {
  const args = ["-J", "--no-playlist", "--skip-download"];
  if (opts.proxy) {
    args.push("--proxy", opts.proxy);
  }
  args.push(url);
  return args;
}

/**
 * Build the args that download a single chosen subtitle track into the output
 * template, in json3 format with a vtt fallback. Manual tracks use
 * `--write-subs`; auto-generated tracks use `--write-auto-subs`.
 */
export function buildSubsArgs(opts: SubsArgsOptions): string[] {
  const args = [
    "--skip-download",
    "--no-playlist",
    "--sub-langs",
    opts.lang,
    "--sub-format",
    "json3/vtt/best",
    opts.isAuto ? "--write-auto-subs" : "--write-subs",
    "-o",
    opts.outTemplate,
  ];
  if (opts.proxy) {
    args.push("--proxy", opts.proxy);
  }
  args.push(opts.url);
  return args;
}

/**
 * Choose a track given the user's language priority list and the manual/auto
 * policy. Within the eligible track sets, the first language in `langPrefs`
 * that exists wins; manual is preferred over auto under "prefer-manual".
 * Returns null when nothing matches.
 */
export function pickTrack(
  info: VideoInfo,
  langPrefs: string[],
  policy: SubtitlePolicy,
): PickedTrack | null {
  const manual = info.subtitles ?? {};
  const auto = info.automatic_captions ?? {};

  const tryLangs = (
    pool: Record<string, SubTrack[]>,
    isAuto: boolean,
  ): PickedTrack | null => {
    for (const lang of langPrefs) {
      const list = pool[lang];
      if (list && list.length > 0) {
        return { lang, isAuto };
      }
    }
    return null;
  };

  if (policy === "manual-only") {
    return tryLangs(manual, false);
  }
  if (policy === "auto-only") {
    return tryLangs(auto, true);
  }
  // prefer-manual: try manual for every preferred lang first, then auto.
  return tryLangs(manual, false) ?? tryLangs(auto, true);
}

/** Throw a friendly, actionable error if yt-dlp is not on PATH. */
export async function assertYtDlp(bin = "yt-dlp"): Promise<void> {
  try {
    await pexecFile(bin, ["--version"]);
  } catch {
    throw new Error(
      "yt-dlp not found; install it: https://github.com/yt-dlp/yt-dlp",
    );
  }
}

/** Run `yt-dlp -J ...` and parse the info JSON for a single video. */
export async function fetchInfo(
  url: string,
  opts: ProxyOptions & { bin?: string } = {},
): Promise<VideoInfo> {
  const bin = opts.bin ?? "yt-dlp";
  const { stdout } = await pexecFile(bin, buildInfoArgs(url, opts), {
    maxBuffer: 64 * 1024 * 1024,
  });
  let data: VideoInfo;
  try {
    data = JSON.parse(stdout) as VideoInfo;
  } catch {
    throw new Error(`could not parse yt-dlp info JSON for "${url}"`);
  }
  return data;
}

/**
 * Download the chosen subtitle track via yt-dlp into the given output
 * template's directory. Returns yt-dlp's combined stdout/stderr for diagnostics.
 */
export async function downloadSubs(
  opts: SubsArgsOptions & { bin?: string },
): Promise<void> {
  const bin = opts.bin ?? "yt-dlp";
  await pexecFile(bin, buildSubsArgs(opts), { maxBuffer: 64 * 1024 * 1024 });
}
