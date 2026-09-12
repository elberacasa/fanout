import { existsSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClaudeAdapter, manifest as claude } from "@fanout/adapter-claude";
import { createCodexAdapter, manifest as codex } from "@fanout/adapter-codex";
import { createGrokAdapter, manifest as grok } from "@fanout/adapter-grok";
import {
  Ledger,
  project,
  SeatPosture,
  stanceFor,
  type AdapterManifest,
  type SeatAdapter,
  type SeatInfo,
  type StoredEvent,
} from "@fanout/core";
import {
  detectSeats,
  git,
  lines,
  buddyReview,
  readOrCreateToken,
  readSeatPolicy,
  setPosture,
  startApi,
  writeSeatPolicy,
  type CommandResult,
  type RunLimits,
} from "@fanout/daemon";
import { createFanoutServer } from "@fanout/mcp";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { fanoutHome, type FanoutHome } from "./home.ts";
import { crewTable, missionLines } from "./format.ts";
import { unfinishedReport, whatIsOwed } from "./unfinished.ts";

/*
 * `fanout` is the terminal half of the product: the daemon the lead talks to, and a straight answer about the crew
 * and the missions. It prints what it knows and says plainly what it doesn't — a CLI that guesses is worse than one
 * that shrugs.
 */

export const SEATS: readonly AdapterManifest[] = [codex, claude, grok];

/** Every seat we can drive today. A plan naming anything else is dropped with the reason, never guessed at. */
export function adapters(): ReadonlyMap<string, SeatAdapter> {
  return new Map([
    ["codex", createCodexAdapter()],
    ["claude", createClaudeAdapter()],
    ["grok", createGrokAdapter()],
  ]);
}

/** What a run is allowed before the supervisor stops it. Generous: a real agent thinks for minutes. */
export const DEFAULT_LIMITS: RunLimits = {
  startTimeoutMs: 90_000,
  timeoutMs: 30 * 60_000,
  killGraceMs: 5_000,
  maxLogBytes: 16 * 1024 * 1024,
  maxLineBytes: 200_000,
};

const HELP = `fanout — Claude Code leads, your other agents build

  fanout status     the crew on this machine, and any missions on the go
  fanout seat       how freely to spend a seat: preferred | normal | sparing | off
  fanout owed       what is waiting on you before anything can merge (the Stop hook runs this)
  fanout review     ask a second vendor to read your own uncommitted changes
  fanout daemon     run the daemon the lead and the mission view talk to
  fanout clean      remove the worktrees and branches finished missions left behind
  fanout mcp        speak MCP on stdin/stdout, for Claude Code to drive (the plugin runs this)
  fanout version    what you are running
  fanout help       this

Everything lives in ~/.fanout (move it with FANOUT_HOME). Nothing leaves your machine.
`;

export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
  /** Injected so tests never need the real CLIs installed. */
  execute?: (binary: string, args: readonly string[]) => Promise<CommandResult>;
  env?: Readonly<Record<string, string | undefined>>;
  /** Resolves when the daemon should stop; without it, `daemon` runs until interrupted. */
  until?: Promise<void>;
  /** Where the command was run; tests point it at a temporary repository. */
  cwd?: string;
}

export async function main(argv: readonly string[], io: Io): Promise<number> {
  const [command = "help"] = argv;
  const home = fanoutHome(io.env ?? process.env);

  switch (command) {
    case "status":
      return status(home, io);
    case "seat":
      return seat(home, argv.slice(1), io);
    case "owed":
      return owed(home, io);
    case "review":
      return buddy(home, io);
    case "daemon":
      return daemon(home, io);
    case "clean":
      return clean(home, io);
    case "mcp":
      return mcp(home, io);
    case "version":
      io.out("fanout 0.5.0-dev\n");
      return 0;
    case "help":
    case "--help":
    case "-h":
      io.out(HELP);
      return 0;
    default:
      io.err(`fanout: there is no "${command}" command.\n\n${HELP}`);
      return 64;
  }
}

