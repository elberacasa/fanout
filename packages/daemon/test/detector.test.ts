import { AdapterManifest, SeatInfo } from "@fanout/core";
import { describe, expect, it, vi } from "vitest";
import { detectSeats, type CommandResult } from "../src/detector/detect.ts";
import { compareVersions, parseVersion, satisfies } from "../src/detector/version.ts";

/*
 * Detection answers three questions per seat — are you here, which version, are you signed in — and is allowed to
 * answer "I don't know". These tests make sure it never answers "yes" when it doesn't know.
 */

const manifest = AdapterManifest.parse({
  id: "codex",
  displayName: "OpenAI Codex",
  binary: "codex",
  supportedVersions: ">=0.150.0 <1.0.0",
  tier: "supported",
  capabilities: { resume: null, fork: null, review: null, plan: null },
  headless: { args: ["exec", "{prompt}"], stdin: "closed" },
  stream: { flag: "--json", format: "jsonl" },
  models: ["gpt-5.6-luna"],
  efforts: ["low"],
  permissionModes: { readOnly: "read-only", edit: "workspace-write" },
  network: { canDisable: false, flag: null },
  signIn: { probe: ["login", "status"], okPattern: "^\\s*Logged in\\b", noPattern: "^\\s*Not logged in\\b" },
  usage: { probe: null, window: "unknown" },
  billing: "subscription",
  terms: { reviewedAt: "2026-09-11", notes: "" },
  status: "alpha",
});

const ok = (stdout: string): CommandResult => ({ stdout, stderr: "", exitCode: 0 });

function detect(
  execute: (binary: string, args: readonly string[]) => Promise<CommandResult>,
): Promise<SeatInfo[]> {
  return detectSeats({ manifests: [manifest], execute });
}

describe("reading a version out of whatever a CLI prints", () => {
  it.each([
    ["codex-cli 0.154.0", { major: 0, minor: 154, patch: 0 }],
    ["0.36.1", { major: 0, minor: 36, patch: 1 }],
    ["grok 1.0.13 (5e9a58528b76) [stable]", { major: 1, minor: 0, patch: 13 }],
    ["2.1.269 (Claude Code)", { major: 2, minor: 1, patch: 269 }],
    ["v3.4", { major: 3, minor: 4, patch: 0 }],
  ])("reads %j", (text, expected) => {
    expect(parseVersion(text)).toEqual(expected);
  });

  it.each(["", "no numbers here", "version unknown"])("cannot read %j", (text) => {
    expect(parseVersion(text)).toBeNull();
  });

  it("orders versions the way a person would", () => {
    const older = parseVersion("0.9.9");
    const newer = parseVersion("0.10.0");
    if (older === null || newer === null) throw new Error("fixture versions must parse");
    expect(compareVersions(older, newer)).toBeLessThan(0);
  });
});

describe("version ranges", () => {
  const version = (text: string) => {
    const parsed = parseVersion(text);
    if (parsed === null) throw new Error(`fixture version ${text} must parse`);
    return parsed;
  };

  it.each([
    ["0.154.0", ">=0.150.0 <1.0.0", true],
    ["0.149.9", ">=0.150.0 <1.0.0", false],
    ["1.0.0", ">=0.150.0 <1.0.0", false],
    ["1.0.13", ">=1.0 <2", true],
    ["2.1.269", "=2.1.269", true],
    ["2.1.270", "=2.1.269", false],
  ])("%s against %j is %s", (text, range, expected) => {
    expect(satisfies(version(text), range)).toBe(expected);
  });

  it.each(["", "   ", "^1.0.0", "~0.154", "latest"])(
    "treats the unreadable range %j as no match",
    (range) => {
      expect(satisfies(version("0.154.0"), range)).toBe(false);
    },
  );
});

