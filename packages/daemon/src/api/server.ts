import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import {
  blocksApproval,
  mergeReadiness,
  project,
  type EventType,
  type Ledger,
  type ProjectionState,
  type SeatInfo,
  type StoredEvent,
} from "fanout-core";
import { WebSocketServer, type WebSocket } from "ws";
import { originAllowed, tokenMatches } from "./token.ts";

/*
 * The daemon's only door. It binds to 127.0.0.1, never to an interface anyone else can reach, and every request
 * carries the daemon's token — "local" is not the same as "yours" on a shared machine. Requests that arrive with a
 * browser's Origin are refused before a handler sees them, so a web page cannot drive your crew.
 *
 * Two ways to read: ask for what is there now over HTTP, or subscribe over a WebSocket and be told as it happens.
 * The subscription is what the lead's Monitor listens to, which is why it can be narrowed to the events a lead
 * actually acts on: a feed that repeats everything is a feed nobody reads.
 */

/** The events a lead acts on. Everything else is for the mission view, which asks for the lot. */
export const LEAD_EVENTS: readonly EventType[] = [
  "run.finished",
  "merge.conflict",
  "policy.breach",
  "route.changed",
  "safety.report",
  "mission.finished",
];

export interface ApiOptions {
  ledger: Ledger;
  token: string;
  /** The crew as last detected. Async because asking the CLIs takes a moment. */
  crew?: () => Promise<readonly SeatInfo[]>;
  /** 0 asks the operating system for a free port, which is what tests want. */
  port?: number;
  /**
   * Starts a mission, when this daemon is one that can.
   *
   * Injected rather than built here, because running a mission needs adapters, manifests and limits — things the
   * API has no business knowing. Absent, the daemon is what it has always been: a window onto the ledger.
   *
   * It exists so a mission can outlive the session that asked for it. A runner inside a Claude Code session dies
   * with the terminal; one inside a daemon does not (ADR 0024).
   */
  launch?: (request: LaunchOrder) => Promise<{ ok: true } | { ok: false; why: string }>;

  /**
   * The mission view's HTML, with `{{TOKEN}}` wherever the page needs this daemon's token.
   *
   * Passed in rather than read from disk here so the daemon has no opinion about where the page lives, and so a
   * test can serve a one-line page without a file.
   */
  view?: () => string;
}

/** What the daemon needs to start a mission on somebody else's behalf. */
export interface LaunchOrder {
  missionId: string;
  goal: string;
  /** The repository the work happens in. A daemon serves every repository on the machine, not one. */
  repoRoot: string;
  plan: unknown;
  maxParallel: number;
}

export interface ApiServer {
  readonly port: number;
  readonly url: string;
  /** Tells every subscriber about an event that was just recorded. */
  publish(event: StoredEvent): void;
  close(): Promise<void>;
}

interface Subscriber {
  socket: WebSocket;
  types: ReadonlySet<EventType> | null;
  missionId: string | null;
}

