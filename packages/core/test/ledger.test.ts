import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FanoutEvent, type FanoutEventInput } from "../src/index.ts";
import {
  InvalidEventError,
  Ledger,
  LedgerError,
  UnsupportedLedgerError,
  type LedgerOptions,
} from "../src/ledger/ledger.ts";
import { samples } from "./fixtures/events.ts";

const FIXED: LedgerOptions = { now: () => new Date("2026-09-11T17:00:00.000Z") };
const all: FanoutEventInput[] = Object.values(samples);

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "fanout-ledger-"));
  path = join(dir, "state", "ledger.db");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("Ledger", () => {
  it("stamps and returns an appended event", () => {
    const ledger = Ledger.open(":memory:", FIXED);
    const stored = ledger.append(samples["run.progress"]);
    expect(stored).toMatchObject({
      ...samples["run.progress"],
      v: 1,
      seq: 1,
      ts: "2026-09-11T17:00:00.000Z",
    });
    expect(stored.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(ledger.lastSeq()).toBe(1);
    ledger.close();
  });

  it("round-trips every event type in order", () => {
    const ledger = Ledger.open(":memory:", FIXED);
    const written = ledger.appendAll(all);
    const read = ledger.read();
    expect(read).toEqual(written);
    expect(read.map((event) => event.seq)).toEqual(all.map((_, index) => index + 1));
    read.forEach((event, index) => {
      expect(event).toMatchObject(FanoutEvent.parse(all[index]));
    });
    ledger.close();
  });

  it("rejects an invalid event and writes nothing", () => {
    const ledger = Ledger.open(":memory:");
    ledger.append(samples["mission.created"]);
    const bad = { ...samples["run.progress"], phase: "dreaming" } as unknown as FanoutEventInput;
    expect(() => ledger.append(bad)).toThrow(InvalidEventError);
    expect(() => ledger.appendAll([samples["run.tool"], bad])).toThrow(/Event 1 is invalid/);
    expect(ledger.lastSeq()).toBe(1);
    ledger.close();
  });

  it("refuses an id generator that doesn't produce UUIDs, before writing", () => {
    const ledger = Ledger.open(":memory:", { newId: () => "not-a-uuid" });
    expect(() => ledger.append(samples["run.progress"])).toThrow();
    expect(ledger.lastSeq()).toBe(0);
    ledger.close();
  });

  it("filters by mission, position and count", () => {
    const ledger = Ledger.open(":memory:");
    ledger.appendAll([
      samples["seat.detected"],
      samples["mission.created"],
      { ...samples["mission.created"], missionId: "other" },
      samples["run.progress"],
    ]);
    expect(ledger.read({ missionId: "csv-export" }).map((event) => event.seq)).toEqual([2, 4]);
    expect(ledger.read({ afterSeq: 2 }).map((event) => event.seq)).toEqual([3, 4]);
    expect(ledger.read({ limit: 2 }).map((event) => event.seq)).toEqual([1, 2]);
    ledger.close();
  });

  it("persists across reopening and continues the sequence", () => {
    const first = Ledger.open(path);
    first.appendAll([samples["mission.created"], samples["run.progress"]]);
    first.close();
    const second = Ledger.open(path);
    expect(second.read()).toHaveLength(2);
    expect(second.append(samples["run.tool"]).seq).toBe(3);
    second.close();
  });

  it("keeps the ledger private to the user", () => {
    Ledger.open(path).close();
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, "state")).mode & 0o777).toBe(0o700);
  });

  it("is append-only at the database level", () => {
    const ledger = Ledger.open(path);
    ledger.append(samples["mission.created"]);
    const raw = new DatabaseSync(path);
    expect(() => {
      raw.exec("UPDATE events SET type = 'x'");
    }).toThrow(/append-only/);
    expect(() => {
      raw.exec("DELETE FROM events");
    }).toThrow(/append-only/);
    raw.close();
    expect(ledger.read()).toHaveLength(1);
    ledger.close();
  });

  it("refuses a ledger whose append-only guard was removed", () => {
    Ledger.open(path).close();
    const raw = new DatabaseSync(path);
    raw.exec("DROP TRIGGER events_no_delete");
    raw.close();
    expect(() => Ledger.open(path)).toThrow(/append-only guard/);
  });

  it("refuses a ledger from a newer Fanout", () => {
    Ledger.open(path).close();
    const raw = new DatabaseSync(path);
    raw.exec("PRAGMA user_version = 2");
    raw.close();
    expect(() => Ledger.open(path)).toThrow(UnsupportedLedgerError);
  });

  it("refuses to read an event version it doesn't know", () => {
    const ledger = Ledger.open(path);
    const raw = new DatabaseSync(path);
    raw
      .prepare("INSERT INTO events (id, ts, v, type, body) VALUES (?, ?, 2, 'run.progress', '{}')")
      .run("2f6c7b1e-4a52-4c3e-9a0f-4f1d7c9e8b21", "2026-09-11T17:00:00.000Z");
    raw.close();
    expect(() => ledger.read()).toThrow(UnsupportedLedgerError);
    ledger.close();
  });

  it("fails loudly on a damaged event", () => {
    const ledger = Ledger.open(path);
    const raw = new DatabaseSync(path);
    raw
      .prepare("INSERT INTO events (id, ts, v, type, body) VALUES (?, ?, 1, 'run.progress', ?)")
      .run("2f6c7b1e-4a52-4c3e-9a0f-4f1d7c9e8b21", "2026-09-11T17:00:00.000Z", '{"type":"run.progress"}');
    raw.close();
    const error = captureError(() => ledger.read());
    expect(error).toBeInstanceOf(LedgerError);
    expect(error?.message).toMatch(/Event 1 does not match the schema/);
    ledger.close();
  });

  it("gives unique, increasing sequence numbers to two writers on one file", () => {
    const a = Ledger.open(path);
    const b = Ledger.open(path);
    for (let i = 0; i < 20; i += 1) {
      (i % 2 === 0 ? a : b).append(samples["run.progress"]);
    }
    const seqs = a.read().map((event) => event.seq);
    expect(seqs).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
    a.close();
    b.close();
  });
});

function captureError(action: () => unknown): Error | undefined {
  try {
    action();
  } catch (error) {
    return error instanceof Error ? error : undefined;
  }
  return undefined;
}
