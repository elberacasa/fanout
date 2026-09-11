import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { originAllowed, readOrCreateToken, tokenMatches } from "../src/api/token.ts";

/*
 * "Local" is not the same as "yours": anything on the machine can reach a loopback port, including a web page.
 */

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "fanout-token-"));
  path = join(dir, "state", "token");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("the daemon's token", () => {
  it("is created once, long, and readable only by its owner", () => {
    const token = readOrCreateToken(path);
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, "state")).mode & 0o777).toBe(0o700);
    expect(readOrCreateToken(path)).toBe(token);
  });

  it("replaces a token that is too short to be one", () => {
    readOrCreateToken(path);
    writeFileSync(path, "short\n", { mode: 0o600 });
    const replaced = readOrCreateToken(path);
    expect(replaced.length).toBeGreaterThanOrEqual(32);
    expect(readFileSync(path, "utf8").trim()).toBe(replaced);
  });

  it("tightens the permissions of a token file someone left open", () => {
    const token = readOrCreateToken(path);
    chmodSync(path, 0o644);
    expect(readOrCreateToken(path)).toBe(token);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});

describe("checking a token", () => {
  const token = "a".repeat(43);

  it.each([
    ["the token itself", token, true],
    ["the token as a bearer", `Bearer ${token}`, true],
    ["a wrong token of the same length", "b".repeat(43), false],
    ["a shorter token", "a".repeat(20), false],
    ["a longer token", "a".repeat(60), false],
    ["an empty bearer", "Bearer ", false],
    ["empty", "", false],
  ])("%s", (_, header, expected) => {
    expect(tokenMatches(token, header)).toBe(expected);
  });

  it("refuses a missing header", () => {
    expect(tokenMatches(token, undefined)).toBe(false);
  });

  it("refuses everything when the daemon has no token", () => {
    expect(tokenMatches("", "Bearer anything")).toBe(false);
  });
});

describe("checking where a request came from", () => {
  it.each([
    ["no origin, as our own clients send", undefined, true],
    ["our own page", "http://127.0.0.1:7717", true],
    ["localhost, the same thing by another name", "http://localhost:7717", true],
    ["a website", "https://example.invalid", false],
    ["a page on another local port", "http://127.0.0.1:3000", false],
    ["a file page", "null", true],
  ])("%s", (_, origin, expected) => {
    expect(originAllowed(origin, 7717)).toBe(expected);
  });
});
