import { describe, expect, it } from "vitest";
import { missionViewHtml } from "../src/api/view.ts";

/*
 * The one thing nothing else can check about the mission view.
 *
 * The page has no build step and no framework (ADR 0019), which is deliberate — it renders your private source
 * and every dependency would be one more thing that could read it. The cost is that nothing type-checks the
 * string in `el("div", "reroute", …)`. A typo there renders real content with no styling at all: text in the
 * wrong place, in the wrong colour, on a screen whose whole job is to be trusted at a glance. Nobody notices
 * until they are looking at a live mission.
 *
 * So the classes the script writes and the classes the stylesheet defines are checked against each other here.
 * It is a spell-checker, not a renderer, and it is the cheapest real guarantee this file can have.
 */

const html = missionViewHtml();

/** Every class name the script hands to its `el()` helper, including the two-class forms like `mark ok`. */
function classesUsed(): Set<string> {
  const used = new Set<string>();
  for (const match of html.matchAll(/\bel\(\s*"[a-z]+"\s*,\s*(?:"([^"]*)"|`([^`$]*)`)/g)) {
    for (const name of (match[1] ?? match[2] ?? "").split(/\s+/)) if (name !== "") used.add(name);
  }
  // Classes added after the element exists rather than at construction.
  for (const match of html.matchAll(/classList\.add\("([^"]+)"\)/g)) {
    if (match[1] !== undefined) used.add(match[1]);
  }
  return used;
}

/** Every class the stylesheet gives a rule to. */
function classesStyled(): Set<string> {
  const styled = new Set<string>();
  const style = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? "";
  for (const match of style.matchAll(/\.([a-zA-Z][\w-]*)/g)) {
    if (match[1] !== undefined) styled.add(match[1]);
  }
  return styled;
}

/*
 * Tone words the script composes at runtime (`mark ${tone}`), and names that live in the HTML rather than in the
 * script. Listed rather than pattern-matched, so adding one is a decision somebody made on purpose.
 */
const COMPOSED = new Set(["ok", "bad", "run", "idle", "warn", "stale", "on", "off"]);

describe("the mission view's classes", () => {
  it("styles every class the script writes", () => {
    const unstyled = [...classesUsed()].filter((name) => !classesStyled().has(name) && !COMPOSED.has(name));

    // A class with no rule is content rendered in the wrong place, in the wrong colour, silently.
    expect(unstyled).toEqual([]);
  });

  it("keeps the token a placeholder in the file on disk, never a baked-in secret", () => {
    expect(html).toContain("{{TOKEN}}");
    // The daemon stamps its own token in as it serves. A real one committed here would be a credential in git.
    expect(/[0-9a-f]{32}/.test(html)).toBe(false);
  });
});