describe("detecting a seat", () => {
  it("reports a signed-in, supported CLI", async () => {
    const [seat] = await detect((_binary, args) =>
      Promise.resolve(args[0] === "--version" ? ok("codex-cli 0.154.0") : ok("Logged in using ChatGPT")),
    );
    expect(seat).toMatchObject({
      id: "codex",
      version: "0.154.0",
      supported: true,
      signedIn: "yes",
      billing: "subscription",
    });
  });

  it("reports a CLI that is not installed without inventing a version", async () => {
    const [seat] = await detect(() => Promise.reject(new Error("spawn codex ENOENT")));
    expect(seat).toMatchObject({ version: null, supported: false, signedIn: "unknown" });
  });

  it.each([
    ["a version it cannot read", "codex-cli (dev build)"],
    ["nothing at all", ""],
  ])("reports %s as unsupported", async (_, output) => {
    const [seat] = await detect(() => Promise.resolve(ok(output)));
    expect(seat).toMatchObject({ version: null, supported: false, signedIn: "unknown" });
  });

  it("stops at the version when the CLI is outside the range the adapter was verified against", async () => {
    const execute = vi.fn((_binary: string, args: readonly string[]) =>
      Promise.resolve(args[0] === "--version" ? ok("codex-cli 2.0.0") : ok("Logged in")),
    );
    const [seat] = await detectSeats({ manifests: [manifest], execute });

    expect(seat).toMatchObject({ version: "2.0.0", supported: false, signedIn: "unknown" });
    expect(execute).toHaveBeenCalledTimes(1); // never asks about sign-in for a version it cannot parse honestly
  });

  it.each([
    ["the probe exits non-zero saying so", { stdout: "", stderr: "Not logged in", exitCode: 1 }, "no"],
    // "Logged out" is neither of the two answers this CLI is documented to give. It used to be read as a
    // confident "no"; an answer we cannot classify is now "unknown", which is what it always was.
    ["the probe says something else", { stdout: "Logged out", stderr: "", exitCode: 0 }, "unknown"],
  ])("reports %s", async (_, probeResult, expected) => {
    const [seat] = await detect((_binary, args) =>
      Promise.resolve(args[0] === "--version" ? ok("codex-cli 0.154.0") : probeResult),
    );
    expect(seat?.signedIn).toBe(expected);
  });

  it("says it does not know when a CLI has no way to tell us", async () => {
    const [seat] = await detectSeats({
      manifests: [
        AdapterManifest.parse({ ...manifest, signIn: { probe: null, okPattern: null, noPattern: null } }),
      ],
      execute: () => Promise.resolve(ok("codex-cli 0.154.0")),
    });
    expect(seat?.signedIn).toBe("unknown");
  });

  it("says it does not know when the probe itself fails", async () => {
    const [seat] = await detect((_binary, args) =>
      args[0] === "--version"
        ? Promise.resolve(ok("codex-cli 0.154.0"))
        : Promise.reject(new Error("timed out")),
    );
    expect(seat?.signedIn).toBe("unknown");
  });

  it("detects every seat it is given, in order", async () => {
    const second = AdapterManifest.parse({
      ...manifest,
      id: "kimi",
      binary: "kimi",
      displayName: "Kimi Code",
    });
    const seats = await detectSeats({
      manifests: [manifest, second],
      execute: (binary, args) =>
        Promise.resolve(
          args[0] === "--version" ? ok(binary === "codex" ? "0.154.0" : "0.36.1") : ok("Logged in"),
        ),
    });
    expect(seats.map((seat) => seat.id)).toEqual(["codex", "kimi"]);
    expect(seats.map((seat) => seat.version)).toEqual(["0.154.0", "0.36.1"]);
  });
});

/*
 * Reading the plan is the one probe whose output we must handle like a hazard. `claude auth status --json` answers
 * with the subscription tier we want and, in the same object, the user's email address and organisation id. The
 * manifest declares an allowlist; these tests are what makes that allowlist real rather than a note in a schema.
 */