export async function startApi(options: ApiOptions): Promise<ApiServer> {
  const subscribers = new Set<Subscriber>();
  const sockets = new Set<Socket>();

  const server = createServer((request, response) => {
    handle(request, response, options).catch((error: unknown) => {
      send(response, 500, { error: error instanceof Error ? error.message : "unknown error" });
    });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  const websockets = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    const url = parseUrl(request);
    const port = (server.address() as { port: number } | null)?.port ?? 0;
    const authorized =
      originAllowed(request.headers.origin, port) &&
      tokenMatches(
        options.token,
        request.headers.authorization ?? url.searchParams.get("token") ?? undefined,
      );

    if (!authorized || url.pathname !== "/events") {
      socket.write(`HTTP/1.1 ${authorized ? 404 : 401} ${authorized ? "Not Found" : "Unauthorized"}\r\n\r\n`);
      socket.destroy();
      return;
    }

    websockets.handleUpgrade(request, socket, head, (ws) => {
      const subscriber: Subscriber = {
        socket: ws,
        types: typesFrom(url),
        missionId: url.searchParams.get("missionId"),
      };
      subscribers.add(subscriber);
      ws.on("close", () => subscribers.delete(subscriber));

      // Replay first, then live: a subscriber that joins mid-mission still sees how it got here.
      const afterSeq = Number(url.searchParams.get("afterSeq") ?? 0);
      for (const event of options.ledger.read({ afterSeq })) {
        if (wanted(subscriber, event)) ws.send(JSON.stringify(event));
      }
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(options.port ?? 0, "127.0.0.1", resolve);
  });
  const port = (server.address() as { port: number } | null)?.port ?? 0;

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    publish(event) {
      for (const subscriber of subscribers) {
        if (wanted(subscriber, event)) subscriber.socket.send(JSON.stringify(event));
      }
    },
    close: () => close(server, websockets, sockets, subscribers),
  };
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  options: ApiOptions,
): Promise<void> {
  const url = parseUrl(request);
  const port = Number(request.headers.host?.split(":")[1] ?? 0);

  // Health says nothing about you, so it needs no token: it is how a client knows a daemon is there at all.
  if (url.pathname === "/health") {
    send(response, 200, { ok: true, name: "fanout" });
    return;
  }

  /*
   * The mission view itself, and the only route that answers a browser.
   *
   * It carries no data — the page asks for that with the token it is handed below — so serving it before the
   * Origin and token checks gives away nothing except that a daemon is running, which `/health` already says.
   * A browser cannot send an Authorization header on a plain navigation, which is why the token is stamped into
   * the page rather than demanded from it.
   */
  if (url.pathname === "/" && options.view !== undefined) {
    const page = options.view().replaceAll("{{TOKEN}}", options.token);
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      // It shows your source code: nothing about it may be cached, framed, or fetched from anywhere else.
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
    });
    response.end(page);
    return;
  }

  if (!originAllowed(request.headers.origin, port)) {
    send(response, 403, { error: "a page in a browser cannot drive the daemon" });
    return;
  }
  if (!tokenMatches(options.token, request.headers.authorization)) {
    send(response, 401, { error: "this daemon needs its token; it is in ~/.fanout/token" });
    return;
  }
  /*
   * The one thing this daemon lets a person do rather than read, and the reason it is worth the write route.
   *
   * An approval recorded through the lead's tool is a language model's account of a conversation: `via: relayed`,
   * and an agent that never asked writes a byte-identical event. This one is `via: direct` — the daemon received
   * the click itself, over loopback, with its own token, from the page it served. Nothing in between could have
   * invented it, and the ledger can finally tell the two apart.
   *
   * It approves and stops there. Merging needs a commit message in the repository's own convention, which the
   * lead writes; and leaving the apply to the gate means this route can never touch the user's tree.
   */
  if (request.method === "POST" && url.pathname === "/approve") {
    await approve(request, response, options);
    return;
  }

  /*
   * Handing a mission to something that will outlive the asker.
   *
   * The session that calls this may be gone in thirty seconds — that is the whole reason the route exists — so
   * it answers as soon as the runs are under way rather than when they finish, and everything after that is in
   * the ledger for whoever comes back.
   */
  if (request.method === "POST" && url.pathname === "/launch") {
    if (options.launch === undefined) {
      send(response, 501, { error: "this daemon only reads the ledger; it cannot run a mission" });
      return;
    }
    await launch(request, response, {
      start: options.launch,
      knows: (missionId) => project(options.ledger.read({ missionId })).missions[missionId] !== undefined,
    });
    return;
  }
  if (request.method !== "GET") {
    send(response, 405, { error: `${request.method ?? "that"} is not something this daemon does yet` });
    return;
  }

  /*
   * Everything the view draws, in one answer. The page redraws from a whole snapshot rather than stitching
   * together deltas, because a view that can drift from the ledger is a view that will eventually lie about it.
   */
  if (url.pathname === "/state") {
    const state = project(options.ledger.read());
    const seats = options.crew === undefined ? [] : await options.crew();
    send(response, 200, { state, seats, waiting: waitingOnYou(state), now: new Date().toISOString() });
    return;
  }

  if (url.pathname === "/crew") {
    const seats = options.crew === undefined ? [] : await options.crew();
    send(response, 200, { seats });
    return;
  }

  if (url.pathname === "/events") {
    const afterSeq = Number(url.searchParams.get("afterSeq") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? 500);
    const missionId = url.searchParams.get("missionId");
    const events = options.ledger.read({
      afterSeq: Number.isFinite(afterSeq) ? afterSeq : 0,
      limit: Number.isFinite(limit) ? Math.min(limit, 5000) : 500,
      ...(missionId === null ? {} : { missionId }),
    });
    send(response, 200, { events, lastSeq: options.ledger.lastSeq() });
    return;
  }

  send(response, 404, { error: `nothing lives at ${url.pathname}` });
}

