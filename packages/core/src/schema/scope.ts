import { z } from "zod";

/*
 * Write scopes are repo-relative POSIX globs with a deliberately small syntax:
 *   `*` and `?` match within one path segment, `**` (a whole segment) matches zero or more segments.
 * Every pattern also covers everything below what it matches, so `src/api` and `src/api/**` are the same scope.
 * Braces, character classes and negation are not supported: a scope must be obvious to the person approving it.
 *
 * Matching is deliberately hand-written rather than translated to regular expressions: a pattern like `a*a*a*…z`
 * makes a backtracking engine take exponential time, and scopes come from plans we must be able to check quickly.
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

/**
 * A plain repo-relative path: no leading slash, no `.` or `..`, no empty segments. Anything else (a path that still
 * needs resolving, or one from outside the repository) is not inside any scope, whatever it looks like.
 */
export function isRepoPath(path: string): boolean {
  if (path.length === 0 || path.startsWith("/") || path.endsWith("/")) return false;
  return path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/** Segments of a pattern, with the implicit "and everything below" made explicit. */
function scopeSegments(glob: string): string[] {
  const segments = glob.split("/");
  return segments.at(-1) === "**" ? segments : [...segments, "**"];
}

/**
 * Matches one segment pattern (`*`, `?`) against one name, in linear time: on a mismatch it returns to the last `*`
 * and gives it one more character, so no input can make it backtrack exponentially.
 */
function segmentMatches(pattern: string, text: string): boolean {
  let p = 0;
  let t = 0;
  let starAt = -1;
  let matchedAt = 0;

  while (t < text.length) {
    const token = pattern[p];
    if (token === "?" || (token !== undefined && token !== "*" && token === text[t])) {
      p += 1;
      t += 1;
    } else if (token === "*") {
      starAt = p;
      matchedAt = t;
      p += 1;
    } else if (starAt >= 0) {
      matchedAt += 1;
      p = starAt + 1;
      t = matchedAt;
    } else {
      return false;
    }
  }
  while (pattern[p] === "*") p += 1;
  return p === pattern.length;
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
  if (!aWild) return segmentMatches(b, a);
  if (!bWild) return segmentMatches(a, b);
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
  if (!isRepoPath(path)) return false;
  const parts = path.split("/");
  const pattern = scopeSegments(glob);
  const memo = new Map<number, boolean>();
  const width = pattern.length + 1;

  const from = (i: number, j: number): boolean => {
    const key = i * width + j;
    const known = memo.get(key);
    if (known !== undefined) return known;
    const segment = pattern[j];
    const part = parts[i];
    let result: boolean;
    if (segment === undefined) result = i === parts.length;
    else if (segment === "**") result = from(i, j + 1) || (i < parts.length && from(i + 1, j));
    else result = part !== undefined && segmentMatches(segment, part) && from(i + 1, j + 1);
    memo.set(key, result);
    return result;
  };

  return from(0, 0);
}
