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

  it.each(["", "/etc/passwd", "src/", "../outside", "src/../outside", "./src", "src//x", "src/**.ts", "ab"])(
    "rejects %j",
    (glob) => {
      expect(isValidScopeGlob(glob)).toBe(false);
      expect(ScopeGlob.safeParse(glob).success).toBe(false);
    },
  );

  it.each([
    ["a file with spaces", "src/my file.ts"],
    ["parentheses", "docs/notes (draft).md"],
    ["a dynamic route", "app/[id]/page.tsx"],
    ["braces, which are literal here", "src/{a,b}.ts"],
    ["an exclamation mark", "!important.md"],
    ["accents and other scripts", "src/café/日本語.ts"],
    ["a backslash, literal on POSIX", "src/weird\\name.ts"],
  ])("accepts %s: %j", (_, glob) => {
    expect(isValidScopeGlob(glob)).toBe(true);
    expect(pathInScope(glob, glob)).toBe(true);
  });

  it("still matches wildcards around real-world names", () => {
    expect(pathInScope("app/[id]/page.tsx", "app/**/page.tsx")).toBe(true);
    expect(pathInScope("src/my file.ts", "src/*.ts")).toBe(true);
    expect(pathInScope("docs/notes (draft).md", "docs/*.md")).toBe(true);
    expect(scopesMayOverlap("src/my file.ts", "src/**")).toBe(true);
    expect(scopesMayOverlap("app/[id]/page.tsx", "app/[slug]/page.tsx")).toBe(false);
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

    const globs = Array.from({ length: 90 }, () => make(globSegments, 4));
    const paths = Array.from({ length: 150 }, () => make(pathSegments, 5));
    // Match each path once per glob, then compare sets: the same coverage without re-walking every path per pair.
    const covered = globs.map((glob) => new Set(paths.filter((path) => pathInScope(path, glob))));

    let witnessed = 0;
    for (let i = 0; i < globs.length; i += 1) {
      const a = globs[i];
      const coveredByA = covered[i];
      if (a === undefined || coveredByA === undefined) continue;
      for (let j = i; j < globs.length; j += 1) {
        const b = globs[j];
        const coveredByB = covered[j];
        if (b === undefined || coveredByB === undefined) continue;
        const overlap = scopesMayOverlap(a, b);
        expect(overlap).toBe(scopesMayOverlap(b, a));
        const shared = [...coveredByA].find((path) => coveredByB.has(path));
        if (shared !== undefined) {
          witnessed += 1;
          expect(overlap, `${a} / ${b} share ${shared}`).toBe(true);
        }
      }
    }
    expect(witnessed).toBeGreaterThan(500);
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
