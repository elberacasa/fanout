import { describe, expect, it } from "vitest";
import { createLive, type LiveRow } from "../src/live.ts";

/*
 * The live crew view, which is the first thing anyone sees of this product.
 *
 * Everything here is about failures that look like a broken program rather than a wrong number: a wrapped row
 * that makes the redraw draw over itself, a column that twitches while you read it, escape codes vomited into a
 * log file. None of those are caught by anything else, because they are only visible on a screen.
 */

const row = (over: Partial<LiveRow> = {}): LiveRow => ({
  who: "Agent 1",
  task: "CSV export endpoint",
  doing: "reading src/api/orders.ts",
  state: "working",
  elapsedMs: 4000,
  ...over,
});

/** Collects what would reach the terminal. */
function harness(options: { tty: boolean; columns?: number }) {
  const written: string[] = [];
  const live = createLive({
    write: (text) => written.push(text),
    tty: options.tty,
    ...(options.columns === undefined ? {} : { columns: options.columns }),
  });
  return { live, written, all: () => written.join("") };
}

/** A rendered frame with the escape codes taken out, which is what a person actually sees. */
const visible = (text: string): string[] =>
  text
    // eslint-disable-next-line no-control-regex -- reading back the codes this module writes is the point
    .replace(/\[[0-9;?]*[a-zA-Z]/g, "")
    .split("\n")
    .filter((line) => line.trim() !== "");

describe("drawing the crew on a terminal", () => {
  it("names the agent and what it is doing, not the run id or a phase glyph", () => {
    const { live, all } = harness({ tty: true });
    live.render([row()]);

    const [line = ""] = visible(all());
    expect(line).toContain("Agent 1");
    expect(line).toContain("CSV export endpoint");
    expect(line).toContain("reading src/api/orders.ts");
    expect(line).toContain("0:04");
  });

  /*
   * A wrapped row breaks the redraw outright: the cursor moves back by lines, not by rows, so one wrap leaves
   * every later frame drawing over the wrong place. Truncation is not tidiness, it is correctness.
   */
  it("never writes a row wider than the terminal", () => {
    const { live, all } = harness({ tty: true, columns: 60 });
    live.render([row({ doing: "shell npm run check && npm run lint && npm run typecheck -- --verbose" })]);

    for (const line of visible(all())) expect(line.length).toBeLessThanOrEqual(60);
  });

  it("says when it cut something short, rather than quietly dropping it", () => {
    const { live, all } = harness({ tty: true, columns: 60 });
    live.render([row({ doing: "shell npm run check && npm run lint && npm run typecheck" })]);

    expect(all()).toContain("…");
  });

  /*
   * Measuring each frame afresh made the clock jump left the moment a long action was replaced by a short
   * result. A table that rearranges itself while you read it is what makes a terminal feel cheap.
   */
  it("never lets a column narrow again once it has been wide", () => {
    const { live, written } = harness({ tty: true });
    live.render([row({ doing: "edit a summary that is quite long indeed" })]);
    const wide = visible(written.join("")).at(-1)?.length ?? 0;
    written.length = 0;

    live.render([row({ doing: "ok", result: "+8 −2", state: "done" })]);

    expect(visible(written.join("")).at(-1)?.length).toBe(wide);
  });

  it("moves back over exactly the rows it drew, so the block never scrolls away", () => {
    const { live, written } = harness({ tty: true });
    live.render([row(), row({ who: "Agent 2" })]);
    written.length = 0;

    live.render([row(), row({ who: "Agent 2" })]);

    // Two rows drawn last time means two lines up, not three and not none.
    expect(written.join("")).toContain("[2A");
  });

  it("gives the cursor back when it stops", () => {
    const { live, all } = harness({ tty: true });
    live.render([row()]);

    live.stop();

    expect(all()).toContain("[?25h");
  });
});

/*
 * Piped into a log, a file or `verify:pack`, there is nobody to watch an animation — and cursor codes written
 * there are printed as literal garbage.
 */
describe("writing to something that is not a terminal", () => {
  it("writes no escape codes at all", () => {
    const { live, all } = harness({ tty: false });
    live.render([row()]);
    live.render([row({ doing: "edit add the csv writer" })]);

    expect(all()).not.toContain("");
  });

  it("prints a line when something changes, and not when only the clock moves", () => {
    const { live, written } = harness({ tty: false });
    live.render([row({ elapsedMs: 1000 })]);
    written.length = 0;

    live.render([row({ elapsedMs: 2000 })]);
    live.render([row({ elapsedMs: 3000 })]);

    // The stopwatch is not news. Counting it as a change buried every real event under a per-second log.
    expect(written).toEqual([]);
  });

  it("prints again as soon as the agent does something new", () => {
    const { live, written } = harness({ tty: false });
    live.render([row()]);
    written.length = 0;

    live.render([row({ doing: "edit add the csv writer" })]);

    expect(written.join("")).toContain("edit add the csv writer");
  });

  it("reports each agent's result once it is done", () => {
    const { live, all } = harness({ tty: false });
    live.render([row({ state: "done", result: "+13 −0" })]);

    expect(all()).toContain("· done — +13 −0");
  });
});
