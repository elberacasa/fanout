import { existsSync, realpathSync, rmSync } from "node:fs";
import { manifest as claude } from "@fanout/adapter-claude";
import { manifest as codex } from "@fanout/adapter-codex";
import { manifest as grok } from "@fanout/adapter-grok";
import { Ledger, project, type AdapterManifest, type SeatInfo } from "@fanout/core";
import { detectSeats, git, lines, readOrCreateToken, startApi, type CommandResult } from "@fanout/daemon";
import { fanoutHome, type FanoutHome } from "./home.ts";
import { crewTable, missionLines } from "./format.ts";

/*
 * `fanout` is the terminal half of the product: the daemon the lead talks to, and a straight answer about the crew
 * and the missions. It prints what it knows and says plainly what it doesn't — a CLI that guesses is worse than one
 * that shrugs.
 */

export const SEATS: readonly AdapterManifest[] = [codex, claude, grok];

const HELP = `fanout — Claude Code leads, your other agents build

  fanout status     the crew on this machine, and any missions on the go
  fanout daemon     run the daemon the lead and the mission view talk to
  fanout clean      remove the worktrees and branches finished missions left behind
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
    case "daemon":
      return daemon(home, io);
    case "clean":
      return clean(home, io);
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
  io.out(crewTable(seats));

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
