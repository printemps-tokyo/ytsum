#!/usr/bin/env node
import { parseArgs } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  fetchTranscript,
  listTracks,
  mapLimit,
  renderHeader,
  toJson,
  toPlainText,
  toSrt,
  toVtt,
  type FetchOptions,
  type SubtitlePolicy,
  type Transcript,
} from "./index.js";

const HELP = `ytsum - fetch YouTube transcripts (via yt-dlp) as clean LLM-ready text

Usage:
  ytsum [options] <url-or-id...>

Fetches subtitles/transcripts for one or more YouTube videos by wrapping the
external yt-dlp tool, then emits clean transcript text you can paste into a
summarizer. yt-dlp handles all networking (and any proxy / block-evasion).

Inputs:
  A YouTube URL or bare 11-character video id. Multiple inputs are allowed.
  Supported URLs: youtu.be/<id>, youtube.com/watch?v=<id>, /shorts/<id>,
  /embed/<id>, /live/<id>.

Options:
  --from-file <file>   Read inputs (one URL/id per line; blank lines and lines
                       starting with # are ignored)
  --lang <list>        Preferred languages, comma-separated, in priority order
                       (default "ja,en")
  --manual-only        Only use human-authored subtitles
  --auto-only          Only use auto-generated captions
                       (default: prefer manual, fall back to auto)
  --format <fmt>       Output format: text | srt | vtt | json (default text)
  --timestamps         In text format, prefix each line with [mm:ss]
  --out-dir <dir>      Write one file per video named "<id>.<ext>"
                       (default: write to stdout)
  --no-header          Omit the per-video header (title / url / lang)
  --proxy <url>        Pass through to yt-dlp's --proxy. Without it, the
                       HTTPS_PROXY / HTTP_PROXY env vars are honored.
  --list               List available subtitle tracks per video, no download
  --concurrency <n>    Fetch up to n videos in parallel (default 1)
  --yt-dlp <path>      Path to the yt-dlp binary (default "yt-dlp")
  -h, --help           Show this help
  -v, --version        Show version

Examples:
  ytsum https://youtu.be/dQw4w9WgXcQ
  ytsum --lang en,ja --format srt dQw4w9WgXcQ
  ytsum --from-file ids.txt --out-dir transcripts
  ytsum --auto-only --timestamps dQw4w9WgXcQ
  ytsum --proxy http://127.0.0.1:8080 dQw4w9WgXcQ
  ytsum --list dQw4w9WgXcQ
`;

const FORMATS = new Set(["text", "srt", "vtt", "json"]);
const EXT: Record<string, string> = {
  text: "txt",
  srt: "srt",
  vtt: "vtt",
  json: "json",
};

async function readFromFile(path: string): Promise<string[]> {
  const raw = await readFile(path, "utf8");
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));
}

