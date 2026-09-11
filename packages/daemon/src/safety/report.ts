import { pathInScope, validatePlan, type LaunchSpec, type PlanGraph, type SafetyCheck } from "@fanout/core";
import type { SafetyCheckId, SafetyInput, SafetyReport } from "./types.ts";

/*
 * The gate between a plan and running it.
 *
 * Every check is computed here from the plan, the repository and the seats as detected — never from an agent's
 * word — and every one names the lines it concerns, so "why can't I launch?" always has a specific answer.
 * A check that cannot be evaluated says so and warns; it never passes quietly, because a gate that looks green
 * when it is not is worse than no gate.
 */

/** Flags that hand an agent the machine. A command carrying one never launches. */
const FORBIDDEN_FLAGS: readonly { flag: string; why: string }[] = [
  { flag: "--dangerously-bypass-approvals-and-sandbox", why: "it turns off the sandbox and every approval" },
  { flag: "--dangerously-skip-permissions", why: "it bypasses every permission check" },
  { flag: "--dangerously-bypass-hook-trust", why: "it runs untrusted hooks" },
  { flag: "danger-full-access", why: "it gives the run full access to the machine" },
  { flag: "bypassPermissions", why: "it bypasses every permission check" },
  { flag: "--always-approve", why: "it approves whatever the agent asks for" },
  { flag: "--yolo", why: "it auto-approves tool calls" },
  { flag: "--approve-for-me", why: "it approves the agent's requests automatically" },
];

export interface RepositoryState {
  /** Where the repository is now. */
  head: string;
  /** Paths with uncommitted changes, relative to the repository root. */
  dirty: readonly string[];
}

export interface SafetyDependencies {
  /** Tracked files at the base commit that the deny-list covers. */
  deniedFiles: (baseCommit: string) => Promise<readonly string[]>;
  /** The repository as it is right now. */
  repositoryState: () => Promise<RepositoryState>;
}

export async function safetyReport(input: SafetyInput, deps: SafetyDependencies): Promise<SafetyReport> {
  const checks: SafetyCheck[] = [
    ...planChecks(input.plan),
    await secretsCheck(input, deps),
    ...seatChecks(input),
    ...commandChecks(input),
    concurrencyCheck(input),
    await baseCommitCheck(input, deps),
  ];

  return {
    ok: checks.every((check) => check.ok || check.severity === "warn"),
    planRevision: input.planRevision,
    checks,
    dryRun: input.plan.lines.map((line) => ({
      lineId: line.id,
      seat: line.seat.id,
      argv: input.commands[line.id]?.argv ?? [],
      cwd: input.commands[line.id]?.cwd ?? "",
    })),
  };
}

function check(
  id: SafetyCheckId,
  ok: boolean,
  severity: SafetyCheck["severity"],
  message: string,
  lineIds?: string[],
): SafetyCheck {
  return { id, ok, severity, message, ...(lineIds === undefined ? {} : { lineIds }) };
}

/** Two of the eight come straight from the plan schema: scopes must be declared, and must not overlap. */
function planChecks(plan: PlanGraph): SafetyCheck[] {
  const issues = validatePlan(plan);
  const overlaps = issues.filter((issue) => issue.code === "scope_overlap");
  const structural = issues.filter((issue) => issue.code !== "scope_overlap");

  return [
    check(
      "scopes-disjoint",
      overlaps.length === 0,
      "block",
      overlaps.length === 0
        ? "No two lines that can run at the same time write the same path."
        : overlaps.map((issue) => issue.message).join(" "),
      overlaps.flatMap((issue) => issue.lineIds),
    ),
    check(
      "scopes-declared",
      structural.length === 0,
      "block",
      structural.length === 0
        ? "Every line declares where it may write, and the plan's dependencies make sense."
        : structural.map((issue) => issue.message).join(" "),
      structural.flatMap((issue) => issue.lineIds),
    ),
  ];
}

async function secretsCheck(input: SafetyInput, deps: SafetyDependencies): Promise<SafetyCheck> {
  const denied = await deps.deniedFiles(input.repo.baseCommit);
  return check(
    "secrets-excluded",
    denied.length === 0,
    "block",
    denied.length === 0
      ? "Nothing the deny-list covers is tracked at the base commit; ignored files are in no workspace."
      : `The repository tracks ${denied.length} file(s) an agent must never receive: ${denied
          .slice(0, 5)
          .join(", ")}${denied.length > 5 ? ", …" : ""}.`,
  );
}

