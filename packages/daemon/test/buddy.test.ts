import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterManifest } from "fanout-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buddyReview, BuddyUnavailable } from "../src/gate/buddy.ts";

/*
 * The second opinion on the lead's own work. Most of the code in a Claude Code session is written by the lead and
 * reviewed by the lead; these tests are about the one call that breaks that loop, and about never letting its
 * failure look like approval.
 */

const gitEnv = { PATH: process.env["PATH"] ?? "", HOME: process.env["HOME"] ?? "", LC_ALL: "C" };

const codex = AdapterManifest.parse(
  JSON.parse(
    // The real manifest, so a change to the verified review invocation shows up here.
    execFileSync("cat", [new URL("../../adapters/codex/manifest.json", import.meta.url).pathname], {
      encoding: "utf8",
    }),
  ),
);

let repo: string;
const run = (args: string[]): string =>
  execFileSync("git", args, { cwd: repo, encoding: "utf8", env: gitEnv });

/** A Codex review stream, in the shape recorded from a real run. */
const reviewStream = (text: string): string =>
  [
    JSON.stringify({ type: "thread.started", thread_id: "01a0" }),
    JSON.stringify({ type: "item.completed", item: { id: "item_0", type: "command_execution" } }),
    JSON.stringify({ type: "item.completed", item: { id: "item_1", type: "agent_message", text } }),
    JSON.stringify({ type: "turn.completed", usage: {} }),
  ].join("\n");

/** An executor with the buddy's exact signature, so the mock records the arguments we assert on. */
function reviewingWith(stdout: string): (
  binary: string,
  args: readonly string[],
  options: { cwd: string; timeoutMs: number },
) => Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  return () => Promise.resolve({ stdout, stderr: "", exitCode: 0 });
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "fanout-buddy-"));
  run(["init", "--quiet", "-b", "main"]);
  run(["config", "user.email", "crew@example.invalid"]);
  run(["config", "user.name", "Fanout tests"]);
  writeFileSync(join(repo, "total.py"), "def total(prices):\n    return sum(prices)\n");
  run(["add", "-A"]);
  run(["commit", "--quiet", "-m", "seed"]);
});
afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

function dirty(): void {
  writeFileSync(join(repo, "total.py"), "def total(prices, discount):\n    return sum(prices) - discount\n");
}

