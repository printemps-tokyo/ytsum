import { describe, expect, it } from "vitest";
import { parseCliArgs } from "../src/args.js";

const ID = "dQw4w9WgXcQ";

describe("parseCliArgs", () => {
  it("recognizes --version in any position", () => {
    expect(parseCliArgs(["--version"]).values.version).toBe(true);
    expect(parseCliArgs([ID, "--version"]).values.version).toBe(true);
    expect(parseCliArgs(["--lang", "en", "--version", ID]).values.version).toBe(true);
  });

  it("recognizes the -v short flag in any position", () => {
    expect(parseCliArgs(["-v"]).values.version).toBe(true);
    expect(parseCliArgs([ID, "-v"]).values.version).toBe(true);
  });

  it("recognizes -h/--help in any position", () => {
    expect(parseCliArgs([ID, "--help"]).values.help).toBe(true);
    expect(parseCliArgs(["--lang", "en", "-h"]).values.help).toBe(true);
  });

  it("defaults version and help to false", () => {
    const { values } = parseCliArgs([ID]);
    expect(values.version).toBe(false);
    expect(values.help).toBe(false);
  });

  it("keeps positionals separate from flags", () => {
    const { values, positionals } = parseCliArgs([
      "--list",
      "--format",
      "json",
      ID,
      "abc12345678",
    ]);
    expect(values.list).toBe(true);
    expect(values.format).toBe("json");
    expect(positionals).toEqual([ID, "abc12345678"]);
  });

  it("throws on unknown options (strict mode)", () => {
    expect(() => parseCliArgs(["--nope"])).toThrow(/--nope/);
  });
});
