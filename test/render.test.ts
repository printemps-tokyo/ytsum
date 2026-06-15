import { describe, expect, it } from "vitest";
import type { Segment } from "../src/parse.js";
import {
  dedupeSegments,
  formatClock,
  formatSrtTime,
  formatVttTime,
  renderHeader,
  toJson,
  toPlainText,
  toSrt,
  toVtt,
  type VideoMeta,
} from "../src/render.js";

const segs: Segment[] = [
  { startMs: 0, durMs: 2000, text: "first line" },
  { startMs: 2000, durMs: 2000, text: "second line" },
  { startMs: 65_000, durMs: 1000, text: "after a minute" },
];

const meta: VideoMeta = {
  id: "abc12345678",
  title: "My Video",
  url: "https://www.youtube.com/watch?v=abc12345678",
  lang: "en",
  isAuto: true,
};

describe("formatters", () => {
  it("formatClock uses mm:ss and h:mm:ss", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(65_000)).toBe("01:05");
    expect(formatClock(3_661_000)).toBe("1:01:01");
  });

  it("srt and vtt timestamps", () => {
    expect(formatSrtTime(3_661_250)).toBe("01:01:01,250");
    expect(formatVttTime(3_661_250)).toBe("01:01:01.250");
  });
});

describe("toPlainText", () => {
  it("joins lines without timestamps by default", () => {
    expect(toPlainText(segs)).toBe("first line\nsecond line\nafter a minute");
  });

  it("prefixes [mm:ss] with --timestamps", () => {
    expect(toPlainText(segs, { timestamps: true })).toBe(
      "[00:00] first line\n[00:02] second line\n[01:05] after a minute",
    );
  });
});

describe("toSrt", () => {
  it("numbers cues and uses comma ms", () => {
    expect(toSrt(segs.slice(0, 1))).toBe(
      "1\n00:00:00,000 --> 00:00:02,000\nfirst line\n",
    );
  });
});

describe("toVtt", () => {
  it("emits a WEBVTT header and dot ms", () => {
    const out = toVtt(segs.slice(0, 1));
    expect(out).toBe("WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nfirst line\n");
  });
});

describe("toJson", () => {
  it("includes meta and segments with kind", () => {
    const parsed = JSON.parse(toJson(meta, segs.slice(0, 1)));
    expect(parsed).toEqual({
      id: "abc12345678",
      title: "My Video",
      url: "https://www.youtube.com/watch?v=abc12345678",
      lang: "en",
      kind: "auto",
      segments: [{ startMs: 0, durMs: 2000, text: "first line" }],
    });
  });
});

describe("renderHeader", () => {
  it("formats title / url / lang / kind", () => {
    expect(renderHeader(meta)).toBe(
      "# My Video\n# https://www.youtube.com/watch?v=abc12345678  (lang: en, auto)\n\n",
    );
  });
});

describe("dedupeSegments (rolling auto-caption duplicates)", () => {
  it("collapses cues that grow token-by-token", () => {
    const rolling: Segment[] = [
      { startMs: 0, durMs: 500, text: "I am" },
      { startMs: 0, durMs: 800, text: "I am going" },
      { startMs: 0, durMs: 1200, text: "I am going home" },
      { startMs: 1200, durMs: 500, text: "and then" },
      { startMs: 1200, durMs: 900, text: "and then we eat" },
    ];
    const out = dedupeSegments(rolling);
    expect(out.map((s) => s.text)).toEqual(["I am going home", "and then we eat"]);
  });

  it("drops exact and contained repeats (case-insensitive)", () => {
    const dupes: Segment[] = [
      { startMs: 0, durMs: 500, text: "Hello there" },
      { startMs: 500, durMs: 500, text: "hello there" },
      { startMs: 1000, durMs: 500, text: "there" },
      { startMs: 1500, durMs: 500, text: "next" },
    ];
    expect(dedupeSegments(dupes).map((s) => s.text)).toEqual(["Hello there", "next"]);
  });

  it("plain text output reflects the dedupe", () => {
    const rolling: Segment[] = [
      { startMs: 0, durMs: 500, text: "one" },
      { startMs: 0, durMs: 800, text: "one two" },
      { startMs: 800, durMs: 500, text: "three" },
    ];
    expect(toPlainText(rolling)).toBe("one two\nthree");
  });
});