describe("asking a second vendor to read the lead's work", () => {
  it("records what the reviewer actually said, not a summary of it", async () => {
    dirty();
    const said = "- [P1] Preserve the existing call signature — total.py:1-1";
    const { event } = await buddyReview({
      repoRoot: repo,
      manifest: codex,
      execute: () => Promise.resolve({ stdout: reviewStream(said), stderr: "", exitCode: 0 }),
    });

    expect(event.ran).toBe(true);
    expect(event.findings).toBe(said);
    expect(event.files).toEqual(["total.py"]);
    expect(event.by.id).toBe("codex");
  });

  it("runs the reviewer read-only, and never inside the repository itself", async () => {
    dirty();
    const execute = vi.fn(reviewingWith(reviewStream("fine")));
    await buddyReview({ repoRoot: repo, manifest: codex, execute });

    const [binary, args, options] = execute.mock.calls[0] ?? [];
    expect(binary).toBe("codex");
    expect(args).toContain("review");
    expect(args).toContain("--uncommitted");
    expect(args).toContain("read-only");
    expect(args).not.toContain("workspace-write");
    // read-only stops writes, not reads: the guarantee has to be that the repository is not there to read.
    expect(options?.cwd).not.toBe(repo);
  });

  /*
   * The third non-negotiable, and the first thing Codex said when it reviewed this file: a reviewer launched in
   * the repository can open any ignored file lying there, whatever sandbox mode it is in.
   */
  it("shows the reviewer the changes and none of the repository's ignored files", async () => {
    writeFileSync(join(repo, ".gitignore"), ".env\n");
    run(["add", ".gitignore"]);
    run(["commit", "--quiet", "-m", "ignore"]);
    writeFileSync(join(repo, ".env"), "TOKEN=hunter2\n");
    dirty();
    writeFileSync(join(repo, "added.py"), "print('new')\n");

    // Inspected from inside the callback: by the time buddyReview returns, the copy is gone, which is the point.
    interface Seen {
      env: boolean;
      patched: string;
      added: boolean;
    }
    const saw: Seen[] = [];
    await buddyReview({
      repoRoot: repo,
      manifest: codex,
      execute: (_binary, _args, options) => {
        saw.push({
          env: existsSync(join(options.cwd, ".env")),
          patched: readFileSync(join(options.cwd, "total.py"), "utf8"),
          added: existsSync(join(options.cwd, "added.py")),
        });
        return Promise.resolve({ stdout: reviewStream("fine"), stderr: "", exitCode: 0 });
      },
    });

    expect(saw).toHaveLength(1);
    expect(saw[0]?.env).toBe(false);
    expect(saw[0]?.patched).toContain("discount");
    expect(saw[0]?.added).toBe(true);
  });

  it("leaves no copy behind once the reviewer is done", async () => {
    dirty();
    let seen = "";
    await buddyReview({
      repoRoot: repo,
      manifest: codex,
      execute: (_binary, _args, options) => {
        seen = options.cwd;
        return Promise.resolve({ stdout: reviewStream("fine"), stderr: "", exitCode: 0 });
      },
    });
    expect(existsSync(seen)).toBe(false);
  });

  /*
   * Also from that review: an exit code of zero is not a review. Silence reported as a completed review with no
   * findings is silence turned into a clean bill of health.
   */
  it.each([
    ["it printed nothing at all", ""],
    ["it printed no reviewer message", JSON.stringify({ type: "turn.completed", usage: {} })],
    ["it printed something unparsable", "Reviewing...\nDone."],
  ])("does not call it a clean review when %s", async (_label, stdout) => {
    dirty();
    const { event } = await buddyReview({
      repoRoot: repo,
      manifest: codex,
      execute: () => Promise.resolve({ stdout, stderr: "", exitCode: 0 }),
    });

    expect(event.ran).toBe(false);
    expect(event.findings).toContain("said nothing");
  });

  it("makes the reviewer's absolute paths repo-relative", async () => {
    dirty();
    const { event } = await buddyReview({
      repoRoot: repo,
      manifest: codex,
      // The reviewer names files inside the throwaway copy — a directory that will not exist by the time anyone
      // reads the finding, which would make it useless rather than merely long.
      execute: (_binary, _args, options) =>
        Promise.resolve({
          stdout: reviewStream(`- [P1] thing — ${options.cwd}/total.py:1-1`),
          stderr: "",
          exitCode: 0,
        }),
    });
    expect(event.findings).toBe("- [P1] thing — total.py:1-1");
    expect(event.findings).not.toContain("fanout-review-");
  });

  it("does not spend a subscription to be told a clean tree is clean", async () => {
    const execute = vi.fn(reviewingWith(""));
    const { event } = await buddyReview({ repoRoot: repo, manifest: codex, execute });

    expect(execute).not.toHaveBeenCalled();
    expect(event).toMatchObject({ ran: true, findings: "", files: [] });
  });

  /*
   * The failure that matters. "The reviewer broke" and "the reviewer found nothing" produce the same empty
   * findings, and only one of them is a clean bill of health.
   */
  it.each([
    ["the CLI exits non-zero", { stdout: "", stderr: "not logged in", exitCode: 1 }],
    ["the CLI writes nothing useful", { stdout: "", stderr: "", exitCode: 70 }],
  ])("records that it never ran when %s", async (_label, result) => {
    dirty();
    const { event } = await buddyReview({
      repoRoot: repo,
      manifest: codex,
      execute: () => Promise.resolve(result),
    });
    expect(event.ran).toBe(false);
  });

  it("records that it never ran when the CLI cannot start at all", async () => {
    dirty();
    const { event } = await buddyReview({
      repoRoot: repo,
      manifest: codex,
      execute: () => Promise.reject(new Error("spawn codex ENOENT")),
    });
    expect(event.ran).toBe(false);
    expect(event.findings).toContain("ENOENT");
  });

  it("refuses a seat whose CLI has no review command, rather than improvising one", async () => {
    const noReview = AdapterManifest.parse({
      ...codex,
      capabilities: { ...codex.capabilities, review: null },
    });
    await expect(buddyReview({ repoRoot: repo, manifest: noReview })).rejects.toBeInstanceOf(
      BuddyUnavailable,
    );
  });

  it("ties the review to the revision it read, so it cannot cover later work", async () => {
    dirty();
    const first = await buddyReview({
      repoRoot: repo,
      manifest: codex,
      execute: () => Promise.resolve({ stdout: reviewStream("fine"), stderr: "", exitCode: 0 }),
    });

    writeFileSync(join(repo, "other.py"), "print('new')\n");
    const second = await buddyReview({
      repoRoot: repo,
      manifest: codex,
      execute: () => Promise.resolve({ stdout: reviewStream("fine"), stderr: "", exitCode: 0 }),
    });

    expect(second.event.revision).not.toBe(first.event.revision);
  });

  it("leaves the repository exactly as it found it", async () => {
    dirty();
    const before = run(["status", "--porcelain"]);
    await buddyReview({
      repoRoot: repo,
      manifest: codex,
      execute: () => Promise.resolve({ stdout: reviewStream("fine"), stderr: "", exitCode: 0 }),
    });
    expect(run(["status", "--porcelain"])).toBe(before);
  });
});