function render(format: string, t: Transcript, timestamps: boolean): string {
  switch (format) {
    case "srt":
      return toSrt(t.segments);
    case "vtt":
      return toVtt(t.segments);
    case "json":
      return toJson(t.meta, t.segments);
    default:
      return toPlainText(t.segments, { timestamps });
  }
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);

  if (argv[0] === "-h" || argv[0] === "--help") {
    process.stdout.write(HELP);
    return 0;
  }
  if (argv[0] === "-v" || argv[0] === "--version") {
    process.stdout.write((await readVersion()) + "\n");
    return 0;
  }

  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      "from-file": { type: "string" },
      lang: { type: "string" },
      "manual-only": { type: "boolean", default: false },
      "auto-only": { type: "boolean", default: false },
      format: { type: "string" },
      timestamps: { type: "boolean", default: false },
      "out-dir": { type: "string" },
      "no-header": { type: "boolean", default: false },
      proxy: { type: "string" },
      list: { type: "boolean", default: false },
      concurrency: { type: "string" },
      "yt-dlp": { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help) {
    process.stdout.write(HELP);
    return 0;
  }

  // Gather inputs from positionals and/or --from-file.
  const inputs = [...positionals];
  if (values["from-file"]) {
    try {
      inputs.push(...(await readFromFile(values["from-file"])));
    } catch (err) {
      process.stderr.write(
        `error: could not read --from-file "${values["from-file"]}": ${(err as Error).message}\n`,
      );
      return 1;
    }
  }

  if (inputs.length === 0) {
    process.stderr.write("error: no inputs (pass a URL/id or --from-file)\n\n" + HELP);
    return 1;
  }

  if (values["manual-only"] && values["auto-only"]) {
    process.stderr.write("error: --manual-only and --auto-only are mutually exclusive\n");
    return 1;
  }

  const format = values.format ?? "text";
  if (!FORMATS.has(format)) {
    process.stderr.write(
      `error: --format must be one of text, srt, vtt, json (got "${format}")\n`,
    );
    return 1;
  }

  const langs = (values.lang ?? "ja,en")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  if (langs.length === 0) {
    process.stderr.write("error: --lang must list at least one language\n");
    return 1;
  }

  const policy: SubtitlePolicy = values["manual-only"]
    ? "manual-only"
    : values["auto-only"]
      ? "auto-only"
      : "prefer-manual";

  // Honor HTTPS_PROXY / HTTP_PROXY when --proxy is absent.
  const proxy =
    values.proxy ?? process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY ?? undefined;

  const opts: FetchOptions = {
    langs,
    policy,
    proxy,
    ytDlpPath: values["yt-dlp"],
  };

  let concurrency = 1;
  if (values.concurrency !== undefined) {
    const n = Number(values.concurrency);
    if (!Number.isInteger(n) || n < 1) {
      process.stderr.write("error: --concurrency must be a positive integer\n");
      return 1;
    }
    concurrency = n;
  }

  if (values.list) {
    return runList(inputs, opts);
  }

  const outDir = values["out-dir"];
  if (outDir) {
    await mkdir(outDir, { recursive: true });
  }
  const header = !values["no-header"];

  // Fetch (and write, when --out-dir) each input with bounded concurrency.
  // For stdout we collect rendered bodies and emit them in input order so the
  // output stays deterministic regardless of which fetch finishes first.
  type Item = { input: string; ok: boolean; out?: string; error?: string };
  const fetched = await mapLimit(inputs, concurrency, async (input): Promise<Item> => {
    try {
      const t = await fetchTranscript(input, opts);
      const body = render(format, t, Boolean(values.timestamps));
      if (outDir) {
        const ext = EXT[format] as string;
        const path = join(outDir, `${t.meta.id}.${ext}`);
        const content =
          header && format === "text" ? renderHeader(t.meta) + body + "\n" : body + "\n";
        await writeFile(path, content, "utf8");
        process.stderr.write(`${input} -> ${path}\n`);
        return { input, ok: true };
      }
      const out = header && format === "text" ? renderHeader(t.meta) + body : body;
      return { input, ok: true, out };
    } catch (err) {
      process.stderr.write(`error: ${input}: ${(err as Error).message}\n`);
      return { input, ok: false, error: (err as Error).message };
    }
  });

  if (!outDir) {
    let first = true;
    for (const item of fetched) {
      if (item.out === undefined) continue;
      if (!first) process.stdout.write("\n");
      process.stdout.write(item.out + "\n");
      first = false;
    }
  }

  return fetched.some((r) => !r.ok) ? 1 : 0;
}

async function runList(inputs: string[], opts: FetchOptions): Promise<number> {
  let failed = 0;
  for (const input of inputs) {
    try {
      const listing = await listTracks(input, opts);
      process.stdout.write(`# ${listing.meta.title}\n# ${listing.meta.url}\n`);
      process.stdout.write(
        `  manual: ${listing.manual.length > 0 ? listing.manual.join(", ") : "(none)"}\n`,
      );
      process.stdout.write(
        `  auto:   ${listing.auto.length > 0 ? listing.auto.join(", ") : "(none)"}\n`,
      );
    } catch (err) {
      failed++;
      process.stderr.write(`error: ${input}: ${(err as Error).message}\n`);
    }
  }
  return failed > 0 ? 1 : 0;
}

async function readVersion(): Promise<string> {
  const { fileURLToPath } = await import("node:url");
  const { dirname, join: pjoin } = await import("node:path");
  const here = dirname(fileURLToPath(import.meta.url));
  try {
    const raw = await readFile(pjoin(here, "..", "package.json"), "utf8");
    return (JSON.parse(raw) as { version: string }).version;
  } catch {
    return "0.0.0";
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`fatal: ${(err as Error).message}\n`);
    process.exit(1);
  });
