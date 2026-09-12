import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { project, type EventType, type Ledger, type SeatInfo, type StoredEvent } from "@fanout/core";
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
   * The mission view's HTML, with `{{TOKEN}}` wherever the page needs this daemon's token.
   *
   * Passed in rather than read from disk here so the daemon has no opinion about where the page lives, and so a
   * test can serve a one-line page without a file.
   */
  view?: () => string;
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
    send(response, 200, { state, seats, now: new Date().toISOString() });
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
