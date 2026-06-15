import { describe, expect, it } from "vitest";
import { parseJson3, parseVtt } from "../src/parse.js";

describe("parseJson3", () => {
  const fixture = JSON.stringify({
    events: [
      // An event with no segs (just window metadata) is ignored.
      { tStartMs: 0, dDurationMs: 0 },
      {
        tStartMs: 1000,
        dDurationMs: 2000,
        segs: [{ utf8: "Hello" }, { utf8: " world" }],
      },
      // A whitespace-only cue is dropped.
      { tStartMs: 3000, dDurationMs: 500, segs: [{ utf8: "\n" }, { utf8: "  " }] },
      {
        tStartMs: 4000,
        dDurationMs: 1500,
        segs: [{ utf8: "second   line" }],
      },
    ],
  });

  it("extracts and concatenates segs with timing", () => {
    const segs = parseJson3(fixture);
    expect(segs).toEqual([
      { startMs: 1000, durMs: 2000, text: "Hello world" },
      { startMs: 4000, durMs: 1500, text: "second line" },
    ]);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseJson3("not json")).toThrow();
  });
});

describe("parseVtt", () => {
  const fixture = `WEBVTT
Kind: captions
Language: en

00:00:01.000 --> 00:00:03.000
Hello <00:00:01.500><c>world</c>

00:00:03.000 --> 00:00:03.500


00:00:04.000 --> 00:00:05.500
second line
continues here
`;

  it("parses cues, strips tags, drops empties, joins wrapped lines", () => {
    const segs = parseVtt(fixture);
    expect(segs).toEqual([
      { startMs: 1000, durMs: 2000, text: "Hello world" },
      { startMs: 4000, durMs: 1500, text: "second line continues here" },
    ]);
  });

  it("accepts comma-style milliseconds and large hours", () => {
    const vtt = `WEBVTT

01:00:00,250 --> 01:00:02,250
late cue
`;
    expect(parseVtt(vtt)).toEqual([
      { startMs: 3_600_250, durMs: 2000, text: "late cue" },
    ]);
  });

  it("accepts the hours-less MM:SS.mmm cue form", () => {
    const vtt = `WEBVTT

00:01.000 --> 00:03.000
short form
`;
    expect(parseVtt(vtt)).toEqual([
      { startMs: 1000, durMs: 2000, text: "short form" },
    ]);
  });
});
