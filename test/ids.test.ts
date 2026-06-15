import { describe, expect, it } from "vitest";
import { extractVideoId, isVideoId } from "../src/ids.js";

const ID = "dQw4w9WgXcQ";

describe("isVideoId", () => {
  it("accepts an exact 11-char id", () => {
    expect(isVideoId(ID)).toBe(true);
    expect(isVideoId("_-aZ09bcDeF")).toBe(true);
  });

  it("rejects wrong lengths", () => {
    expect(isVideoId("short")).toBe(false);
    expect(isVideoId(ID + "x")).toBe(false);
  });
});

describe("extractVideoId", () => {
  it("returns a bare id unchanged", () => {
    expect(extractVideoId(ID)).toBe(ID);
  });

  it("parses youtu.be short links", () => {
    expect(extractVideoId(`https://youtu.be/${ID}`)).toBe(ID);
    expect(extractVideoId(`https://youtu.be/${ID}?t=42`)).toBe(ID);
  });

  it("parses watch?v= links with extra params", () => {
    expect(extractVideoId(`https://www.youtube.com/watch?v=${ID}&list=abc&t=1s`)).toBe(ID);
    expect(extractVideoId(`http://youtube.com/watch?v=${ID}`)).toBe(ID);
  });

  it("parses /shorts/, /embed/, /live/ links", () => {
    expect(extractVideoId(`https://www.youtube.com/shorts/${ID}`)).toBe(ID);
    expect(extractVideoId(`https://www.youtube.com/embed/${ID}?rel=0`)).toBe(ID);
    expect(extractVideoId(`https://www.youtube.com/live/${ID}`)).toBe(ID);
  });

  it("parses m. and music. hosts", () => {
    expect(extractVideoId(`https://m.youtube.com/watch?v=${ID}`)).toBe(ID);
    expect(extractVideoId(`https://music.youtube.com/watch?v=${ID}`)).toBe(ID);
  });

  it("trims surrounding whitespace", () => {
    expect(extractVideoId(`  ${ID}  `)).toBe(ID);
  });

  it("throws on unrecognized input", () => {
    expect(() => extractVideoId("https://example.com/watch?v=nope")).toThrow();
    expect(() => extractVideoId("not a url and not an id")).toThrow();
    expect(() => extractVideoId("")).toThrow();
  });
});
