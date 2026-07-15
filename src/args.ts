/**
 * CLI argument parsing, kept separate from the executable entry (cli.ts) so
 * the parsing behavior can be unit-tested without running the CLI itself.
 */
import { parseArgs } from "node:util";

const options = {
  "from-file": { type: "string" },
  lang: { type: "string" },
  "manual-only": { type: "boolean", default: false },
  "auto-only": { type: "boolean", default: false },
  translate: { type: "string" },
  format: { type: "string" },
  timestamps: { type: "boolean", default: false },
  chapters: { type: "boolean", default: false },
  "max-chars": { type: "string" },
  "out-dir": { type: "string" },
  "no-header": { type: "boolean", default: false },
  proxy: { type: "string" },
  list: { type: "boolean", default: false },
  concurrency: { type: "string" },
  "yt-dlp": { type: "string" },
  help: { type: "boolean", short: "h", default: false },
  version: { type: "boolean", short: "v", default: false },
} as const;

/**
 * Parse the CLI arguments (process.argv minus the node/script prefix).
 * All flags, including -h/--help and -v/--version, are recognized in any
 * position. Throws on unknown options (parseArgs runs in strict mode).
 */
export function parseCliArgs(argv: string[]) {
  return parseArgs({ args: argv, allowPositionals: true, options });
}
