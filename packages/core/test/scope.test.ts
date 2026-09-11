import { describe, expect, it } from "vitest";
import { isValidScopeGlob, pathInScope, ScopeGlob, scopesMayOverlap } from "../src/index.ts";

describe("scope globs", () => {
  it.each([
    "src/**",
    "src/api/*.ts",
    "package.json",
    ".github/workflows/*.yml",
    "tests/**/*.test.ts",
    "a?c",
    "**",
  ])("accepts %j", (glob) => {
    expect(isValidScopeGlob(glob)).toBe(true);
    expect(ScopeGlob.safeParse(glob).success).toBe(true);
  });

  it.each([
    "",
    "/etc/passwd",
    "src/",
    "../outside",
    "src/../outside",
    "./src",
    "src//x",
    "src/**.ts",
    "src/{a,b}",
    "src/[ab].ts",
    "src\\x",
    "!src",
    "src/ x",
  ])("rejects %j", (glob) => {
    expect(isValidScopeGlob(glob)).toBe(false);
    expect(ScopeGlob.safeParse(glob).success).toBe(false);
  });
});

describe("pathInScope", () => {
  it.each([
    ["src/api/a.ts", "src/**", true],
    ["src/api/a.ts", "src/api", true],
    ["src/api", "src/api", true],
    ["src/apix/a.ts", "src/api", false],
    ["src/api/a.ts", "src/*/a.ts", true],
    ["src/a.ts", "src/*.ts", true],
    ["src/x/a.ts", "src/*.ts", false],
    ["tests/a.test.ts", "tests/**/*.test.ts", true],
    ["tests/export/unit/a.test.ts", "tests/**/*.test.ts", true],
    ["tests/export/a.spec.ts", "tests/**/*.test.ts", false],
    ["abc", "a?c", true],
    ["abbc", "a?c", false],
    ["package.json", "packages/**", false],
    ["anything/at/all", "**", true],
    ["src/a+b.ts", "src/a+b.ts", true],
    ["src/aab.ts", "src/a+b.ts", false],
  ])("%j in %j is %s", (path, glob, expected) => {
    expect(pathInScope(path, glob)).toBe(expected);
  });
});

describe("pathInScope refuses anything that is not a plain repo-relative path", () => {
  it.each([
    ["src/../private/key", "src/**"],
    ["src/../../outside", "src/**"],
    ["../outside", "**"],
    ["/etc/passwd", "**"],
    ["./src/a.ts", "src/**"],
    ["src//a.ts", "src/**"],
    ["src/", "src/**"],
    ["", "**"],
  ])("%j is not inside %j", (path, glob) => {
    expect(pathInScope(path, glob)).toBe(false);
  });
});

describe("scopesMayOverlap", () => {
  it.each([
    ["src/api/**", "src/ui/**", false],
    ["src/**", "src/ui/x.ts", true],
    ["src/api", "src/api/routes.ts", true],
    ["src/*.ts", "src/*.css", false],
    ["src/a*", "src/b*", false],
    ["src/*.test.ts", "src/foo.*", true],
    ["package.json", "packages/**", false],
    ["**", "docs/readme.md", true],
    ["tests/**/*.test.ts", "tests/export/**", true],
    ["docs/*.md", "src/**", false],
    ["src/*/index.ts", "src/api/*.ts", true],
    ["src/*/index.ts", "src/api/*.css", false],
  ])("%j and %j: %s", (a, b, expected) => {
    expect(scopesMayOverlap(a, b)).toBe(expected);
    expect(scopesMayOverlap(b, a)).toBe(expected);
  });

  it("answers adversarial but perfectly valid patterns quickly", () => {
    const started = performance.now();
    expect(scopesMayOverlap(`${"a*".repeat(24)}z`, "a".repeat(48))).toBe(false);
    expect(pathInScope(Array(48).fill("a").join("/"), `${Array(24).fill("**/a").join("/")}/z`)).toBe(false);
    expect(performance.now() - started).toBeLessThan(250);
  });

  it("never says no when a path lies in both scopes (randomized)", () => {
    const random = mulberry32(20260911);
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
    const globSegments = ["a", "b", "ab", "*", "a*", "*b", "?", "?b", "**"] as const;
    const pathSegments = ["a", "b", "ab", "ba", "aa", "bb"] as const;
    const make = (segments: readonly string[], max: number) =>
      Array.from({ length: 1 + Math.floor(random() * max) }, () => pick(segments)).join("/");

    const globs = Array.from({ length: 120 }, () => make(globSegments, 4));
    const paths = Array.from({ length: 200 }, () => make(pathSegments, 5));
    let witnessed = 0;
    for (const a of globs) {
      for (const b of globs) {
        const common = paths.find((path) => pathInScope(path, a) && pathInScope(path, b));
        if (common !== undefined) {
          witnessed += 1;
          expect(scopesMayOverlap(a, b), `${a} / ${b} share ${common}`).toBe(true);
        }
        expect(scopesMayOverlap(a, b)).toBe(scopesMayOverlap(b, a));
      }
    }
    expect(witnessed).toBeGreaterThan(1000);
  });
});

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
