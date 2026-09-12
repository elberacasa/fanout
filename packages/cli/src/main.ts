import { existsSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClaudeAdapter, manifest as claude } from "@fanout/adapter-claude";
import { createCodexAdapter, manifest as codex } from "@fanout/adapter-codex";
import { createGrokAdapter, manifest as grok } from "@fanout/adapter-grok";
import {
  Ledger,
  missionReport,
  PlanGraph,
  project,
  SeatPosture,
  stanceFor,
  type AdapterManifest,
  type EventOf,
  type SeatAdapter,
  type SeatInfo,
  type StoredEvent,
} from "@fanout/core";
import {
  detectSeats,
  git,
  lines,
  buddyReview,
  checkClaims,
  createMissionRunner,
  createWorkspaceManager,
  missionViewHtml,
  readOrCreateToken,
  readSeatPolicy,
  setPosture,
  startApi,
  workSnapshot,
  writeSeatPolicy,
  type CommandResult,
  type RunLimits,
} from "@fanout/daemon";
import { createFanoutServer } from "@fanout/mcp";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createFakeAdapter } from "@fanout/adapter-fake";
import { fanoutHome, type FanoutHome } from "./home.ts";
import { buildDemoRepo, demoClaims, demoLines, demoScenario, DEMO_GOAL } from "./demo.ts";
import { crewTable, missionLines } from "./format.ts";
import { ownWorkOwed, unfinishedReport, whatIsOwed } from "./unfinished.ts";

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

  fanout demo       watch a whole mission run, offline, with no accounts at all
  fanout status     the crew on this machine, and any missions on the go
  fanout seat       how freely to spend a seat: preferred | normal | sparing | off
  fanout owed       what is waiting on you before anything can merge (the Stop hook runs this)
  fanout review     ask a second vendor to read your own uncommitted changes
  fanout check      state what you believe; a cold reader tries to disprove each claim
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
    case "demo":
      return demo(home, io);
    case "status":
      return status(home, io);
    case "seat":
      return seat(home, argv.slice(1), io);
    case "owed":
      return owed(home, io);
    case "review":
      return buddy(home, io);
    case "check":
      return check(home, argv.slice(1), io);
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

/**
 * `fanout demo` — the whole thing, on a machine with nothing signed in.
 *
 * Real worktrees, the real safety gate, the real ledger, real diffs from real files. Only the agents are
 * simulated, by the `fake` seat: a genuine CLI speaking the genuine protocol from a script. Nothing inside the
 * daemon takes a special path, because a demo of a special path is a demo of something nobody ships.
 */