/**
 * Records a person's yes, or explains why it cannot be given yet.
 *
 * The revision is the one review judged, never one the caller chose: an approval is consent to a specific diff,
 * and letting the page name it would let a stale page approve work it had not seen. If the worktree has moved
 * since, `mergeRun` collects the diff again, finds a revision the approval does not match, and refuses — which is
 * the same protection the lead's tool has, arrived at the same way.
 */
async function approve(
  request: IncomingMessage,
  response: ServerResponse,
  options: ApiOptions,
): Promise<void> {
  let body: { missionId?: unknown; runId?: unknown; note?: unknown };
  try {
    body = JSON.parse(await readBody(request)) as typeof body;
  } catch {
    send(response, 400, { error: "that was not JSON this daemon could read" });
    return;
  }
  const missionId = typeof body.missionId === "string" ? body.missionId : "";
  const runId = typeof body.runId === "string" ? body.runId : "";
  const note = typeof body.note === "string" ? body.note.slice(0, 2000) : "approved in the mission view";
  if (missionId === "" || runId === "") {
    send(response, 400, { error: "an approval needs a missionId and a runId" });
    return;
  }

  const state = project(options.ledger.read({ missionId }));
  const mission = state.missions[missionId];
  const run = mission?.runs[runId];
  const line = (mission?.plan?.lines ?? []).find((candidate) => candidate.id === run?.lineId);
  if (mission === undefined || run === undefined || line === undefined) {
    send(response, 404, { error: `no run ${runId} in ${missionId}` });
    return;
  }

  const revision = run.review?.revision ?? run.checks?.revision ?? "";
  if (revision === "") {
    send(response, 409, { error: "nothing has judged this diff yet, so there is no revision to approve" });
    return;
  }

  /*
   * Everything except the approval itself must already be satisfied. Recording a yes for work nobody reviewed
   * would put the strongest evidence in the ledger behind a diff that had earned none of it.
   */
  const standing = blocksApproval(mergeReadiness(run, line, revision));
  if (standing.length > 0) {
    send(response, 409, {
      error: "this is not ready for your approval yet",
      blockers: standing.map((blocker) => blocker.message),
    });
    return;
  }

  options.ledger.append({
    type: "merge.approved",
    missionId,
    runId,
    revision,
    by: { kind: "user", via: "direct" },
    note,
  });
  send(response, 200, { ok: true, runId, revision });
}

/** Reads a launch order and starts it, or says exactly which part it could not read. */
async function launch(
  request: IncomingMessage,
  response: ServerResponse,
  options: {
    start: (order: LaunchOrder) => Promise<{ ok: true } | { ok: false; why: string }>;
    knows: (missionId: string) => boolean;
  },
): Promise<void> {
  const { start } = options;
  let body: Partial<LaunchOrder>;
  try {
    body = JSON.parse(await readBody(request, 2 * 1024 * 1024)) as Partial<LaunchOrder>;
  } catch {
    send(response, 400, { error: "that was not JSON this daemon could read" });
    return;
  }

  const { missionId, goal, repoRoot, plan } = body;
  if (
    typeof missionId !== "string" ||
    typeof goal !== "string" ||
    typeof repoRoot !== "string" ||
    plan === undefined
  ) {
    send(response, 400, { error: "a launch needs a missionId, a goal, a repoRoot and a plan" });
    return;
  }

  /*
   * The mission has to exist before it can be run.
   *
   * The caller records `mission.created` and the plan, then asks for it to be started; without that the runs
   * this queues belong to a mission the ledger has never heard of, and every one of them lands as an anomaly.
   * Found by calling this route by hand and watching a launch succeed into nothing.
   */
  if (!options.knows(missionId)) {
    send(response, 409, {
      error: `${missionId} has not been recorded yet — create the mission and its plan before launching it`,
    });
    return;
  }

  const outcome = await start({
    missionId,
    goal,
    repoRoot,
    plan,
    maxParallel: typeof body.maxParallel === "number" ? body.maxParallel : 3,
  });

  if (!outcome.ok) {
    send(response, 409, { error: outcome.why });
    return;
  }
  send(response, 202, { ok: true, missionId });
}