function seatChecks(input: SafetyInput): SafetyCheck[] {
  const missing: string[] = [];
  const unsupported: string[] = [];
  const signedOut: string[] = [];
  const unknown: string[] = [];

  for (const line of input.plan.lines) {
    const seat = input.seats[line.seat.id];
    if (seat === undefined) missing.push(line.id);
    else if (!seat.supported) unsupported.push(line.id);
    else if (seat.signedIn === "no") signedOut.push(line.id);
    else if (seat.signedIn === "unknown") unknown.push(line.id);
  }

  const blocked = [...missing, ...unsupported, ...signedOut];
  const reasons = [
    missing.length > 0 ? `not installed (${missing.join(", ")})` : "",
    unsupported.length > 0 ? `an unsupported version (${unsupported.join(", ")})` : "",
    signedOut.length > 0 ? `not signed in (${signedOut.join(", ")})` : "",
  ].filter((reason) => reason !== "");

  return [
    check(
      "seat-available",
      blocked.length === 0,
      "block",
      blocked.length === 0
        ? "Every line's seat is installed, signed in and a version we support."
        : `Some lines have no usable seat: ${reasons.join("; ")}.`,
      blocked,
    ),
    ...(unknown.length === 0
      ? []
      : [
          check(
            "seat-available",
            false,
            "warn",
            `Sign-in state is unknown for ${unknown.length} line(s); the seat's CLI has no status command, ` +
              "so a run may fail at launch.",
            unknown,
          ),
        ]),
  ];
}

function commandChecks(input: SafetyInput): SafetyCheck[] {
  const missing = input.plan.lines
    .filter((line) => input.commands[line.id] === undefined)
    .map((line) => line.id);
  const dangerous: { lineId: string; why: string }[] = [];

  for (const line of input.plan.lines) {
    const spec: LaunchSpec | undefined = input.commands[line.id];
    if (spec === undefined) continue;
    const argv = spec.argv.join(" ");
    for (const { flag, why } of FORBIDDEN_FLAGS) {
      if (argv.includes(flag)) dangerous.push({ lineId: line.id, why: `${flag}: ${why}` });
    }
  }

  return [
    check(
      "permission-mode",
      missing.length === 0 && dangerous.length === 0,
      "block",
      missing.length > 0
        ? `No command was built for ${missing.join(", ")}, so there is nothing to show you before launch.`
        : dangerous.length === 0
          ? "Every seat runs in the safest mode that can still do its work."
          : dangerous.map((entry) => `${entry.lineId} would run with ${entry.why}`).join("; "),
      [...missing, ...dangerous.map((entry) => entry.lineId)],
    ),
    check(
      "network",
      true,
      "warn",
      "Network isolation is the CLI's own: we select the safest mode each seat offers and cannot verify more " +
        "than that. Treat a run as able to reach the network unless its vendor documents otherwise.",
    ),
  ];
}

function concurrencyCheck(input: SafetyInput): SafetyCheck {
  const starting = input.plan.lines.filter((line) => line.dependsOn.length === 0);
  const perSeat = new Map<string, number>();
  for (const line of starting) perSeat.set(line.seat.id, (perSeat.get(line.seat.id) ?? 0) + 1);

  const overSeat = [...perSeat.entries()].filter(([seat, count]) => {
    const cap = input.limits.perSeat[seat];
    return cap !== undefined && count > cap;
  });
  const overall = starting.length > input.limits.maxParallel;

  return check(
    "concurrency",
    !overall && overSeat.length === 0,
    "block",
    overall
      ? `${starting.length} lines would start at once but the mission allows ${input.limits.maxParallel}.`
      : overSeat.length > 0
        ? overSeat
            .map(
              ([seat, count]) =>
                `${count} lines would start on ${seat}, which allows ${input.limits.perSeat[seat] ?? 0}`,
            )
            .join("; ")
        : `${starting.length} line(s) start at once, within the mission's limit of ${input.limits.maxParallel}.`,
    starting.map((line) => line.id),
  );
}

async function baseCommitCheck(input: SafetyInput, deps: SafetyDependencies): Promise<SafetyCheck> {
  const state = await deps.repositoryState();
  if (state.head !== input.repo.baseCommit) {
    return check(
      "base-commit",
      false,
      "block",
      `The repository is at ${state.head.slice(0, 7)} but the mission plans from ` +
        `${input.repo.baseCommit.slice(0, 7)}. Re-plan from where you are, or check out that commit.`,
    );
  }

  const conflicts = state.dirty.filter((path) =>
    input.plan.lines.some((line) => line.scope.write.some((pattern) => pathInScope(path, pattern))),
  );
  return check(
    "base-commit",
    conflicts.length === 0,
    "block",
    conflicts.length === 0
      ? "The repository is at the mission's base commit, with nothing uncommitted inside any line's scope."
      : `Uncommitted changes sit inside a line's scope (${conflicts.slice(0, 5).join(", ")}); commit or stash ` +
          "them, or the merge will fight you later.",
  );
}