async function demo(home: FanoutHome, io: Io): Promise<number> {
  const root = join(home.root, "demo");
  const repo = buildDemoRepo(join(root, "shop"));
  const ledgerPath = join(root, "ledger.db");
  rmSync(ledgerPath, { force: true });

  // The feed exists only once the API is listening, and the ledger is open before that; this holder is the join.
  const feed: { publish?: (event: StoredEvent) => void } = {};
  const ledger = Ledger.open(ledgerPath, {
    onAppend: (event) => {
      feed.publish?.(event);
    },
  });
  const adapter = createFakeAdapter({ scenarioFor: demoScenario });
  const workspaces = createWorkspaceManager({ repoRoot: repo, workspaceRoot: join(root, "workspaces") });
  const runner = createMissionRunner({
    ledger,
    workspaces,
    adapters: new Map([["fake", adapter]]),
    runsRoot: join(root, "runs"),
    limits: DEFAULT_LIMITS,
  });

  const api = await startApi({
    ledger,
    token: readOrCreateToken(home.token),
    view: missionViewHtml,
    /*
     * The demo's crew is the simulated seat, said plainly. Reporting the machine's real CLIs here would make the
     * demo look like it was using them, and reporting nothing makes a working demo look broken.
     */
    crew: () =>
      Promise.resolve([
        {
          id: "fake",
          displayName: "Simulated agent",
          binary: "fake",
          version: "demo",
          supported: true,
          signedIn: "yes" as const,
          models: ["demo"],
          efforts: [],
          billing: "unknown" as const,
          plan: { name: "no account needed", source: "detected" as const },
        },
      ]),
  });
  feed.publish = (event) => {
    api.publish(event);
  };

  const plan = PlanGraph.parse({ lines: demoLines() });
  const head = (await git(["rev-parse", "HEAD"], { cwd: repo })).trim();
  const missionId = "demo-csv-export";
  ledger.appendAll([
    {
      type: "mission.created",
      missionId,
      goal: DEMO_GOAL,
      repo: { root: repo, baseCommit: head },
      limits: { maxParallel: 3, timeoutMinutes: 10 },
    },
    { type: "plan.proposed", missionId, plan, by: "lead" },
  ]);

  io.out(`\n  ${DEMO_GOAL}\n\n`);
  io.out(`  Watch it at  ${api.url}/\n`);
  io.out(`  The repo it is changing is ${repo}\n`);
  io.out(`  Three simulated agents, three worktrees, no accounts. Ctrl-C when you have seen enough.\n\n`);

  const handle = runner.launch({ missionId, plan, baseCommit: head, maxParallel: 3 });
  await handle.finished;

  /*
   * The claim check the demo shows is written, not read: real verdicts need a real second vendor. It is recorded
   * with `simulated: true` so every surface says so, because inventing a second opinion and presenting it as one
   * would fake the only thing this product claims to do.
   */
  ledger.appendAll([
    {
      type: "claims.checked",
      repoRoot: repo,
      revision: "d3".repeat(32),
      by: { id: "fake", model: "demo" },
      claims: demoClaims(),
      ran: true,
      simulated: true,
    },
  ]);

  const state = project(ledger.read({ missionId }));
  const mission = state.missions[missionId];
  if (mission !== undefined) io.out(`\n${missionReport(mission, new Date())}\n`);
  io.out(`  Still watching at ${api.url}/ — Ctrl-C to stop.\n`);

  await (io.until ?? new Promise<void>(() => undefined));
  await api.close();
  ledger.close();
  return 0;
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
 * `fanout check` — the lead writes down what it believes; a cold reader tries to disprove each claim.
 *
 * Sharper and far cheaper than a broad review, because the value was never the volume of reading. The lead
 * carries the plan and the reasoning, and that is exactly what hides its mistakes from it; a reader with only the
 * diff is not smarter, it is differently placed. Three specific claims buy that difference for almost nothing.
 *
 * Exits non-zero when a claim is refuted, so this can sit in a script or a hook.
 */
async function check(home: FanoutHome, claims: readonly string[], io: Io): Promise<number> {
  if (claims.length === 0) {
    io.err(`fanout: check needs something to check.\n\n${CHECK_HELP}`);
    return 64;
  }

  const ready = await reviewerFor(home, io);
  if (typeof ready === "number") return ready;

  const { event, refuted } = await checkClaims({
    repoRoot: io.cwd ?? process.cwd(),
    claims,
    manifest: ready.manifest,
    ...(io.execute === undefined ? {} : { execute: reviewWith(io.execute) }),
  });

  const ledger = Ledger.open(home.ledger);
  try {
    ledger.appendAll([event]);
  } finally {
    ledger.close();
  }

  if (!event.ran) {
    // Never let "we could not ask" read as "nothing was refuted".
    io.err(
      `fanout: ${ready.manifest.displayName} did not check your claims.\n  ${event.claims[0]?.evidence ?? ""}\n`,
    );
    return 69;
  }

  const mark = { confirmed: "✓", refuted: "✗", unclear: "?" } as const;
  io.out(`${ready.manifest.displayName} read your changes cold:\n\n`);
  for (const claim of event.claims) {
    io.out(`  ${mark[claim.verdict]} ${claim.claim}\n    ${claim.evidence}\n`);
  }
  io.out(`\n${summarise(event.claims)}\n`);

  // A refuted claim is the only outcome worth interrupting someone for.
  return refuted.length > 0 ? 1 : 0;
}

function summarise(claims: EventOf<"claims.checked">["claims"]): string {
  const count = (verdict: string): number => claims.filter((claim) => claim.verdict === verdict).length;
  const refuted = count("refuted");
  const unclear = count("unclear");
  if (refuted > 0) return `${String(refuted)} refuted. Nothing here is settled until those are.`;
  if (unclear > 0)
    return `Nothing refuted, but ${String(unclear)} could not be checked — that is not the same as fine.`;
  return "All confirmed.";
}

const CHECK_HELP = `  fanout check "<claim>" ["<claim>" ...]

  Write claims a reader could disprove. "It works" cannot be checked; "no caller of
  total() passes fewer than two arguments" can.
`;

/**
 * `fanout review` — a second vendor reads the lead's own uncommitted work.
 *
 * The one command that earns its keep in a session where no agent ran at all. Most of the code in a Claude Code
 * session is written by the lead and reviewed by the lead, which is how a confident mistake ships; this is the
 * call that breaks that loop. The findings are printed verbatim, because a second opinion summarised by the
 * author it is about is not a second opinion.
 */
async function buddy(home: FanoutHome, io: Io): Promise<number> {
  const ready = await reviewerFor(home, io);
  if (typeof ready === "number") return ready;

  const { snapshot, event } = await buddyReview({
    repoRoot: io.cwd ?? process.cwd(),
    manifest: ready.manifest,
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
    io.err(`fanout: ${ready.manifest.displayName} could not review your changes.\n  ${event.findings}\n`);
    return 69;
  }

  const files = `${String(snapshot.files.length)} file${snapshot.files.length === 1 ? "" : "s"}`;
  io.out(
    event.findings.trim() === ""
      ? `${ready.manifest.displayName} read ${files} and had nothing to say.\n`
      : `${ready.manifest.displayName} read ${files}:\n\n${event.findings.trim()}\n`,
  );
  return 0;
}

/**
 * The seat that will read your work, or the exit code explaining why nobody will.
 *
 * Every check here is about not spending someone's subscription behind their back — a posture they set, a version
 * this adapter was never verified against, a policy file we could not read. Shared by both readers so that the
 * next one cannot forget any of them, which is exactly how `fanout review` shipped ignoring the seat policy.
 */
async function reviewerFor(home: FanoutHome, io: Io): Promise<{ manifest: AdapterManifest } | number> {
  const manifest = SEATS.find((seat) => seat.id === "codex");
  if (manifest?.capabilities.review == null) {
    io.err("fanout: no seat on this machine has a non-interactive review command.\n");
    return 69;
  }

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
  return { manifest };
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
async function owed(home: FanoutHome, io: Io): Promise<number> {
  const repoRoot = io.cwd ?? process.cwd();

  // The working tree is asked about first, because that is where the lead's own unread code lives.
  let own = "";
  try {
    const snapshot = await workSnapshot({ cwd: repoRoot });
    if (!existsSync(home.ledger)) {
      own = ownWorkOwed({ revision: snapshot.revision, files: snapshot.files.length, checked: undefined });
    } else {
      const ledger = Ledger.open(home.ledger);
      try {
        const state = project(ledger.read());
        own = ownWorkOwed({
          revision: snapshot.revision,
          files: snapshot.files.length,
          checked: state.claims[snapshot.repoRoot],
        });
      } finally {
        ledger.close();
      }
    }
  } catch {
    // Not a repository, or git is unhappy. A hook that runs every turn must never be the reason a turn fails.
  }

  if (!existsSync(home.ledger)) {
    if (own !== "") io.out(unfinishedReport([], own));
    return 0;
  }

  const ledger = Ledger.open(home.ledger);
  try {
    const state = project(ledger.read());
    const report = unfinishedReport(whatIsOwed(Object.values(state.missions)), own);
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
    view: missionViewHtml,
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
    view: missionViewHtml,
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