async function status(home: FanoutHome, io: Io): Promise<number> {
  const seats = await detectSeats({
    manifests: SEATS,
    ...(io.execute === undefined ? {} : { execute: io.execute }),
  });
  const { policy, problem } = readSeatPolicy(home.root);
  // A policy we could not read is not the same as no policy, and the difference is whose money it is.
  if (problem !== null)
    io.err(`fanout: ${problem}\n  Until it is fixed, every seat falls back to its default.\n\n`);
  io.out(crewTable(seats, policy));

  if (!existsSync(home.ledger)) {
    io.out("\nNo missions yet. The ledger appears the first time the lead plans one.\n");
    return 0;
  }

  const ledger = Ledger.open(home.ledger);
  try {
    const state = project(ledger.read());
    io.out(`\n${missionLines(state)}`);
  } finally {
    ledger.close();
  }
  return 0;
}

/**
 * `fanout review` — a second vendor reads the lead's own uncommitted work.
 *
 * The one command that earns its keep in a session where no agent ran at all. Most of the code in a Claude Code
 * session is written by the lead and reviewed by the lead, which is how a confident mistake ships; this is the
 * call that breaks that loop. The findings are printed verbatim, because a second opinion summarised by the
 * author it is about is not a second opinion.
 */
async function buddy(home: FanoutHome, io: Io): Promise<number> {
  const repoRoot = io.cwd ?? process.cwd();
  const manifest = SEATS.find((seat) => seat.id === "codex");
  if (manifest?.capabilities.review == null) {
    io.err("fanout: no seat on this machine has a non-interactive review command.\n");
    return 69;
  }

  /*
   * Everything below is about not spending someone's subscription behind their back. Found by Codex reviewing
   * this very function: it launched Codex without once asking whether the owner had switched that seat off.
   */
  const { policy, problem } = readSeatPolicy(home.root);
  if (problem !== null) {
    io.err(`fanout: ${problem}\n  Fix or delete that file before spending a seat.\n`);
    return 65;
  }

  const [detected] = await detectSeats({
    manifests: [manifest],
    ...(io.execute === undefined ? {} : { execute: io.execute }),
  });
  if (detected === undefined) {
    io.err("fanout: could not detect the reviewing seat.\n");
    return 69;
  }

  const stance = stanceFor(detected, policy);
  if (stance.posture === "off") {
    io.err(`fanout: ${manifest.displayName} is off (${stance.reason}). Turn it on with:\n`);
    io.err(`  fanout seat ${manifest.id} normal\n`);
    return 69;
  }
  if (!detected.supported) {
    // An unverified build would be driven with flags we have not confirmed and read as a stream we have not seen.
    io.err(
      `fanout: ${manifest.displayName} ${detected.version ?? "is not installed"} is outside the versions this ` +
        `adapter was verified against (${manifest.supportedVersions}).\n`,
    );
    return 69;
  }
  if (detected.signedIn !== "yes") {
    io.err(
      `fanout: ${manifest.displayName} is ${detected.signedIn === "no" ? "not signed in" : "unknown"}.\n`,
    );
    return 69;
  }
  if (stance.posture === "sparing") {
    // Sparing means "only when nothing else fits, and say so first". This is the saying so.
    io.out(
      `Using ${manifest.displayName}, which you marked sparing${stance.note === undefined ? "" : ` — ${stance.note}`}.\n`,
    );
  }

  const { snapshot, event } = await buddyReview({
    repoRoot,
    manifest,
    ...(io.execute === undefined ? {} : { execute: reviewWith(io.execute) }),
  });

  const ledger = Ledger.open(home.ledger);
  try {
    ledger.appendAll([event]);
  } finally {
    ledger.close();
  }

  if (snapshot.clean) {
    io.out("Nothing uncommitted to review.\n");
    return 0;
  }
  if (!event.ran) {
    // Never let "the reviewer broke" read as "the reviewer found nothing".
    io.err(`fanout: ${manifest.displayName} could not review your changes.\n  ${event.findings}\n`);
    return 69;
  }

  const files = `${String(snapshot.files.length)} file${snapshot.files.length === 1 ? "" : "s"}`;
  io.out(
    event.findings.trim() === ""
      ? `${manifest.displayName} read ${files} and had nothing to say.\n`
      : `${manifest.displayName} read ${files}:\n\n${event.findings.trim()}\n`,
  );
  return 0;
}

