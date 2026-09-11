import { z } from "zod";

/*
 * Write scopes are repo-relative POSIX globs with a deliberately small syntax:
 *   `*` and `?` match within one path segment, `**` (a whole segment) matches zero or more segments.
 * Every pattern also covers everything below what it matches, so `src/api` and `src/api/**` are the same scope.
 * Braces, character classes and negation are not supported: a scope must be obvious to the person approving it.
 */

const SEGMENT = /^(?:\*\*|[A-Za-z0-9._@+\-*?]+)$/;
const WILDCARD = /[*?]/;

export function isValidScopeGlob(glob: string): boolean {
  if (glob.length === 0 || glob.startsWith("/") || glob.endsWith("/")) return false;
  return glob
    .split("/")
    .every(
      (segment) =>
        SEGMENT.test(segment) &&
        segment !== "." &&
        segment !== ".." &&
        (segment === "**" || !segment.includes("**")),
    );
}

export const ScopeGlob = z.string().max(300).refine(isValidScopeGlob, {
  message: "use a repo-relative path or glob (`*`, `?`, `**`), without `..`, leading or trailing `/`",
});

/** Segments of a pattern, with the implicit "and everything below" made explicit. */
function scopeSegments(glob: string): string[] {
  const segments = glob.split("/");
  return segments.at(-1) === "**" ? segments : [...segments, "**"];
}

const segmentPatterns = new Map<string, RegExp>();

function segmentPattern(segment: string): RegExp {
  let pattern = segmentPatterns.get(segment);
  if (pattern === undefined) {
    const source = segment
      .split("")
      .map((char) =>
        char === "*" ? "[^/]*" : char === "?" ? "[^/]" : char.replace(/[.+^${}()|[\]\\-]/g, "\\$&"),
      )
      .join("");
    pattern = new RegExp(`^${source}$`);
    segmentPatterns.set(segment, pattern);
  }
  return pattern;
}

/** The literal text before the first wildcard and after the last one. */
function literalEnds(segment: string): [prefix: string, suffix: string] {
  const first = segment.search(WILDCARD);
  let last = segment.length - 1;
  while (last >= 0 && !WILDCARD.test(segment.charAt(last))) last -= 1;
  return [segment.slice(0, first), segment.slice(last + 1)];
}

/**
 * Whether two single-segment patterns can match a common name. Exact when at least one side is literal; when both
 * have wildcards it compares their literal ends, which can only err towards "yes" (the safe side for scopes).
 */
function segmentsMayOverlap(a: string, b: string): boolean {
  const aWild = WILDCARD.test(a);
  const bWild = WILDCARD.test(b);
  if (!aWild && !bWild) return a === b;
  if (!aWild) return segmentPattern(b).test(a);
  if (!bWild) return segmentPattern(a).test(b);
  const [aPrefix, aSuffix] = literalEnds(a);
  const [bPrefix, bSuffix] = literalEnds(b);
  return (
    (aPrefix.startsWith(bPrefix) || bPrefix.startsWith(aPrefix)) &&
    (aSuffix.endsWith(bSuffix) || bSuffix.endsWith(aSuffix))
  );
}

/**
 * Whether some file path could fall inside both scopes. Sound: it never answers "no" when a common path exists.
 * It may answer "yes" for exotic wildcard pairs that cannot actually meet; the plan then asks for narrower scopes.
 */
export function scopesMayOverlap(a: string, b: string): boolean {
  const left = scopeSegments(a);
  const right = scopeSegments(b);
  const memo = new Map<number, boolean>();
  const width = right.length + 1;

  const from = (i: number, j: number): boolean => {
    const key = i * width + j;
    const known = memo.get(key);
    if (known !== undefined) return known;
    let result: boolean;
    const l = left[i];
    const r = right[j];
    if (l === undefined && r === undefined) result = true;
    else if (l === "**") result = from(i + 1, j) || (r !== undefined && from(i, j + 1));
    else if (r === "**") result = from(i, j + 1) || (l !== undefined && from(i + 1, j));
    else if (l === undefined || r === undefined) result = false;
    else result = segmentsMayOverlap(l, r) && from(i + 1, j + 1);
    memo.set(key, result);
    return result;
  };

  return from(0, 0);
}

/** Whether a repo-relative file path falls inside a scope. */
export function pathInScope(path: string, glob: string): boolean {
  const parts = path.split("/");
  const pattern = scopeSegments(glob);

  const from = (i: number, j: number): boolean => {
    const segment = pattern[j];
    if (segment === undefined) return i === parts.length;
    if (segment === "**") return from(i, j + 1) || (i < parts.length && from(i + 1, j));
    const part = parts[i];
    return part !== undefined && segmentPattern(segment).test(part) && from(i + 1, j + 1);
  };

  return from(0, 0);
}
