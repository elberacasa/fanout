import { Ledger, type SeatInfo, type StoredEvent } from "fanout-core";
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
  plan: null,
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

/*
 * The daemon's only write route, and the only place in the product where a human acts on the ledger directly
 * rather than through an agent. Most of what follows is about what it refuses.
 */
describe("approving a merge from the mission view", () => {
  const REV = "a".repeat(64);
  const line = {
    id: "api",
    title: "CSV export",
    role: "builder" as const,
    prompt: "Add it.",
    seat: { id: "codex" },
    scope: { write: ["src/api/csv.ts"] },
    dependsOn: [],
    checks: ["npm test"],
    fixesBug: false,
  };

  /** A run that has been reviewed and checked at the same revision: everything but the person's yes. */
  function reviewedAndChecked(): void {
    ledger.appendAll([
      { type: "plan.proposed", missionId: "demo", plan: { lines: [line] }, by: "lead" },
      {
        type: "run.queued",
        missionId: "demo",
        runId: "api-1",
        lineId: "api",
        seat: { id: "codex" },
        attempt: 1,
      },
      { type: "run.started", missionId: "demo", runId: "api-1", workdir: "/w", argv: ["codex"] },
      { type: "run.finished", missionId: "demo", runId: "api-1", status: "done", exitCode: 0 },
      {
        type: "review.done",
        missionId: "demo",
        runId: "api-1",
        revision: REV,
        by: { id: "codex" },
        verdict: "accept",
        notes: "fine",
      },
      {
        type: "checks.done",
        missionId: "demo",
        runId: "api-1",
        revision: REV,
        ok: true,
        summary: "1 check passed",
        commands: ["npm test"],
      },
    ]);
  }

  function approve(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
    return fetch(`${api.url}/approve`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  }

  it("records the yes as direct, because the daemon saw the click itself", async () => {
    reviewedAndChecked();

    const response = await approve({ missionId: "demo", runId: "api-1" });
    expect(response.status).toBe(200);

    const approval = ledger.read().find((event) => event.type === "merge.approved");
    // `via: direct` is the whole point: an agent's account of a conversation cannot produce this event.
    expect(approval).toMatchObject({ revision: REV, by: { kind: "user", via: "direct" } });
  });

  /*
   * The revision is the one review judged, never one the caller sends. An approval is consent to a specific diff,
   * and a page that could name the revision could approve work it had never seen.
   */
  it("approves the revision that was judged, whatever the caller says", async () => {
    reviewedAndChecked();

    await approve({ missionId: "demo", runId: "api-1", revision: "b".repeat(64) });

    const approval = ledger.read().find((event) => event.type === "merge.approved");
    expect(approval).toMatchObject({ revision: REV });
  });

  it("refuses work nobody has reviewed, and says what is missing", async () => {
    ledger.appendAll([
      { type: "plan.proposed", missionId: "demo", plan: { lines: [line] }, by: "lead" },
      {
        type: "run.queued",
        missionId: "demo",
        runId: "api-1",
        lineId: "api",
        seat: { id: "codex" },
        attempt: 1,
      },
      { type: "run.started", missionId: "demo", runId: "api-1", workdir: "/w", argv: ["codex"] },
      { type: "run.finished", missionId: "demo", runId: "api-1", status: "done", exitCode: 0 },
      {
        type: "checks.done",
        missionId: "demo",
        runId: "api-1",
        revision: REV,
        ok: true,
        summary: "1 check passed",
        commands: ["npm test"],
      },
    ]);

    const response = await approve({ missionId: "demo", runId: "api-1" });
    expect(response.status).toBe(409);
    expect(JSON.stringify(await response.json())).toContain("Nobody has reviewed this diff");
    expect(ledger.read().some((event) => event.type === "merge.approved")).toBe(false);
  });

  it("refuses a page on another site, which is the attack this route invites", async () => {
    reviewedAndChecked();

    const response = await approve(
      { missionId: "demo", runId: "api-1" },
      { origin: "https://example.invalid" },
    );
    expect(response.status).toBe(403);
    expect(ledger.read().some((event) => event.type === "merge.approved")).toBe(false);
  });

  it("refuses without the daemon's token", async () => {
    reviewedAndChecked();

    const response = await fetch(`${api.url}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ missionId: "demo", runId: "api-1" }),
    });
    expect(response.status).toBe(401);
    expect(ledger.read().some((event) => event.type === "merge.approved")).toBe(false);
  });

  /*
   * A run that was reworked keeps the `rework` verdict that caused the rework, so it can never become
   * mergeable — and it sat in "Waiting on you" for ever, asking to be dealt with when the attempt that dealt
   * with it had already been merged. Two were still there hours after their mission finished.
   */
  it("stops asking about a run that has already been reworked", async () => {
    reviewedAndChecked();
    ledger.appendAll([
      {
        type: "review.done",
        missionId: "demo",
        runId: "api-1",
        revision: REV,
        by: { id: "codex" },
        verdict: "rework",
        notes: "change the header row",
      },
      {
        type: "run.queued",
        missionId: "demo",
        runId: "api-2",
        lineId: "api",
        seat: { id: "codex" },
        attempt: 2,
      },
      { type: "run.started", missionId: "demo", runId: "api-2", workdir: "/w", argv: ["codex"] },
      { type: "run.finished", missionId: "demo", runId: "api-2", status: "done", exitCode: 0 },
    ]);

    const { body } = await authorized("/state");
    const waiting = (body as { waiting: { runId: string }[] }).waiting;

    expect(waiting.map((item) => item.runId)).toEqual(["api-2"]);
  });

  it("says which repository a waiting run came from, since one daemon serves them all", async () => {
    reviewedAndChecked();

    const { body } = await authorized("/state");
    const waiting = (body as { waiting: { repo: string }[] }).waiting;

    expect(waiting[0]?.repo).toBe("/work");
  });

  it("refuses a run it has never heard of", async () => {
    expect((await approve({ missionId: "demo", runId: "ghost-1" })).status).toBe(404);
  });
});