/** The CLI's injected executor takes no options; the buddy's takes cwd and a deadline. Bridge them for tests. */
function reviewWith(
  execute: NonNullable<Io["execute"]>,
): (binary: string, args: readonly string[]) => Promise<CommandResult> {
  return (binary, args) => execute(binary, args);
}

/**
 * `fanout owed` — what the lead still owes before anything can merge.
 *
 * Run by the Stop hook on every turn, which is the point: a tool the lead chooses to call cannot catch a lead who
 * believes the work is already finished. Prints nothing and exits 0 when there is nothing owed, so a quiet session
 * stays quiet, and it never blocks — walking away from unfinished work is allowed, doing it unknowingly is not.
 */
function owed(home: FanoutHome, io: Io): number {
  if (!existsSync(home.ledger)) return 0;

  const ledger = Ledger.open(home.ledger);
  try {
    const state = project(ledger.read());
    const report = unfinishedReport(whatIsOwed(Object.values(state.missions)));
    if (report !== "") io.out(report);
  } finally {
    ledger.close();
  }
  return 0;
}

/** `fanout seat <id> <posture> [note]` — the one setting, and it is always the owner's to make. */
function seat(home: FanoutHome, args: readonly string[], io: Io): number {
  const [seatId, posture, ...rest] = args;
  if (seatId === undefined || posture === undefined) {
    io.err(`fanout: seat needs which seat and how freely to spend it.\n\n${SEAT_HELP}`);
    return 64;
  }

  const wanted = SeatPosture.safeParse(posture);
  if (!wanted.success) {
    io.err(`fanout: "${posture}" is not a posture.\n\n${SEAT_HELP}`);
    return 64;
  }
  if (!SEATS.some((manifest) => manifest.id === seatId)) {
    const known = SEATS.map((manifest) => manifest.id).join(", ");
    io.err(`fanout: there is no seat called "${seatId}". Seats: ${known}.\n`);
    return 64;
  }

  const { policy, problem } = readSeatPolicy(home.root);
  if (problem !== null) {
    // Writing on top of a file we could not read would silently discard preferences the owner did set.
    io.err(`fanout: ${problem}\n  Fix or delete that file before changing a seat.\n`);
    return 65;
  }

  const note = rest.join(" ");
  writeSeatPolicy(home.root, setPosture(policy, seatId, wanted.data, note));
  io.out(`${seatId} is now ${wanted.data}${note === "" ? "" : ` — ${note}`}.\n`);
  return 0;
}

const SEAT_HELP = `  fanout seat <id> <preferred|normal|sparing|off> [why]

  preferred   reach for this one first
  normal      use it when the plan calls for it
  sparing     only when nothing else fits, and say so first
  off         never, until you say otherwise
`;

async function daemon(home: FanoutHome, io: Io): Promise<number> {
  const ledger = Ledger.open(home.ledger);
  const token = readOrCreateToken(home.token);
  const api = await startApi({
    ledger,
    token,
    crew: () =>
      detectSeats({ manifests: SEATS, ...(io.execute === undefined ? {} : { execute: io.execute }) }),
  });

  io.out(
    `fanout daemon listening on ${api.url}\n` +
      `  token   ${home.token} (read by the plugin and the CLI; keep it to yourself)\n` +
      `  ledger  ${home.ledger}\n` +
      `  live    ${api.url.replace("http", "ws")}/events?for=lead\n\nStop it with Ctrl-C.\n`,
  );

  await (io.until ?? interrupted());
  await api.close();
  ledger.close();
  io.out("fanout daemon stopped.\n");
  return 0;
}

/**
 * Removes what a run leaves on disk: its worktree and its throwaway branch. It only ever touches workspaces under
 * FANOUT_HOME and branches under `fanout/`, so a clean can never take the user's own work with it.
 */
