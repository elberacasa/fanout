import { Ledger, type SeatInfo, type StoredEvent } from "@fanout/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startApi, type ApiServer } from "../src/api/server.ts";

/*
 * The daemon's door, tested through real HTTP and a real WebSocket. Anything on the machine can reach a loopback
 * port, so most of these tests are about who is turned away.
 */

const TOKEN = "t".repeat(43);

const seat: SeatInfo = {
  id: "codex",
  displayName: "OpenAI Codex",
  binary: "codex",
  version: "0.154.0",
  supported: true,
  signedIn: "yes",
  models: [],
  efforts: [],
  billing: "subscription",
};

let ledger: Ledger;
let api: ApiServer;

async function get(path: string, init: RequestInit = {}): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${api.url}${path}`, init);
  return { status: response.status, body: await response.json().catch(() => null) };
}

function authorized(path: string): Promise<{ status: number; body: unknown }> {
  return get(path, { headers: { authorization: `Bearer ${TOKEN}` } });
}

/** Opens a subscription and collects messages until it has `count` of them. */
function subscribe(
  query: string,
  count: number,
): Promise<{ socket: WebSocket; messages: Promise<unknown[]> }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${api.url.replace("http", "ws")}/events${query}`);
    const messages: unknown[] = [];
    let settle: (() => void) | undefined;
    const collected = new Promise<unknown[]>((done) => {
      settle = () => {
        done(messages);
      };
      if (count === 0) done(messages);
    });
    socket.addEventListener("message", (event) => {
      messages.push(JSON.parse(String(event.data)));
      if (messages.length >= count) settle?.();
    });
    socket.addEventListener("open", () => {
      resolve({ socket, messages: collected });
    });
    socket.addEventListener("error", () => {
      reject(new Error("the daemon refused the subscription"));
    });
  });
}

const mission = {
  type: "mission.created",
  missionId: "demo",
  goal: "Add CSV export",
  repo: { root: "/work", baseCommit: "0".repeat(40) },
  limits: { maxParallel: 2, timeoutMinutes: 30 },
} as const;

beforeEach(async () => {
  ledger = Ledger.open(":memory:");
  ledger.append(mission);
  api = await startApi({ ledger, token: TOKEN, crew: () => Promise.resolve([seat]) });
});

afterEach(async () => {
  await api.close();
  ledger.close();
});

describe("who the daemon answers", () => {
  it("binds to the loopback address only", () => {
    expect(api.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it("answers health without a token, because it says nothing about you", async () => {
    expect(await get("/health")).toMatchObject({ status: 200, body: { ok: true, name: "fanout" } });
  });

  it.each([
    ["no token", {}],
    ["a wrong token", { authorization: "Bearer wrong" }],
    ["an empty bearer", { authorization: "Bearer " }],
  ])("refuses the crew with %s", async (_, headers) => {
    const { status, body } = await get("/crew", { headers });
    expect(status).toBe(401);
    expect(JSON.stringify(body)).toContain("token");
  });

  it("refuses a request that came from a web page", async () => {
    const { status } = await get("/crew", {
      headers: { authorization: `Bearer ${TOKEN}`, origin: "https://example.invalid" },
    });
    expect(status).toBe(403);
  });

  it("refuses to be written to, for now", async () => {
    const { status } = await get("/events", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(status).toBe(405);
  });

  it("says plainly when nothing lives at a path", async () => {
    expect(await authorized("/missions/nope")).toMatchObject({ status: 404 });
  });
});

describe("reading what the daemon knows", () => {
  it("gives the crew as detected", async () => {
    expect(await authorized("/crew")).toMatchObject({ status: 200, body: { seats: [seat] } });
  });

  it("gives events, and where the ledger has got to", async () => {
    const { body } = await authorized("/events");
    const result = body as { events: StoredEvent[]; lastSeq: number };
    expect(result.events.map((event) => event.type)).toEqual(["mission.created"]);
    expect(result.lastSeq).toBe(1);
  });

  it("reads from where a client left off", async () => {
    ledger.append({ type: "run.progress", missionId: "demo", runId: "api-1", phase: "coding" });
    const { body } = await authorized("/events?afterSeq=1");
    expect((body as { events: StoredEvent[] }).events.map((event) => event.seq)).toEqual([2]);
  });

  it("keeps one mission's events to itself", async () => {
    ledger.append({ ...mission, missionId: "other" });
    const { body } = await authorized("/events?missionId=other");
    expect((body as { events: StoredEvent[] }).events).toHaveLength(1);
  });
});

describe("subscribing to what happens next", () => {
  it("replays what already happened, then tells you as it happens", async () => {
    const { socket, messages } = await subscribe(`?token=${TOKEN}`, 2);
    api.publish(ledger.append({ type: "run.progress", missionId: "demo", runId: "api-1", phase: "coding" }));

    const received = (await messages) as StoredEvent[];
    expect(received.map((event) => event.type)).toEqual(["mission.created", "run.progress"]);
    socket.close();
  });

  it("can be narrowed to the events a lead acts on", async () => {
    const { socket, messages } = await subscribe(`?token=${TOKEN}&for=lead`, 1);
    api.publish(ledger.append({ type: "run.progress", missionId: "demo", runId: "api-1", phase: "coding" }));
    api.publish(
      ledger.append({
        type: "run.finished",
        missionId: "demo",
        runId: "api-1",
        status: "done",
        exitCode: 0,
      }),
    );

    const received = (await messages) as StoredEvent[];
    expect(received.map((event) => event.type)).toEqual(["run.finished"]);
    socket.close();
  });

  it("can be narrowed to one mission", async () => {
    const { socket, messages } = await subscribe(`?token=${TOKEN}&missionId=other&afterSeq=1`, 1);
    api.publish(ledger.append({ type: "run.progress", missionId: "demo", runId: "api-1", phase: "coding" }));
    api.publish(ledger.append({ ...mission, missionId: "other" }));

    const received = (await messages) as StoredEvent[];
    expect(received.every((event) => "missionId" in event && event.missionId === "other")).toBe(true);
    socket.close();
  });

  it("refuses a subscription with no token", async () => {
    await expect(subscribe("", 0)).rejects.toThrow(/refused/);
  });
});
