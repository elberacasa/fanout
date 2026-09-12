import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Which files in the daemon are allowed to start a process, and why.
 *
 * Four times in one day a rule already settled in this repository was not consulted by new code written beside
 * it: the secrets deny-list, the seat policy, `stdin: "closed"` from every manifest, and the detached process
 * group the supervisor has used since milestone 2. Every one of those was implemented correctly somewhere and
 * then re-implemented wrongly nearby, and the last of them could have hung the merge gate forever on Linux.
 *
 * That is not four accidents, it is what happens when knowledge lives in an implementation instead of somewhere
 * it must be looked at. This test does not make spawning safe — it makes adding a new one deliberate. Anyone who
 * needs another has to come here, read the list, and say which of these it is.
 */

const ALLOWED = new Map<string, string>([
  [
    "supervisor/supervise.ts",
    "The agent supervisor: detached process group, start detection, deadlines, escalation from SIGTERM to " +
      "SIGKILL, capped logs. The most complete of these, and the reference for the rest.",
  ],
  [
    "workspace/git.ts",
    "Every git call in the daemon, with an environment that replaces the shell's rather than inheriting it — no " +
      "askpass, no credential helper, no locale surprises.",
  ],
  [
    "gate/run-seat.ts",
    "One read-only question to a vendor's CLI, with the seat's stdin closed as its manifest declares.",
  ],
  [
    "gate/checks.ts",
    "The project's own check commands, through a shell, in their own process group so the whole tree can be " +
      "killed and not just the shell at the top of it.",
  ],
  ["gate/merge.ts", "`git apply -3` with the patch on stdin, which the shared git helper cannot do."],
  [
    "workspace/manager.ts",
    "Collecting a run's diff: git through the shared helper, plus one direct call for the patch it must stream.",
  ],
  [
    "detector/detect.ts",
    "Short version and sign-in probes, each under its own deadline so one hanging CLI cannot hide the others.",
  ],
]);

function sourceFiles(directory: string, prefix = ""): { path: string; text: string }[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full, `${prefix}${entry}/`);
    if (!entry.endsWith(".ts")) return [];
    return [{ path: `${prefix}${entry}`, text: readFileSync(full, "utf8") }];
  });
}

/*
 * Detected by the import, not by a call. A first attempt matched `spawn(` and friends, which flagged every
 * `regex.exec(line)` in the daemon and missed `promisify(execFile)` entirely — wrong in both directions at once.
 * Nothing starts a process without reaching for `node:child_process`, statically or dynamically — and matching
 * the module name rather than the import keyword catches the two places that reach for it with `await import`,
 * which a check on the import statement alone would have missed.
 */
const SPAWNS = (source: string): boolean => source.includes("node:child_process");

describe("starting a process", () => {
  it("happens only where this test says it may", () => {
    const src = new URL("../src/", import.meta.url).pathname;
    const spawning = sourceFiles(src)
      .filter((file) => SPAWNS(file.text))
      .map((file) => file.path)
      .sort();

    expect(spawning).toEqual([...ALLOWED.keys()].sort());
  });

  it("gives a reason for every one of them", () => {
    for (const [path, why] of ALLOWED) {
      expect(why.length, `${path} needs a reason worth reading`).toBeGreaterThan(40);
    }
  });

  /*
   * The specific rule that was missed. A command with children — and `npm test` is one — outlives a signal sent
   * only to the shell above it, holds the pipes open, and never settles.
   */
  /*
   * The specific rule that was missed. A command with children — and `npm test` is one — outlives a signal sent
   * only to the shell above it, holds the pipes open, and never settles.
   */
  it("signals process groups, never a lone child, wherever it kills something", () => {
    const src = new URL("../src/", import.meta.url).pathname;
    // Only files that actually start processes: elsewhere `kill(` is someone else's method, not a signal.
    const killers = sourceFiles(src).filter((file) => SPAWNS(file.text) && /\bkill\(/.test(file.text));

    expect(killers.length, "something should still be killing runaway processes").toBeGreaterThan(0);
    for (const file of killers) {
      expect(file.text, `${file.path} kills a lone process instead of its group`).toMatch(/process\.kill\(-/);
      expect(file.text, `${file.path} kills a group it never asked for`).toMatch(/detached:\s*true/);
    }
  });
});
