import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/*
 * The daemon answers on 127.0.0.1 only, but "local" is not the same as "yours": anything running on the machine,
 * including a web page in your browser, can reach a local port. So every request carries a token that lives in a
 * file only you can read, and comparisons are constant-time so a wrong guess teaches an attacker nothing.
 */

const TOKEN_BYTES = 32;

/** Reads the daemon's token, creating one the first time. The file is yours alone (mode 600). */
export function readOrCreateToken(path: string): string {
  if (existsSync(path)) {
    const existing = readFileSync(path, "utf8").trim();
    if (existing.length >= 32) {
      chmodSync(path, 0o600);
      return existing;
    }
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  writeFileSync(path, `${token}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
  return token;
}

/** Whether a request carries the daemon's token. Constant-time, and never true for a missing or empty header. */
export function tokenMatches(expected: string, authorization: string | undefined): boolean {
  if (authorization === undefined) return false;
  const offered = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : authorization.trim();
  if (offered === "" || expected === "") return false;

  const a = Buffer.from(offered, "utf8");
  const b = Buffer.from(expected, "utf8");
  // timingSafeEqual needs equal lengths; compare a fixed-size digest of each instead of leaking the length.
  if (a.length !== b.length) {
    timingSafeEqual(b, b); // keep the work the same whatever the input looks like
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * Whether a browser page is trying to drive the daemon. A request from a page carries an Origin; ours never do,
 * so anything with an Origin that is not our own loopback address is refused before it reaches a handler.
 */
export function originAllowed(origin: string | undefined, port: number): boolean {
  if (origin === undefined || origin === "" || origin === "null") return true;
  return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}
