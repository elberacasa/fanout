/*
 * Just enough semantic versioning to answer one question: is this CLI inside the range its adapter was verified
 * against? A whole dependency for that would be a dependency to keep current, and the answer has to be boring.
 *
 * A range is a space-separated list of comparators that must all hold, for example ">=0.150.0 <1.0.0".
 * Anything we cannot read is not a match, because "unsupported" is the honest answer to a version we don't know.
 */

export interface Version {
  major: number;
  minor: number;
  patch: number;
}

const VERSION = /(\d+)\.(\d+)(?:\.(\d+))?/;
// A bound may name as much as it likes: ">=0.150.0", ">=1.0" and "<2" are all ordinary ways to write a range.
const COMPARATOR = /^(>=|<=|>|<|=)?\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?$/;

/** The first version in a CLI's `--version` output, whatever else it prints around it. */
export function parseVersion(text: string): Version | null {
  const found = VERSION.exec(text);
  if (found === null) return null;
  return {
    major: Number(found[1]),
    minor: Number(found[2]),
    patch: Number(found[3] ?? 0),
  };
}

export function compareVersions(a: Version, b: Version): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

export function satisfies(version: Version, range: string): boolean {
  const comparators = range.trim().split(/\s+/).filter(Boolean);
  if (comparators.length === 0) return false;

  return comparators.every((text) => {
    const found = COMPARATOR.exec(text);
    if (found === null) return false;
    const bound: Version = {
      major: Number(found[2]),
      minor: Number(found[3] ?? 0),
      patch: Number(found[4] ?? 0),
    };
    const order = compareVersions(version, bound);
    switch (found[1] ?? "=") {
      case ">=":
        return order >= 0;
      case "<=":
        return order <= 0;
      case ">":
        return order > 0;
      case "<":
        return order < 0;
      default:
        return order === 0;
    }
  });
}
