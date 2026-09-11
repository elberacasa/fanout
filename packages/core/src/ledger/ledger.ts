import { randomUUID } from "node:crypto";
import { chmodSync, closeSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { z } from "zod";
import {
  EVENT_VERSION,
  EventStamp,
  FanoutEvent,
  type FanoutEventInput,
  type StoredEvent,
} from "../schema/events.ts";

/*
 * The ledger is the single source of truth: an append-only SQLite table of validated events.
 * Append-only is enforced by the database (triggers abort any UPDATE or DELETE), not just by this API.
 * Every row is validated on the way in and again on the way out, so a damaged ledger fails loudly.
 */

const SCHEMA_VERSION = 1;

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS events (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  id         TEXT    NOT NULL UNIQUE,
  ts         TEXT    NOT NULL,
  v          INTEGER NOT NULL,
  type       TEXT    NOT NULL,
  mission_id TEXT,
  run_id     TEXT,
  body       TEXT    NOT NULL CHECK (json_valid(body))
) STRICT;
CREATE INDEX IF NOT EXISTS events_by_mission ON events (mission_id, seq);
CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events
  BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events
  BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
`;

const GUARD_TRIGGERS = ["events_no_update", "events_no_delete"] as const;

export class LedgerError extends Error {
  override name = "LedgerError";
}

/** An event that does not match the schema. Nothing was written. */
export class InvalidEventError extends LedgerError {
  override name = "InvalidEventError";
  readonly index: number;

  constructor(index: number, detail: string) {
    super(`Event ${index} is invalid, nothing was written:\n${detail}`);
    this.index = index;
  }
}

/** A ledger or an event written by a newer Fanout. We refuse to guess at it. */
export class UnsupportedLedgerError extends LedgerError {
  override name = "UnsupportedLedgerError";
}

export interface LedgerOptions {
  /** Clock for event timestamps (tests inject a fixed one). */
  now?: () => Date;
  /** Event id generator; must return UUIDs. */
  newId?: () => string;
}

export interface ReadOptions {
  /** Only events with a larger sequence number. */
  afterSeq?: number;
  /** Only events of this mission. */
  missionId?: string;
  /** At most this many events. */
  limit?: number;
}

const Row = z.object({
  seq: z.number(),
  id: z.string(),
  ts: z.string(),
  v: z.number(),
  body: z.string(),
});

export class Ledger {
  readonly #db: DatabaseSync;
  readonly #now: () => Date;
  readonly #newId: () => string;
  readonly #insert: StatementSync;
  readonly #readAll: StatementSync;
  readonly #readMission: StatementSync;
  readonly #lastSeq: StatementSync;

  private constructor(db: DatabaseSync, options: LedgerOptions) {
    this.#db = db;
    this.#now = options.now ?? (() => new Date());
    this.#newId = options.newId ?? randomUUID;
    this.#insert = db.prepare(
      "INSERT INTO events (id, ts, v, type, mission_id, run_id, body) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    this.#readAll = db.prepare("SELECT seq, id, ts, v, body FROM events WHERE seq > ? ORDER BY seq LIMIT ?");
    this.#readMission = db.prepare(
      "SELECT seq, id, ts, v, body FROM events WHERE seq > ? AND mission_id = ? ORDER BY seq LIMIT ?",
    );
    this.#lastSeq = db.prepare("SELECT COALESCE(MAX(seq), 0) AS seq FROM events");
  }

  /**
   * Opens (or creates) a ledger. Use ":memory:" for a throwaway one. On disk, the file is private to the user
   * (mode 600, directory 700).
   */
  static open(path: string, options: LedgerOptions = {}): Ledger {
    const onDisk = path !== ":memory:";
    if (onDisk) {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      closeSync(openSync(path, "a", 0o600));
      chmodSync(path, 0o600);
    }
    const db = new DatabaseSync(path);
    try {
      db.exec("PRAGMA busy_timeout = 5000");
      if (onDisk) db.exec("PRAGMA journal_mode = WAL");
      db.exec("PRAGMA synchronous = FULL");
      migrate(db);
      return new Ledger(db, options);
    } catch (error) {
      db.close();
      throw error;
    }
  }

  /** Validates and records one event; returns it with its stamp. */
  append(input: FanoutEventInput): StoredEvent {
    const [stored] = this.appendAll([input]);
    if (stored === undefined) throw new LedgerError("append recorded nothing");
    return stored;
  }

  /** Validates every event first, then records them all in one transaction, or none of them. */
  appendAll(inputs: readonly FanoutEventInput[]): StoredEvent[] {
    const events = inputs.map((input, index) => {
      const result = FanoutEvent.safeParse(input);
      if (!result.success) throw new InvalidEventError(index, z.prettifyError(result.error));
      return result.data;
    });

    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const stored = events.map((event): StoredEvent => {
        const stamp = EventStamp.omit({ seq: true }).parse({
          v: EVENT_VERSION,
          id: this.#newId(),
          ts: this.#now().toISOString(),
        });
        const result = this.#insert.run(
          stamp.id,
          stamp.ts,
          stamp.v,
          event.type,
          "missionId" in event ? event.missionId : null,
          "runId" in event ? event.runId : null,
          JSON.stringify(event),
        );
        return { ...event, ...stamp, seq: Number(result.lastInsertRowid) };
      });
      this.#db.exec("COMMIT");
      return stored;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  /** Events in sequence order. */
  read(options: ReadOptions = {}): StoredEvent[] {
    const afterSeq = options.afterSeq ?? 0;
    const limit = options.limit ?? -1;
    const rows =
      options.missionId === undefined
        ? this.#readAll.all(afterSeq, limit)
        : this.#readMission.all(afterSeq, options.missionId, limit);
    return rows.map(decode);
  }

  /** The sequence number of the last event, or 0 for an empty ledger. */
  lastSeq(): number {
    const row = this.#lastSeq.get();
    return Number(row?.["seq"] ?? 0);
  }

  close(): void {
    this.#db.close();
  }
}

function migrate(db: DatabaseSync): void {
  const version = userVersion(db);
  if (version > SCHEMA_VERSION) {
    throw new UnsupportedLedgerError(
      `This ledger was written by a newer Fanout (schema ${version}; this one reads ${SCHEMA_VERSION}). ` +
        "Update Fanout to open it.",
    );
  }
  if (version < SCHEMA_VERSION) {
    db.exec("BEGIN IMMEDIATE");
    try {
      if (userVersion(db) < SCHEMA_VERSION) {
        db.exec(SCHEMA_V1);
        db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  const triggers = new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'events'")
      .all()
      .map((row) => String(row["name"])),
  );
  const missing = GUARD_TRIGGERS.filter((name) => !triggers.has(name));
  if (missing.length > 0) {
    throw new LedgerError(
      `This ledger lost its append-only guard (${missing.join(", ")}); refusing to use it.`,
    );
  }
}

function userVersion(db: DatabaseSync): number {
  return Number(db.prepare("PRAGMA user_version").get()?.["user_version"] ?? 0);
}

function decode(raw: unknown): StoredEvent {
  const row = Row.parse(raw);
  if (row.v !== EVENT_VERSION) {
    throw new UnsupportedLedgerError(
      `Event ${row.seq} has version ${row.v}; this Fanout reads version ${EVENT_VERSION}. Update Fanout to read it.`,
    );
  }
  let body: unknown;
  try {
    body = JSON.parse(row.body);
  } catch {
    throw new LedgerError(`Event ${row.seq} is not valid JSON; the ledger is damaged.`);
  }
  const event = FanoutEvent.safeParse(body);
  const stamp = EventStamp.safeParse({ v: row.v, id: row.id, seq: row.seq, ts: row.ts });
  if (!event.success || !stamp.success) {
    const detail = event.error ?? stamp.error;
    throw new LedgerError(
      `Event ${row.seq} does not match the schema; the ledger is damaged.` +
        (detail === undefined ? "" : `\n${z.prettifyError(detail)}`),
    );
  }
  return { ...event.data, ...stamp.data };
}
