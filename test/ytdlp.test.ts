import { describe, expect, it } from "vitest";
import {
  buildInfoArgs,
  buildSubsArgs,
  pickTrack,
  type VideoInfo,
} from "../src/ytdlp.js";

const URL = "https://www.youtube.com/watch?v=abc12345678";

describe("buildInfoArgs", () => {
  it("builds the discovery args", () => {
    expect(buildInfoArgs(URL)).toEqual([
      "-J",
      "--no-playlist",
      "--skip-download",
      URL,
    ]);
  });

  it("threads --proxy before the url", () => {
    expect(buildInfoArgs(URL, { proxy: "http://127.0.0.1:8080" })).toEqual([
      "-J",
      "--no-playlist",
      "--skip-download",
      "--proxy",
      "http://127.0.0.1:8080",
      URL,
    ]);
  });
});

describe("buildSubsArgs", () => {
  const base = { url: URL, lang: "ja", outTemplate: "/tmp/x/%(id)s.%(ext)s" };

  it("uses --write-subs for manual tracks", () => {
    expect(buildSubsArgs({ ...base, isAuto: false })).toEqual([
      "--skip-download",
      "--no-playlist",
      "--sub-langs",
      "ja",
      "--sub-format",
      "json3/vtt/best",
      "--write-subs",
      "-o",
      "/tmp/x/%(id)s.%(ext)s",
      URL,
    ]);
  });

  it("uses --write-auto-subs for auto tracks and threads --proxy", () => {
    expect(
      buildSubsArgs({ ...base, isAuto: true, proxy: "http://p:1" }),
    ).toEqual([
      "--skip-download",
      "--no-playlist",
      "--sub-langs",
      "ja",
      "--sub-format",
      "json3/vtt/best",
      "--write-auto-subs",
      "-o",
      "/tmp/x/%(id)s.%(ext)s",
      "--proxy",
      "http://p:1",
      URL,
    ]);
  });
});

describe("pickTrack", () => {
  const info: VideoInfo = {
    id: "abc12345678",
    title: "T",
    webpage_url: URL,
    subtitles: {
      en: [{ ext: "json3" }],
      fr: [{ ext: "json3" }],
    },
    automatic_captions: {
      ja: [{ ext: "json3" }],
      en: [{ ext: "json3" }],
    },
  };

  it("prefers manual and honors lang priority", () => {
    // ja is only auto; en is manual -> prefer-manual picks en manual.
    expect(pickTrack(info, ["ja", "en"], "prefer-manual")).toEqual({
      lang: "en",
      isAuto: false,
    });
  });

  it("falls back to auto when no manual lang matches", () => {
    expect(pickTrack(info, ["ja"], "prefer-manual")).toEqual({
      lang: "ja",
      isAuto: true,
    });
  });

  it("manual-only ignores auto tracks", () => {
    expect(pickTrack(info, ["ja", "fr"], "manual-only")).toEqual({
      lang: "fr",
      isAuto: false,
    });
    expect(pickTrack(info, ["ja"], "manual-only")).toBeNull();
  });

  it("auto-only ignores manual tracks", () => {
    expect(pickTrack(info, ["en"], "auto-only")).toEqual({
      lang: "en",
      isAuto: true,
    });
    expect(pickTrack(info, ["fr"], "auto-only")).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(pickTrack(info, ["de"], "prefer-manual")).toBeNull();
  });

  it("picks an auto-translated language (the --translate path)", () => {
    // ja exists only as an auto-translation; --translate maps to auto-only + [ja].
    expect(pickTrack(info, ["ja"], "auto-only")).toEqual({ lang: "ja", isAuto: true });
  });
});