/*
 * Found by pointing this at Fanout's own working tree. With no model chosen, `["-m", "{model}"]` became
 * `["-m", ""]` and Codex answered `The '' model is not supported when using Codex with a ChatGPT account`.
 */
describe("filling the reviewer's arguments", () => {
  it("drops an option nobody supplied, along with its flag", async () => {
    dirty();
    const execute = vi.fn(reviewingWith(reviewStream("fine")));
    await buddyReview({ repoRoot: repo, manifest: codex, execute });

    const args = execute.mock.calls[0]?.[1] ?? [];
    expect(args).not.toContain("-m");
    expect(args).not.toContain("");
  });

  it("passes the model when one is chosen", async () => {
    dirty();
    const execute = vi.fn(reviewingWith(reviewStream("fine")));
    await buddyReview({ repoRoot: repo, manifest: codex, model: "gpt-5.6-luna", execute });

    const args = execute.mock.calls[0]?.[1] ?? [];
    expect(args).toContain("-m");
    expect(args).toContain("gpt-5.6-luna");
  });
});

/*
 * Round two of the same review, on the isolation code written to answer round one. Every one of these is a way a
 * private file reached the reviewer, or a way the reviewer read different work from the work we recorded.
 */
describe("what the review copy refuses to carry", () => {
  const whereItRan = async (): Promise<{ cwd: string; listing: string[] }> => {
    let cwd = "";
    let listing: string[] = [];
    await buddyReview({
      repoRoot: repo,
      manifest: codex,
      execute: (_binary, _args, options) => {
        cwd = options.cwd;
        listing = readdirSync(options.cwd);
        return Promise.resolve({ stdout: reviewStream("fine"), stderr: "", exitCode: 0 });
      },
    });
    return { cwd, listing };
  };

  it("deletes a secret that HEAD itself tracks", async () => {
    // A worktree is a checkout of HEAD, so a committed .env arrives in the copy however well we filter paths.
    writeFileSync(join(repo, ".env"), "TOKEN=hunter2\n");
    run(["add", ".env"]);
    run(["commit", "--quiet", "-m", "oops, committed a secret"]);
    dirty();

    const { listing } = await whereItRan();
    expect(listing).not.toContain(".env");
    expect(listing).toContain("total.py");
  });

  it("refuses a symlink instead of copying whatever it points at", async () => {
    writeFileSync(join(repo, ".gitignore"), ".env\n");
    run(["add", ".gitignore"]);
    run(["commit", "--quiet", "-m", "ignore"]);
    writeFileSync(join(repo, ".env"), "TOKEN=hunter2\n");
    // An innocent name pointing at the secret: git lists it as an ordinary untracked file.
    symlinkSync(join(repo, ".env"), join(repo, "notes.txt"));
    dirty();

    const { cwd } = await whereItRan();
    expect(existsSync(join(cwd, "notes.txt"))).toBe(false);
  });

  it("says which files it kept out, rather than quietly reviewing less", async () => {
    writeFileSync(join(repo, ".gitignore"), ".env\n");
    run(["add", ".gitignore"]);
    run(["commit", "--quiet", "-m", "ignore"]);
    writeFileSync(join(repo, ".env"), "TOKEN=hunter2\n");
    symlinkSync(join(repo, ".env"), join(repo, "notes.txt"));
    dirty();

    const { event } = await buddyReview({
      repoRoot: repo,
      manifest: codex,
      execute: () => Promise.resolve({ stdout: reviewStream("fine"), stderr: "", exitCode: 0 }),
    });
    expect(event.findings).toContain("Not shown to the reviewer");
    expect(event.findings).toContain("notes.txt (symlink)");
  });

  it("shows the reviewer work that is staged but reverted in the working tree", async () => {
    writeFileSync(join(repo, "total.py"), "def total(prices, discount):\n    return 1\n");
    run(["add", "total.py"]);
    writeFileSync(join(repo, "total.py"), "def total(prices):\n    return sum(prices)\n"); // back to HEAD

    let seen = "";
    await buddyReview({
      repoRoot: repo,
      manifest: codex,
      execute: (_binary, _args, options) => {
        seen = readFileSync(join(options.cwd, "total.py"), "utf8");
        return Promise.resolve({ stdout: reviewStream("fine"), stderr: "", exitCode: 0 });
      },
    });

    // Otherwise the review is recorded against a revision that includes work the reviewer never saw.
    expect(seen).toContain("discount");
  });
});