describe("reading which plan a seat is on", () => {
  const EMAIL = "someone@example.test";
  const ORG_ID = "11111111-2222-3333-4444-555555555555";
  const ORG_NAME = "Someone's Organization";

  /** The exact shape `claude auth status --json` returns, with invented identity values. */
  const probeAnswer = JSON.stringify({
    loggedIn: true,
    authMethod: "claude.ai",
    apiProvider: "firstParty",
    analyticsDisabled: false,
    projectsDirectory: "/home/someone/.claude/projects",
    configDirectory: "/home/someone/.claude",
    email: EMAIL,
    orgId: ORG_ID,
    orgName: ORG_NAME,
    subscriptionType: "max",
  });

  const withPlan = AdapterManifest.parse({
    ...manifest,
    id: "claude",
    binary: "claude",
    displayName: "Claude Code",
    supportedVersions: ">=2.0 <3",
    signIn: {
      probe: ["auth", "status"],
      okPattern: String.raw`"loggedIn"\s*:\s*true`,
      noPattern: String.raw`"loggedIn"\s*:\s*false`,
    },
    capabilities: {
      resume: null,
      fork: null,
      review: null,
      plan: {
        probe: ["auth", "status", "--json"],
        format: "json",
        keep: ["loggedIn", "subscriptionType"],
        planField: "subscriptionType",
      },
    },
  });

  const answer = (stdout: string) => (_binary: string, args: readonly string[]) =>
    Promise.resolve(args[0] === "--version" ? ok("2.1.269 (Claude Code)") : ok(stdout));

  const detectWithPlan = (stdout: string): Promise<SeatInfo[]> =>
    detectSeats({ manifests: [withPlan], execute: answer(stdout) });

  it("reads the plan the CLI reports", async () => {
    const [seat] = await detectWithPlan(probeAnswer);
    expect(seat?.plan).toEqual({ name: "max", source: "detected" });
  });

  /*
   * The regression that matters. Not "the field is absent from a property we check" but "no part of the identity
   * survives anywhere in what detection returns" — serialise the whole seat and search it.
   */
  it("keeps nothing outside the allowlist, anywhere in what it returns", async () => {
    const [seat] = await detectWithPlan(probeAnswer);
    const serialised = JSON.stringify(seat);

    expect(serialised).not.toContain(EMAIL);
    expect(serialised).not.toContain(ORG_ID);
    expect(serialised).not.toContain(ORG_NAME);
    expect(serialised).not.toContain("example.test");
    expect(serialised).not.toContain(".claude/projects");
    expect(serialised).not.toContain("firstParty");
  });

  it("says nothing rather than guessing when the CLI has no plan probe", async () => {
    const [seat] = await detect((_binary, args) =>
      Promise.resolve(args[0] === "--version" ? ok("0.154.0") : ok("Logged in")),
    );
    expect(seat?.plan).toBeNull();
  });

  it.each([
    ["output that is not JSON at all", "Logged in using ChatGPT"],
    ["JSON that is not an object", '"max"'],
    ["an object without the plan field", JSON.stringify({ loggedIn: true, email: EMAIL })],
    ["a plan field that is not a string", JSON.stringify({ subscriptionType: { tier: "max" } })],
    ["an empty plan field", JSON.stringify({ subscriptionType: "" })],
  ])("reports no plan for %s", async (_label, stdout) => {
    const [seat] = await detectWithPlan(stdout);
    expect(seat?.plan).toBeNull();
    expect(JSON.stringify(seat)).not.toContain(EMAIL);
  });

  it("reports no plan when the probe fails or cannot start", async () => {
    const [failed] = await detectSeats({
      manifests: [withPlan],
      execute: (_binary, args) =>
        args[0] === "--version"
          ? Promise.resolve(ok("2.1.269"))
          : Promise.resolve({ stdout: probeAnswer, stderr: "", exitCode: 1 }),
    });
    expect(failed?.plan).toBeNull();

    const [threw] = await detectSeats({
      manifests: [withPlan],
      execute: (_binary, args) =>
        args[0] === "--version"
          ? Promise.resolve(ok("2.1.269"))
          : Promise.reject(new Error("no such command")),
    });
    expect(threw?.plan).toBeNull();
  });

  it("does not run the plan probe at all for an unsupported version", async () => {
    const probed: string[][] = [];
    const [seat] = await detectSeats({
      manifests: [withPlan],
      execute: (_binary, args) => {
        probed.push([...args]);
        return Promise.resolve(args[0] === "--version" ? ok("9.9.9") : ok(probeAnswer));
      },
    });
    expect(seat?.supported).toBe(false);
    expect(seat?.plan).toBeNull();
    // An unverified version means an unverified output shape: we never send it the probe.
    expect(probed).toEqual([["--version"]]);
  });
});

/*
 * Found by an adversarial audit of this file (2026-09-12). Sign-in was decided by searching the probe's whole
 * output for a positive pattern, which is wrong in three separate ways, and the first of them shipped.
 */