/** The request's body, refusing anything large enough to be an attempt at exhausting the daemon. */
async function readBody(request: IncomingMessage, limit = 8 * 1024): Promise<string> {
  let body = "";
  for await (const chunk of request) {
    body += (chunk as Buffer).toString("utf8");
    if (body.length > limit) throw new Error("body too large");
  }
  return body;
}

/**
 * What each finished run still needs before it can merge, computed here rather than in the page.
 *
 * `mergeReadiness` is the gate's judgement and there is exactly one of it. A page that worked out its own answer
 * would eventually disagree with the tool that actually refuses, and the screen saying "ready" while the merge
 * says "no" is worse than the screen saying nothing — this repository has spent a day proving that a rule with
 * two implementations ends up with two behaviours.
 */
function waitingOnYou(state: ProjectionState): {
  missionId: string;
  runId: string;
  task: string;
  seat: string;
  ready: boolean;
  /**
   * Your yes is the only thing missing.
   *
   * Distinct from `ready`, which means the gate would merge this now — and which can only become true *after*
   * someone approves, since a missing approval is itself a blocker. Without this flag the page could never tell
   * the one state where a person actually has something to do.
   */
  approvable: boolean;
  blockers: string[];
}[] {
  const waiting = [];
  for (const mission of Object.values(state.missions)) {
    const lines = new Map((mission.plan?.lines ?? []).map((line) => [line.id, line]));
    for (const runId of mission.runOrder) {
      const run = mission.runs[runId];
      if (run?.status !== "done") continue;
      const line = lines.get(run.lineId);
      if (line === undefined) continue;

      // Judged against the revision the review saw: the page cannot read a worktree, and the merge tool
      // re-collects the diff and refuses for itself if the work has moved since.
      const judged = run.review?.revision ?? run.checks?.revision ?? "";
      const readiness = mergeReadiness(run, line, judged);
      waiting.push({
        missionId: mission.missionId,
        runId,
        // What the work was, not just which run it was. A row that says `api-1` makes a person go and look it up.
        task: line.title,
        seat: run.seat.id,
        ready: readiness.ready,
        approvable: !readiness.ready && blocksApproval(readiness).length === 0,
        blockers: readiness.blockers.map((blocker) => blocker.message),
      });
    }
  }
  return waiting;
}

function wanted(subscriber: Subscriber, event: StoredEvent): boolean {
  if (subscriber.types !== null && !subscriber.types.has(event.type)) return false;
  if (subscriber.missionId === null) return true;
  return "missionId" in event && event.missionId === subscriber.missionId;
}

function typesFrom(url: URL): ReadonlySet<EventType> | null {
  if (url.searchParams.get("for") === "lead") return new Set(LEAD_EVENTS);
  const types = url.searchParams.get("types");
  if (types === null || types === "") return null;
  return new Set(types.split(",").filter(Boolean) as EventType[]);
}

function parseUrl(request: IncomingMessage): URL {
  return new URL(request.url ?? "/", `http://127.0.0.1`);
}

function send(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    // Nothing here is for a browser to keep.
    "cache-control": "no-store",
  });
  response.end(text);
}

async function close(
  server: Server,
  websockets: WebSocketServer,
  sockets: Set<Socket>,
  subscribers: Set<Subscriber>,
): Promise<void> {
  for (const subscriber of subscribers) subscriber.socket.close();
  subscribers.clear();
  await new Promise<void>((resolve) => {
    websockets.close(() => {
      resolve();
    });
  });
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
}