/*
 * Every git call in the isolation path goes through the one helper that replaces the environment rather than
 * inheriting it. There used to be a second, bespoke invocation that piped a patch to stdin with the shell's
 * environment intact — which, in an editor's integrated terminal, is its GIT_ASKPASS and an IPC auth token.
 *
 * This asserts the structure rather than a behaviour: the variables that worry us leak silently, so no observable
 * difference exists to test for. The guarantee is that there is only one path, and this is what holds it there.
 */
describe("how git is invoked while building the copy", () => {
  it("never spawns git itself, so the closed environment cannot be bypassed", () => {
    const source = readFileSync(new URL("../src/gate/isolate.ts", import.meta.url), "utf8");

    expect(source).not.toContain("execFile");
    expect(source).not.toContain("spawn");
    expect(source).toContain('from "../workspace/git.ts"');
  });

  it("still applies the work when the surrounding shell exports git variables", async () => {
    dirty();
    const before = process.env["GIT_WORK_TREE"];
    process.env["GIT_WORK_TREE"] = join(tmpdir(), "fanout-not-a-work-tree");

    try {
      let patched = "";
      await buddyReview({
        repoRoot: repo,
        manifest: codex,
        execute: (_binary, _args, options) => {
          patched = readFileSync(join(options.cwd, "total.py"), "utf8");
          return Promise.resolve({ stdout: reviewStream("fine"), stderr: "", exitCode: 0 });
        },
      });
      expect(patched).toContain("discount");
    } finally {
      if (before === undefined) delete process.env["GIT_WORK_TREE"];
      else process.env["GIT_WORK_TREE"] = before;
    }
  });
});

/*
 * Refuted by a cold reader checking the claim that this could not happen. The earlier guard covered untracked
 * files copied in; `git worktree add` checks out symlinks HEAD already tracks, and a tracked link can point at an
 * ignored .env, at ~/.ssh/id_rsa, or anywhere else on the machine.
 */
describe("symbolic links that point out of the review copy", () => {
  const copyContents = async (): Promise<{ root: string; entries: string[] }> => {
    let root = "";
    let entries: string[] = [];
    await buddyReview({
      repoRoot: repo,
      manifest: codex,
      execute: (_binary, _args, options) => {
        root = options.cwd;
        entries = readdirSync(options.cwd);
        return Promise.resolve({ stdout: reviewStream("fine"), stderr: "", exitCode: 0 });
      },
    });
    return { root, entries };
  };

  it("cuts a link that HEAD tracks and that points outside the repository", async () => {
    const secret = join(tmpdir(), `fanout-secret-${String(process.pid)}`);
    writeFileSync(secret, "TOKEN=hunter2\n");
    symlinkSync(secret, join(repo, "notes.txt"));
    run(["add", "notes.txt"]);
    run(["commit", "--quiet", "-m", "a tracked symlink"]);
    dirty();

    try {
      const { entries } = await copyContents();
      expect(entries).not.toContain("notes.txt");
    } finally {
      rmSync(secret, { force: true });
    }
  });

  it("cuts a tracked link that climbs out with a relative path", async () => {
    symlinkSync("../../../etc/passwd", join(repo, "passwd.txt"));
    run(["add", "passwd.txt"]);
    run(["commit", "--quiet", "-m", "a relative escape"]);
    dirty();

    const { entries } = await copyContents();
    expect(entries).not.toContain("passwd.txt");
  });

  it("leaves a link alone when it stays inside the copy", async () => {
    // Part of the repository's own shape: following it reads only what the reviewer was already shown.
    symlinkSync("total.py", join(repo, "alias.py"));
    run(["add", "alias.py"]);
    run(["commit", "--quiet", "-m", "an internal link"]);
    dirty();

    const { entries } = await copyContents();
    expect(entries).toContain("alias.py");
  });

  it("says which links it cut", async () => {
    symlinkSync("/etc/passwd", join(repo, "passwd.txt"));
    run(["add", "passwd.txt"]);
    run(["commit", "--quiet", "-m", "escape"]);
    dirty();

    const { event } = await buddyReview({
      repoRoot: repo,
      manifest: codex,
      execute: () => Promise.resolve({ stdout: reviewStream("fine"), stderr: "", exitCode: 0 }),
    });
    expect(event.findings).toContain("passwd.txt (symlink)");
  });
});

