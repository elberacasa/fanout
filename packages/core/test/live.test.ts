import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialState, Ledger, LiveProjection, project } from "../src/index.ts";
import { samples } from "./fixtures/events.ts";

let ledger: Ledger;

beforeEach(() => {
  ledger = Ledger.open(":memory:");
});

afterEach(() => {
  ledger.close();
});

describe("LiveProjection", () => {
  it("starts empty and picks up the first append", () => {
    const live = new LiveProjection(ledger);
    expect(live.current()).toEqual(initialState());
    const event = ledger.append(samples["mission.created"]);
    expect(live.current()).toEqual(project([event]));
  });

  it("reads zero events on a second call with no appends", () => {
    const events = ledger.appendAll(Object.values(samples));
    const read = ledger.read.bind(ledger);
    let eventsRead = 0;
    const live = new LiveProjection({
      read(options) {
        const batch = read(options);
        eventsRead += batch.length;
        return batch;
      },
    });

    expect(live.current()).toEqual(project(events));
    expect(eventsRead).toBe(events.length);
    eventsRead = 0;
    const current = live.current();
    // Equal state alone would also pass after decoding and refolding the entire history.
    expect(eventsRead).toBe(0);
    expect(current).toEqual(project(events));
  });

  it("reads only each new batch and preserves previous snapshots", () => {
    const events = ledger.appendAll([
      samples["mission.created"],
      samples["run.queued"],
      samples["run.usage"],
    ]);
    const read = vi.spyOn(ledger, "read");
    const live = new LiveProjection(ledger);
    const before = live.current();

    for (const input of [samples["run.usage"], samples["run.finished"]]) {
      const cursor = events.at(-1)?.seq;
      events.push(ledger.append(input));
      expect(live.current()).toEqual(project(events));
      expect(read).toHaveBeenLastCalledWith({ afterSeq: cursor });
      expect(read.mock.results.at(-1)?.value).toHaveLength(1);
    }
    expect(before).toEqual(project(events.slice(0, 3)));
  });

  it("advances past anomalies without recording them again", () => {
    const live = new LiveProjection(ledger);
    const event = ledger.append(samples["run.progress"]);
    const state = live.current();
    expect(state.lastSeq).toBe(event.seq);
    expect(state.anomalies).toHaveLength(1);
    expect(live.current()).toEqual(state);
    ledger.append(samples["mission.created"]);
    expect(live.current()).toEqual(project(ledger.read()));
  });

  it("surfaces a failed read and retries from the last successful fold", () => {
    const live = new LiveProjection(ledger);
    ledger.append(samples["mission.created"]);
    const before = live.current();
    ledger.append(samples["run.queued"]);
    const read = vi.spyOn(ledger, "read").mockImplementationOnce(() => {
      throw new Error("ledger unavailable");
    });

    expect(() => live.current()).toThrow("ledger unavailable");
    const current = live.current();
    expect(read).toHaveBeenLastCalledWith({ afterSeq: before.lastSeq });
    expect(current).toEqual(project(ledger.read()));
  });
});