describe("classifying sign-in without fooling itself", () => {
  const signedOutCodex = (text: string) => (_binary: string, args: readonly string[]) =>
    Promise.resolve(args[0] === "--version" ? ok("codex-cli 0.154.0") : ok(text));

  it("does not read 'Not logged in' as 'Logged in'", async () => {
    const [seat] = await detect(signedOutCodex("Not logged in"));
    expect(seat?.signedIn).toBe("no");
  });

  it("still reads a real sign-in as yes", async () => {
    const [seat] = await detect(signedOutCodex("Logged in using ChatGPT"));
    expect(seat?.signedIn).toBe("yes");
  });

  it("says unknown, not no, when the answer fits neither shape", async () => {
    // A service blip is not an answer about this account, and reporting "no" would send work elsewhere for a
    // reason that is not true.
    const [seat] = await detect(signedOutCodex("temporary service failure"));
    expect(seat?.signedIn).toBe("unknown");
  });

  it("says unknown when the probe exits non-zero without a recognisable answer", async () => {
    const [seat] = await detect((_binary, args) =>
      Promise.resolve(
        args[0] === "--version" ? ok("codex-cli 0.154.0") : { stdout: "", stderr: "boom", exitCode: 70 },
      ),
    );
    expect(seat?.signedIn).toBe("unknown");
  });

  it("reads a non-zero exit that names the answer as that answer", async () => {
    const [seat] = await detect((_binary, args) =>
      Promise.resolve(
        args[0] === "--version"
          ? ok("codex-cli 0.154.0")
          : { stdout: "", stderr: "Not logged in", exitCode: 1 },
      ),
    );
    expect(seat?.signedIn).toBe("no");
  });
});

/*
 * Also from the audit: detection is the first thing a session does, so it must always finish. A CLI that hangs is
 * not hypothetical — one of the seats on this machine has no status command at all, and a probe that waits on EOF
 * waits forever.
 */
describe("detection always settles", () => {
  it("gives up on a probe that never answers, and says unknown", async () => {
    const seats = await detectSeats({
      manifests: [manifest],
      timeoutMs: 30,
      execute: (_binary, args) =>
        args[0] === "--version" ? Promise.resolve(ok("codex-cli 0.154.0")) : never(),
    });

    expect(seats).toHaveLength(1);
    expect(seats[0]).toMatchObject({ version: "0.154.0", supported: true, signedIn: "unknown" });
  });

  it("gives up on a version probe that never answers", async () => {
    const seats = await detectSeats({
      manifests: [manifest],
      timeoutMs: 30,
      execute: () => never(),
    });
    expect(seats[0]).toMatchObject({ version: null, supported: false, signedIn: "unknown" });
  });

  it("does not let one hanging seat hide the seats that answered", async () => {
    const kimi = AdapterManifest.parse({ ...manifest, id: "kimi", binary: "kimi" });
    const seats = await detectSeats({
      manifests: [manifest, kimi],
      timeoutMs: 30,
      execute: (binary, args) =>
        binary === "kimi"
          ? never()
          : Promise.resolve(args[0] === "--version" ? ok("codex-cli 0.154.0") : ok("Logged in")),
    });

    expect(seats.map((seat) => seat.id)).toEqual(["codex", "kimi"]);
    expect(seats[0]?.signedIn).toBe("yes");
    expect(seats[1]?.signedIn).toBe("unknown");
  });
});

/* Two smaller honesty holes the audit found in the plan probe. */
describe("refusing a plan we should not believe", () => {
  const withPlan = AdapterManifest.parse({
    ...manifest,
    id: "claude",
    binary: "claude",
    supportedVersions: ">=2.0 <3",
    capabilities: {
      resume: null,
      fork: null,
      review: null,
      plan: {
        probe: ["auth", "status", "--json"],
        format: "json",
        keep: ["loggedIn", "subscriptionType"],
        planField: "subscriptionType",
      },
    },
  });

  const detectPlan = (stdout: string) =>
    detectSeats({
      manifests: [withPlan],
      execute: (_binary, args) => Promise.resolve(args[0] === "--version" ? ok("2.1.269") : ok(stdout)),
    });

  it("does not report a plan for an account that is signed out", async () => {
    // The allowlist keeps `loggedIn` precisely so we can ask this; ignoring it would let a stale tier be
    // presented as the current account's.
    const [seat] = await detectPlan(JSON.stringify({ loggedIn: false, subscriptionType: "max" }));
    expect(seat?.plan).toBeNull();
  });

  it("refuses a plan name too long for the seat schema to carry", async () => {
    const [seat] = await detectPlan(JSON.stringify({ loggedIn: true, subscriptionType: "x".repeat(101) }));
    expect(seat?.plan).toBeNull();
  });

  it("returns a seat that its own schema accepts, whatever the CLI said", async () => {
    const [seat] = await detectPlan(JSON.stringify({ loggedIn: true, subscriptionType: "x".repeat(101) }));
    expect(SeatInfo.safeParse(seat).success).toBe(true);
  });
});

/** A probe that never answers. Named, because `new Promise(() => {})` reads like a mistake at every call site. */
function never(): Promise<CommandResult> {
  return new Promise<CommandResult>(() => {
    /* deliberately never settles */
  });
}