/*
 * The attack a cold reader used to refute the first fix: two links whose *text* stays inside the copy while the
 * filesystem walks out of it. `path.resolve` folds `a/..` away before anything is followed; the kernel follows
 * `a` to the root and lands `..` in the parent. Only realpath sees the difference.
 */
describe("symbolic links that escape by chaining", () => {
  const entriesSeen = async (): Promise<string[]> => {
    let entries: string[] = [];
    await buddyReview({
      repoRoot: repo,
      manifest: codex,
      execute: (_binary, _args, options) => {
        entries = readdirSync(options.cwd);
        return Promise.resolve({ stdout: reviewStream("fine"), stderr: "", exitCode: 0 });
      },
    });
    return entries;
  };

  it("cuts a link that only looks contained until the links are followed", async () => {
    symlinkSync(".", join(repo, "a"));
    symlinkSync("a/../escaped.txt", join(repo, "leak"));
    run(["add", "a", "leak"]);
    run(["commit", "--quiet", "-m", "a chain out"]);
    dirty();

    const entries = await entriesSeen();
    expect(entries).not.toContain("leak");
  });

  it("keeps the harmless half of that chain, which does stay inside", async () => {
    symlinkSync(".", join(repo, "a"));
    run(["add", "a"]);
    run(["commit", "--quiet", "-m", "a link to here"]);
    dirty();

    expect(await entriesSeen()).toContain("a");
  });

  it("cuts a link that leads nowhere, rather than leaving a path it cannot explain", async () => {
    symlinkSync("does-not-exist", join(repo, "dangling"));
    run(["add", "dangling"]);
    run(["commit", "--quiet", "-m", "dangling"]);
    dirty();

    expect(await entriesSeen()).not.toContain("dangling");
  });

  it("leaves nothing worth reaching in the copy's parent", async () => {
    dirty();
    let parent: string[] = [];
    await buddyReview({
      repoRoot: repo,
      manifest: codex,
      execute: (_binary, _args, options) => {
        parent = readdirSync(join(options.cwd, ".."));
        return Promise.resolve({ stdout: reviewStream("fine"), stderr: "", exitCode: 0 });
      },
    });
    // The patch used to be written here, one `..` from anything the reviewer can read.
    expect(parent).toEqual(["work"]);
  });
});

/*
 * The fourth and sharpest refutation, verified on this machine before it was fixed: Node's JavaScript
 * `realpathSync` folds `..` lexically while resolving, so this link resolved to `<copy>/etc/passwd` while opening
 * it returned the system's real `/etc/passwd`. Only `realpathSync.native`, which asks the operating system, sees
 * where a chain actually lands.
 */
describe("symbolic links that defeat a lexical resolver", () => {
  it("cuts a chain that only the operating system can see through", async () => {
    mkdirSync(join(repo, "etc"), { recursive: true });
    writeFileSync(join(repo, "etc", "passwd"), "DECOY\n");
    symlinkSync(".", join(repo, "a"));
    symlinkSync(`${"a/".repeat(5)}${"../".repeat(5)}etc/passwd`, join(repo, "leak"));
    run(["add", "a", "leak", "etc/passwd"]);
    run(["commit", "--quiet", "-m", "a chain a lexical resolver cannot follow"]);
    dirty();

    let entries: string[] = [];
    await buddyReview({
      repoRoot: repo,
      manifest: codex,
      execute: (_binary, _args, options) => {
        entries = readdirSync(options.cwd);
        return Promise.resolve({ stdout: reviewStream("fine"), stderr: "", exitCode: 0 });
      },
    });

    expect(entries).not.toContain("leak");
  });
});
