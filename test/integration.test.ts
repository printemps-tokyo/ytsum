/**
 * Offline end-to-end test of the orchestration pipeline using a STUB yt-dlp.
 *
 * We create a temp dir with an executable `yt-dlp` shell script that:
 *   - for `--version` prints a version,
 *   - for `-J ...` prints a small fixture info JSON,
 *   - for the subs-download invocation writes a fixture `<id>.ja.json3` into
 *     the directory named by the `-o "<dir>/%(id)s.%(ext)s"` template.
 *
 * Then we run the built CLI (dist/cli.js) with `--yt-dlp <stub>` against a fake
 * URL and assert the formatted transcript + header. This verifies the whole
 * pipeline without any network or a real yt-dlp.
 *
 * Requires `npm run build` first (the test self-builds if dist is missing).
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const pexecFile = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const cliPath = join(root, "dist", "cli.js");

const VIDEO_ID = "abc12345678";

// Fixture info JSON the stub emits for `-J`.
const infoJson = JSON.stringify({
  id: VIDEO_ID,
  title: "Stub Video Title",
  webpage_url: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
  subtitles: { ja: [{ ext: "json3" }] },
  automatic_captions: { ja: [{ ext: "json3" }], en: [{ ext: "json3" }] },
});

// Fixture json3 transcript the stub writes for the download invocation.
const transcriptJson3 = JSON.stringify({
  events: [
    { tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: "こんにちは" }] },
    { tStartMs: 2000, dDurationMs: 2000, segs: [{ utf8: "世界" }] },
    { tStartMs: 65_000, dDurationMs: 1000, segs: [{ utf8: "また後で" }] },
  ],
});

let dir: string;
let stub: string;

beforeAll(async () => {
  if (!existsSync(cliPath)) {
    // Self-build so the test is runnable on its own.
    await pexecFile("npm", ["run", "build"], { cwd: root });
  }

  dir = await mkdtemp(join(tmpdir(), "ytsum-it-"));
  stub = join(dir, "yt-dlp");

  // The stub parses just enough of yt-dlp's args. It locates the -o template,
  // derives the output directory, and writes "<id>.ja.json3" there. The info
  // and transcript fixtures are embedded via heredocs.
  const script = `#!/usr/bin/env bash
set -euo pipefail

if [[ "\${1:-}" == "--version" ]]; then
  echo "stub 2024.01.01"
  exit 0
fi

# Discovery: -J ... -> print info JSON.
for a in "$@"; do
  if [[ "$a" == "-J" ]]; then
    cat <<'INFO_EOF'
${infoJson}
INFO_EOF
    exit 0
  fi
done

# Download: find the -o template, derive its directory, write the json3 file.
out=""
prev=""
for a in "$@"; do
  if [[ "$prev" == "-o" ]]; then
    out="$a"
  fi
  prev="$a"
done

if [[ -n "$out" ]]; then
  outdir="$(dirname "$out")"
  cat > "$outdir/${VIDEO_ID}.ja.json3" <<'SUB_EOF'
${transcriptJson3}
SUB_EOF
  exit 0
fi

echo "stub: unrecognized invocation: $*" >&2
exit 1
`;
  await writeFile(stub, script, "utf8");
  await chmod(stub, 0o755);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return pexecFile("node", [cliPath, ...args], {
    env: { ...process.env, HTTPS_PROXY: "", HTTP_PROXY: "" },
  });
}

describe("integration (stub yt-dlp)", () => {
  it("produces header + plain text transcript end-to-end", async () => {
    const { stdout } = await runCli(["--yt-dlp", stub, VIDEO_ID]);
    expect(stdout).toBe(
      `# Stub Video Title\n` +
        `# https://www.youtube.com/watch?v=${VIDEO_ID}  (lang: ja, manual)\n\n` +
        `こんにちは\n世界\nまた後で\n`,
    );
  });

  it("supports --timestamps and --no-header", async () => {
    const { stdout } = await runCli([
      "--yt-dlp",
      stub,
      "--no-header",
      "--timestamps",
      `https://youtu.be/${VIDEO_ID}`,
    ]);
    expect(stdout).toBe("[00:00] こんにちは\n[00:02] 世界\n[01:05] また後で\n");
  });

  it("emits srt", async () => {
    const { stdout } = await runCli([
      "--yt-dlp",
      stub,
      "--no-header",
      "--format",
      "srt",
      VIDEO_ID,
    ]);
    expect(stdout).toContain("1\n00:00:00,000 --> 00:00:02,000\nこんにちは\n");
    expect(stdout).toContain("3\n00:01:05,000 --> 00:01:06,000\nまた後で\n");
  });

  it("--list reports manual and auto tracks", async () => {
    const { stdout } = await runCli(["--yt-dlp", stub, "--list", VIDEO_ID]);
    expect(stdout).toContain("# Stub Video Title");
    expect(stdout).toContain("manual: ja");
    expect(stdout).toContain("auto:   en, ja");
  });

  it("exits non-zero with a clear error when yt-dlp is missing", async () => {
    await expect(
      runCli(["--yt-dlp", "/no/such/yt-dlp-binary", VIDEO_ID]),
    ).rejects.toMatchObject({ code: 1 });
  });
});
