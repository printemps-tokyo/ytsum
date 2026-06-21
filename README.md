# ytsum

> Fetch YouTube transcripts (via yt-dlp) as clean LLM-ready text. Zero-dependency CLI.

[![CI](https://github.com/printemps-tokyo/ytsum/actions/workflows/ci.yml/badge.svg)](https://github.com/printemps-tokyo/ytsum/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

`ytsum` fetches subtitles/transcripts for one or more YouTube videos by wrapping
the external [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) tool, then emits clean
transcript text you can paste straight into a summarizer. yt-dlp does all the
networking (and any proxy / block-evasion); ytsum orchestrates it, parses the
downloaded subtitles, and formats the output. This mirrors how the sibling
[`vshrink`](https://github.com/printemps-tokyo/vshrink) wraps `ffmpeg`.

## Why

To summarize a YouTube video with an LLM you first need its transcript. The raw
caption files are noisy: timing tags, styling tags, and (for auto-generated
captions) the same line repeated as it grows token-by-token. `ytsum` strips all
of that and returns readable text, with an optional header that tells the LLM
the title, URL, and language.

## Requirements

- Node.js >= 20
- [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) on your `PATH`
  (macOS: `brew install yt-dlp`). yt-dlp handles all networking and blocks.

## Install

Not published to npm yet — install from source:

```bash
git clone https://github.com/printemps-tokyo/ytsum
cd ytsum
npm install && npm run build
npm link   # optional: puts the `ytsum` command on your PATH
```

Then run `ytsum …` (after `npm link`), or `node dist/cli.js …` from the clone.

## Usage

```bash
ytsum [options] <url-or-id...>
```

Inputs are YouTube URLs or bare 11-character video ids. Supported URL forms:
`youtu.be/<id>`, `youtube.com/watch?v=<id>`, `/shorts/<id>`, `/embed/<id>`,
`/live/<id>`.

```bash
# Single video -> stdout (with header)
ytsum https://youtu.be/dQw4w9WgXcQ

# Several videos from a file (one URL/id per line; # and blanks ignored)
ytsum --from-file ids.txt

# Pick languages, in priority order
ytsum --lang en,ja dQw4w9WgXcQ

# Emit SubRip instead of plain text
ytsum --format srt dQw4w9WgXcQ

# Write one file per video into a directory (<id>.txt / .srt / .vtt / .json)
ytsum --from-file ids.txt --out-dir transcripts

# Add inline [mm:ss] timestamps to the text output
ytsum --timestamps dQw4w9WgXcQ

# Route yt-dlp through a proxy
ytsum --proxy http://127.0.0.1:8080 dQw4w9WgXcQ

# Just list what subtitle tracks exist, without downloading
ytsum --list dQw4w9WgXcQ
```

A per-video header is printed by default (it helps the LLM):

```
# Never Gonna Give You Up
# https://www.youtube.com/watch?v=dQw4w9WgXcQ  (lang: en, manual)

We're no strangers to love
You know the rules and so do I
...
```

## Options

| Option | Description |
| --- | --- |
| `--from-file <file>` | Read inputs (one URL/id per line; blank lines and `#` comments ignored) |
| `--lang <list>` | Preferred languages, comma-separated, in priority order (default `ja,en`) |
| `--manual-only` | Only use human-authored subtitles |
| `--auto-only` | Only use auto-generated captions |
| `--translate <lang>` | Fetch YouTube's auto-translated captions in `<lang>` (implies auto-only) |
| `--format <fmt>` | Output format: `text`, `srt`, `vtt`, `json` (default `text`) |
| `--timestamps` | In text format, prefix each line with `[mm:ss]` |
| `--chapters` | In text format, insert `## <chapter>` headings (when the video has chapters) |
| `--max-chars <n>` | Truncate text output to about `n` characters (cut at a line boundary) |
| `--out-dir <dir>` | Write one file per video named `<id>.<ext>` (default: stdout) |
| `--no-header` | Omit the per-video header (title / url / lang) |
| `--proxy <url>` | Pass through to yt-dlp's `--proxy` |
| `--list` | List available subtitle tracks per video, without downloading |
| `--concurrency <n>` | Fetch up to n videos in parallel (default 1) |
| `--yt-dlp <path>` | Path to the yt-dlp binary (default `yt-dlp`) |
| `-h, --help` | Show help |
| `-v, --version` | Show version |

## Notes

- **Manual vs auto policy.** By default `ytsum` prefers human-authored subtitles
  and falls back to auto-generated captions only when no preferred language has a
  manual track. `--manual-only` and `--auto-only` force one or the other (they are
  mutually exclusive). Within the eligible set, the first `--lang` that exists
  wins.
- **Auto-caption dedupe.** Auto-generated captions emit rolling, overlapping
  cues (each line repeated as it grows). All output formats collapse that
  redundancy so the result reads cleanly.
- **Proxy / env.** When `--proxy` is absent, the `HTTPS_PROXY` / `HTTP_PROXY`
  environment variables are honored and threaded into yt-dlp.
- **Networking.** ytsum never touches the network itself; `yt-dlp` performs all
  fetching, proxying, and block-evasion. Keep yt-dlp updated if YouTube changes.

## Programmatic API

```ts
import {
  fetchTranscript,
  listTracks,
  toPlainText,
  toSrt,
} from "@printemps-tokyo/ytsum";

const t = await fetchTranscript("https://youtu.be/dQw4w9WgXcQ", {
  langs: ["en", "ja"],
  policy: "prefer-manual",
});
console.log(t.meta.title, t.meta.lang);
console.log(toPlainText(t.segments, { timestamps: true }));
console.log(toSrt(t.segments));

const tracks = await listTracks("dQw4w9WgXcQ");
console.log(tracks.manual, tracks.auto);
```

## License

[MIT](./LICENSE) (c) printemps.tokyo
