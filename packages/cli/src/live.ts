/*
 * A terminal that keeps up with the crew.
 *
 * `fanout demo` used to print a header, go silent for half a minute while three agents worked, and then drop a
 * table of run ids on the floor. Everything interesting happened somewhere the viewer could not see, and the
 * first impression of the product was a frozen screen.
 *
 * Two rules shape this file.
 *
 * **The agent is the subject.** A row says who is working and what they are doing right now, in the words the
 * agent used — `reading src/api/orders.ts`, not `api-1 · fake · ▪▪▫▫`. Ids and phase glyphs are a debugging view
 * of a mission; they are not what a person wants to know while it runs.
 *
 * **A pipe is not a terminal.** Redrawing in place needs a TTY and a person watching. Piped into a file, a CI log
 * or `verify:pack`, the same render appends one line per real change instead — no escape codes, no rewritten
 * history, and every state a reader might grep for still shown exactly once.
 */

/** One agent, as a person watching would describe it. */
export interface LiveRow {
  /** Who is working. The demo's simulated crew are Agent 1, 2, 3; a real mission names the seat. */
  who: string;
  /** What they were asked for, in the plan's own words. */
  task: string;
  /** What they are doing at this moment, from their own output. Empty while queued. */
  doing: string;
  /** Finished rows keep their result here instead of a live action. */
  result?: string;
  state: "waiting" | "working" | "done" | "failed";
  /** Milliseconds since the agent started, or null before it did. */
  elapsedMs: number | null;
}

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const MARK = { waiting: "·", working: "", done: "✓", failed: "✗" } as const;

/* Dim and green only. A demo that reaches for six colours looks like a toy; restraint reads as confidence. */
const DIM = "[2m";
const GREEN = "[32m";
const RED = "[31m";
const RESET = "[0m";
const HIDE_CURSOR = "[?25l";
const SHOW_CURSOR = "[?25h";

export interface LiveOptions {
  write: (text: string) => void;
  /** False for a pipe or a CI log, where cursor movement is noise rather than motion. */
  tty: boolean;
  /** How wide the terminal is. Defaults to the real one, or 80 where nothing says. */
  columns?: number;
}

/**
 * Draws the crew, over and over, without the screen ever flickering or scrolling away.
 *
 * It redraws only the rows it printed last time, so anything already above — the goal, the header — stays put and
 * the block never scrolls. A row is written once and then rewritten in place, which is what makes a terminal feel
 * alive rather than chatty.
 */
export function createLive(options: LiveOptions) {
  const write = options.write;
  let printed = 0;
  let frame = 0;
  /** What each row last said, so a pipe can print a line only when something actually changed. */
  const said = new Map<string, string>();
  /** The widest each column has ever been, so it never narrows again mid-mission. */
  const widest = new Map<string, number>();
  let cursorHidden = false;

  const render = (rows: readonly LiveRow[]): void => {
    if (!options.tty) {
      for (const row of rows) {
        /*
         * The clock is deliberately not part of what counts as a change. Including it printed a line per agent
         * per second — a log where the interesting moments are buried under a stopwatch. What changed is the
         * state and the action; the time is just stamped on whichever line reports it.
         */
        const key = `${row.state}|${row.result ?? row.doing}`;
        if (said.get(row.who) === key) continue;
        said.set(row.who, key);
        write(`${plainLine(row)}\n`);
      }
      return;
    }

    if (!cursorHidden) {
      write(HIDE_CURSOR);
      cursorHidden = true;
    }
    // Back to the top of the block we drew last time, so this frame replaces it rather than following it.
    if (printed > 0) write(`[${String(printed)}A`);

    /*
     * Column widths only ever grow.
     *
     * Measuring each frame afresh made the layout twitch: `shell npm run check` is wide, the `+8 −2` that
     * replaces it is narrow, and the clock jumped left the moment an agent finished. A table that rearranges
     * itself while you read it is the thing that makes a terminal feel cheap, and it costs a few trailing
     * spaces to hold still.
     */
    const widthOf = (key: string, pick: (row: LiveRow) => string): number => {
      const wanted = rows.reduce((wide, row) => Math.max(wide, pick(row).length), 0);
      const held = Math.max(widest.get(key) ?? 0, wanted);
      widest.set(key, held);
      return held;
    };
    const whoWidth = widthOf("who", (row) => row.who);
    const taskWidth = widthOf("task", (row) => row.task);
    /*
     * The action is the column that gives way when the terminal is narrow. A wrapped row breaks the redraw
     * outright — the cursor moves back by lines, not by rows, so one wrap leaves the block drawing over itself.
     * Truncating is the difference between a tight layout and a corrupted screen.
     */
    /*
     * `process.stdout.columns` is declared as a number and is genuinely `undefined` when stdout is not a
     * terminal — which is precisely when this code runs in CI. Read it as it really is; taking the declaration
     * at its word makes the budget `NaN` and every row collapses to the minimum.
     */
    const real = process.stdout.columns as number | undefined;
    const budget = (options.columns ?? real ?? 80) - (whoWidth + taskWidth + 16);
    const saidWidth = Math.max(
      8,
      Math.min(
        widthOf("said", (row) => row.result ?? row.doing),
        budget,
      ),
    );

    frame = (frame + 1) % FRAMES.length;
    for (const row of rows) {
      const spinner = row.state === "working" ? FRAMES[frame] : MARK[row.state];
      const colour = row.state === "done" ? GREEN : row.state === "failed" ? RED : "";
      const said = fit(row.result ?? row.doing, saidWidth);
      const time = row.elapsedMs === null ? "" : clock(row.elapsedMs);

      // `[K` clears to the end of the line: a shorter action must not leave the tail of a longer one.
      write(
        `  ${colour}${spinner}${RESET} ` +
          `${row.who.padEnd(whoWidth)}  ` +
          `${row.task.padEnd(taskWidth)}  ` +
          `${DIM}${said.padEnd(saidWidth)}${RESET}` +
          (time === "" ? "" : `  ${DIM}${time}${RESET}`) +
          `[K\n`,
      );
    }
    printed = rows.length;
  };

  /** Gives the terminal back. A demo that leaves the cursor hidden has broken the shell it was showing off in. */
  const stop = (): void => {
    if (cursorHidden) {
      write(SHOW_CURSOR);
      cursorHidden = false;
    }
  };

  return { render, stop };
}

/** Shortened to fit, with an ellipsis so a reader knows something was cut rather than missing. */
function fit(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, Math.max(1, width - 1))}…`;
}

/** `0:04`, `1:12`, `11:30` — a clock, because that is how people read a stopwatch. */
function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(total / 60))}:${String(total % 60).padStart(2, "0")}`;
}

/** One line for a log: no colour, no spinner, and only when something changed. */
function plainLine(row: LiveRow): string {
  const said = row.result ?? row.doing;
  const time = row.elapsedMs === null ? "" : ` (${clock(row.elapsedMs)})`;
  return `  ${row.who} · ${row.task} · ${row.state}${said === "" ? "" : ` — ${said}`}${time}`;
}