async function clean(home: FanoutHome, io: Io): Promise<number> {
  const cwd = io.cwd ?? process.cwd();
  let repoRoot: string;
  try {
    repoRoot = (await git(["rev-parse", "--show-toplevel"], { cwd })).trim();
  } catch {
    io.err("fanout clean: run this inside the repository whose missions you want to clean up.\n");
    return 64;
  }

  // git reports resolved paths (/private/var/… on macOS) while FANOUT_HOME may be the symlinked form (/var/…),
  // so compare both spellings; otherwise a clean silently removes nothing and then fails to delete the branch.
  const roots = [
    home.workspaces,
    existsSync(home.workspaces) ? realpathSync(home.workspaces) : home.workspaces,
  ];
  const worktrees = lines(await git(["worktree", "list", "--porcelain"], { cwd: repoRoot }))
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length))
    .filter((path) => roots.some((root) => path.startsWith(root)));
  const branches = lines(
    await git(["for-each-ref", "--format=%(refname:short)", "refs/heads/fanout/"], { cwd: repoRoot }),
  );

  if (worktrees.length === 0 && branches.length === 0) {
    io.out("Nothing to clean: no Fanout worktrees or branches in this repository.\n");
    return 0;
  }

  for (const path of worktrees) await git(["worktree", "remove", "--force", path], { cwd: repoRoot });
  await git(["worktree", "prune"], { cwd: repoRoot });

  const kept: string[] = [];
  for (const branch of branches) {
    try {
      await git(["branch", "-D", branch], { cwd: repoRoot });
    } catch {
      kept.push(branch); // still checked out somewhere: say so rather than pretending it is gone
    }
  }
  rmSync(home.workspaces, { recursive: true, force: true });

  const removed = branches.length - kept.length;
  io.out(
    `Cleaned ${worktrees.length} worktree${worktrees.length === 1 ? "" : "s"} and ` +
      `${removed} branch${removed === 1 ? "" : "es"}. Your own branches were not touched.\n`,
  );
  if (kept.length > 0) {
    io.err(`Still in use elsewhere, so left alone: ${kept.join(", ")}.\n`);
  }
  return kept.length === 0 ? 0 : 1;
}

/**
 * Speaks MCP on stdin and stdout so Claude Code can drive the crew, and runs the daemon in the same process so the
 * mission view and the lead's live feed have something to subscribe to.
 *
 * Nothing but MCP may touch stdout here: a stray line would corrupt the protocol, which is why every message this
 * command prints goes to stderr.
 */
async function mcp(home: FanoutHome, io: Io): Promise<number> {
  // The feed exists only once the API is listening, and the ledger is open before that; this holder is the join.
  const feed: { publish?: (event: StoredEvent) => void } = {};
  const ledger = Ledger.open(home.ledger, {
    onAppend: (event) => {
      feed.publish?.(event);
    },
  });
  const token = readOrCreateToken(home.token);
  const api = await startApi({
    ledger,
    token,
    crew: () =>
      detectSeats({ manifests: SEATS, ...(io.execute === undefined ? {} : { execute: io.execute }) }),
  });
  feed.publish = (event) => {
    api.publish(event);
  };

  // Where the daemon is, for the mission view and any other client. Private, like everything else here.
  writeFileSync(join(home.root, "daemon.json"), `${JSON.stringify({ url: api.url, pid: process.pid })}\n`, {
    mode: 0o600,
  });

  const server = createFanoutServer({
    ledger,
    repoRoot: io.cwd ?? process.cwd(),
    paths: { runs: home.runs, workspaces: home.workspaces },
    adapters: adapters(),
    manifests: SEATS,
    limits: DEFAULT_LIMITS,
  });

  io.err(`fanout mcp ready. Live feed: ${api.url.replace("http", "ws")}/events?for=lead\n`);
  await server.connect(new StdioServerTransport());
  await (io.until ?? interrupted());

  await server.close();
  await api.close();
  ledger.close();
  return 0;
}

function interrupted(): Promise<void> {
  return new Promise<void>((resolve) => {
    const stop = (): void => {
      resolve();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

export type { SeatInfo };
