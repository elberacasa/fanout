import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  missionReport,
  PlanGraph,
  PlanLine,
  project,
  validatePlan,
  type AdapterManifest,
  type Ledger,
  type SeatAdapter,
} from "@fanout/core";
import {
  checkClaims,
  createSafetyDependencies,
  createMissionRunner,
  createWorkspaceManager,
  detectSeats,
  git,
  lines as splitLines,
  safetyReport,
  zeroSeparated,
  type MissionHandle,
  type RunLimits,
} from "@fanout/daemon";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/*
 * The lead's tools. Claude Code is the brain; this is the hand it works with.
 *
 * Every tool answers in plain words as well as data, because the lead reads them and so does the person watching.
 * Two rules shape the surface:
 *
 *   - Nothing runs that has not passed the gate. `launch` refuses a red safety report unless the user says
 *     otherwise in so many words, and that override is recorded.
 *   - Nothing merges here at all. Review and merge arrive with the gate; a tool that quietly merged would be the
 *     most dangerous thing in the product.
 */

export interface FanoutMcpOptions {
  ledger: Ledger;
  /** The repository the session is working in. */
  repoRoot: string;
  /** Where run logs, reports and workspaces live. */
  paths: { runs: string; workspaces: string };
  /** Seat id to adapter, and the manifests behind them. */
  adapters: ReadonlyMap<string, SeatAdapter>;
  manifests: readonly AdapterManifest[];
  limits: RunLimits;
  /** Injected in tests so nothing needs a CLI installed. */
  execute?: (
    binary: string,
    args: readonly string[],
  ) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  /** The clock elapsed and quiet times are measured against; injected so tests are not timing-dependent. */
  now?: () => Date;
}

const MissionLimits = { maxParallel: z.int().min(1).max(16).default(3) };

export function createFanoutServer(options: FanoutMcpOptions): McpServer {
  const server = new McpServer(
    { name: "fanout", version: "0.6.0-dev" },
    {
      instructions:
        "Fanout runs the other coding-agent CLIs on this machine as a crew. Plan with `plan_check`, start with " +
        "`launch`, watch with `mission_status`, and read a run's work with `run_diff`. Nothing merges here: review " +
        "the diff yourself and apply it, or wait for the merge gate.",
    },
  );

  const workspaces = createWorkspaceManager({
    repoRoot: options.repoRoot,
    workspaceRoot: options.paths.workspaces,
  });
  const runner = createMissionRunner({
    ledger: options.ledger,
    workspaces,
    adapters: options.adapters,
    runsRoot: options.paths.runs,
    limits: options.limits,
  });
  const missions = new Map<string, MissionHandle>();

  server.registerTool(
    "seats",
    {
      title: "The crew on this machine",
      description:
        "Which agent CLIs are installed, which version, and whether each is signed in. A seat whose CLI cannot " +
        "tell us is reported as unknown, never as ready.",
      inputSchema: {},
    },
    async () => {
      const seats = await detectSeats({
        manifests: options.manifests,
        ...(options.execute === undefined ? {} : { execute: options.execute }),
      });
      const ready = seats.filter((seat) => seat.supported && seat.signedIn === "yes");
      return text(
        `${ready.length} of ${seats.length} seats are ready.\n` +
          seats
            .map(
              (seat) =>
                `- ${seat.id}: ${seat.version ?? "not installed"}, ` +
                (seat.supported ? seat.signedIn : "unsupported version"),
            )
            .join("\n"),
        { seats },
      );
    },
  );

  server.registerTool(
    "repo_overview",
    {
      title: "A map of this repository",
      description:
        "What is here and where, so a plan can be written without reading every file: the commit the mission " +
        "would start from, whether the tree is clean, the top-level areas by size, and the checks the project runs.",
      inputSchema: {},
    },
    async () => {
      const overview = await repoOverview(options.repoRoot);
      return text(
        `On ${overview.head.slice(0, 7)}${overview.dirty.length > 0 ? ` with ${overview.dirty.length} uncommitted file(s)` : ", clean"}.\n` +
          `Areas: ${overview.areas.map((area) => `${area.path} (${area.files})`).join(", ")}\n` +
          `Checks: ${overview.checks.length > 0 ? overview.checks.join(", ") : "none found"}`,
        overview,
      );
    },
  );

  server.registerTool(
    "plan_check",
    {
      title: "Check a plan before anything runs",
      description:
        "Validates a plan and returns the safety report: overlapping write scopes, anything deny-listed in the " +
        "repository, seats that are missing or signed out, the concurrency limits, and the exact commands that " +
        "would run. Records nothing, so iterate freely.",
      inputSchema: { lines: z.array(PlanLine), ...MissionLimits },
    },
    async ({ lines, maxParallel }) => {
      const plan = PlanGraph.parse({ lines });
      const report = await gate(options, plan, maxParallel);
      const blocking = report.checks.filter((check) => !check.ok && check.severity === "block");
      return text(
        blocking.length === 0
          ? `The plan is ready to launch. ${report.checks.filter((check) => !check.ok).length} warning(s).`
          : `This plan cannot launch yet:\n${blocking.map((check) => `- ${check.message}`).join("\n")}`,
        report,
      );
    },
  );

  server.registerTool(
    "launch",
    {
      title: "Start a mission",
      description:
        "Runs a plan: each line in its own git worktree, in dependency order, never more at once than allowed. " +
        "Refuses a plan whose safety report has a blocking failure unless `override` explains why, which is " +
        "recorded. Returns as soon as the runs are under way; watch with mission_status.",
      inputSchema: {
        goal: z.string().min(1).max(4000),
        lines: z.array(PlanLine),
        ...MissionLimits,
        override: z.string().min(10).max(500).optional(),
      },
    },
    async ({ goal, lines, maxParallel, override }) => {
      const plan = PlanGraph.parse({ lines });
      const issues = validatePlan(plan);
      if (issues.length > 0) {
        return text(`This plan cannot run:\n${issues.map((issue) => `- ${issue.message}`).join("\n")}`, {
          issues,
        });
      }

      const report = await gate(options, plan, maxParallel);
      const blocking = report.checks.filter((check) => !check.ok && check.severity === "block");
      if (blocking.length > 0 && override === undefined) {
        return text(
          `Not launching. The safety report has ${blocking.length} blocking failure(s):\n` +
            `${blocking.map((check) => `- ${check.message}`).join("\n")}\n` +
            "Fix the plan, or pass `override` with the reason if the user has decided to go ahead anyway.",
          report,
        );
      }

      const missionId = missionIdFor(goal);
      const head = (await git(["rev-parse", "HEAD"], { cwd: options.repoRoot })).trim();
      options.ledger.appendAll([
        {
          type: "mission.created",
          missionId,
          goal,
          repo: { root: options.repoRoot, baseCommit: head },
          limits: { maxParallel, timeoutMinutes: Math.ceil(options.limits.timeoutMs / 60_000) },
        },
        { type: "plan.proposed", missionId, plan, by: "lead" },
        { type: "safety.report", missionId, planRevision: 1, ok: report.ok, checks: report.checks },
      ]);

      const handle = runner.launch({ missionId, plan, baseCommit: head, maxParallel });
      missions.set(missionId, handle);
      void handle.finished.then((outcome) => {
        options.ledger.append({
          type: "mission.finished",
          missionId,
          outcome: outcome.failed === 0 && outcome.dropped === 0 ? "completed" : "aborted",
          summary: `${outcome.done} done, ${outcome.failed} failed, ${outcome.dropped} dropped`,
        });
      });

      return text(
        `Mission ${missionId} is running ${plan.lines.length} line(s) from ${head.slice(0, 7)}` +
          `${override === undefined ? "" : `, with the safety report overridden: ${override}`}.`,
        { missionId, baseCommit: head, lines: plan.lines.map((line) => line.id) },
      );
    },
  );

  server.registerTool(
    "mission_status",
    {
      title: "How a mission is going",
      description:
        "Every run of a mission: how long it has been going, which phase it reported, what it touched and how " +
        "it ended. A run still working that has said nothing for a while is marked quiet, which is the " +
        "difference between an agent thinking and an agent that has stopped.",
      inputSchema: { missionId: z.string().min(1) },
    },
    ({ missionId }) => {
      const state = project(options.ledger.read({ missionId }));
      const mission = state.missions[missionId];
      if (mission === undefined) return text(`No mission called ${missionId}.`, { missionId });

      return text(missionReport(mission, (options.now ?? (() => new Date()))()), { mission });
    },
  );

  server.registerTool(
    "run_diff",
    {
      title: "What a run actually changed",
      description:
        "The diff read from the run's own workspace, not the agent's account of it, plus anything it wrote " +
        "outside its declared scope and the report it left.",
      inputSchema: {
        missionId: z.string().min(1),
        runId: z.string().min(1),
        patch: z.boolean().default(false),
      },
    },
    async ({ missionId, runId, patch }) => {
      const state = project(options.ledger.read({ missionId }));
      const run = state.missions[missionId]?.runs[runId];
      if (run === undefined) return text(`No run called ${runId} in ${missionId}.`, { missionId, runId });

      const plan = state.missions[missionId]?.plan;
      const line = plan?.lines.find((entry) => entry.id === run.lineId);
      const workspace = {
        missionId,
        runId,
        kind: "worktree" as const,
        path: join(options.paths.workspaces, missionId, runId),
        branch: `fanout/${missionId}/${runId}`,
        baseCommit: state.missions[missionId]?.repo.baseCommit ?? "",
      };
      if (line === undefined || !existsSync(workspace.path)) {
        return text(`The workspace for ${runId} is gone, so there is nothing left to read.`, { runId });
      }

      const diff = await workspaces.collect(workspace, line);
      const reportPath = join(options.paths.runs, missionId, runId, "report.md");
      const report = existsSync(reportPath) ? readFileSync(reportPath, "utf8").slice(0, 20_000) : null;

      return text(
        `${runId}: ${diff.stat.files} file(s), +${diff.stat.insertions} −${diff.stat.deletions}.` +
          (diff.outsideScope.length > 0 ? `\nOutside its scope: ${diff.outsideScope.join(", ")}` : "") +
          (report === null ? "" : `\n\nIts report:\n${report}`),
        {
          stat: diff.stat,
          newFiles: diff.newFiles,
          outsideScope: diff.outsideScope,
          report,
          ...(patch ? { patch: diff.patch.slice(0, 200_000) } : {}),
        },
      );
    },
  );

  server.registerTool(
    "cancel_mission",
    {
      title: "Stop a mission",
      description: "Stops every run still going and drops the lines that had not started, with the reason.",
      inputSchema: { missionId: z.string().min(1), reason: z.string().min(1).max(500) },
    },
    async ({ missionId, reason }) => {
      const handle = missions.get(missionId);
      if (handle === undefined) return text(`Mission ${missionId} is not running here.`, { missionId });
      await handle.cancel(reason);
      return text(`Stopped ${missionId}: ${reason}`, { missionId });
    },
  );

  /*
   * The tool this whole product exists for.
   *
   * Most of the code in a Claude Code session is written by the lead and reviewed by the lead, and the lead's own
   * context — the plan, the reasoning, the justification — is exactly what hides its mistakes from it. A reader
   * holding only the diff is not smarter, it is differently placed. This is here rather than only in the terminal
   * because a check the lead has to remember to leave the session for is a check the lead will not run.
   */
  server.registerTool(
    "check_claims",
    {
      title: "Have a second vendor try to disprove what you believe",
      description:
        "State what you believe about your own uncommitted changes; another vendor's CLI reads them cold, with " +
        "no knowledge of why you wrote them, and tries to falsify each claim. Run this before telling anyone " +
        'work is done. Write claims that could be proven false — "it works" cannot be checked, "no caller of ' +
        'total() passes fewer than two arguments" can. A claim is only ever reported confirmed when the reader ' +
        "said so explicitly: anything it skipped or garbled comes back unclear, never as a pass.",
      inputSchema: {
        claims: z.array(z.string().trim().min(1).max(500)).min(1).max(10),
      },
    },
    async ({ claims }) => {
      const manifest = options.manifests.find((seat) => seat.capabilities.review !== null);
      if (manifest === undefined) {
        return text("No seat on this machine can read code it did not write.", { ran: false });
      }

      const { event, refuted } = await checkClaims({
        repoRoot: options.repoRoot,
        claims,
        manifest,
        ...(options.execute === undefined ? {} : { execute: seatExecute(options.execute) }),
      });
      options.ledger.appendAll([event]);

      if (!event.ran) {
        // "We could not ask" must never read as "nothing was refuted".
        return text(
          `${manifest.displayName} did not check these claims: ${event.claims[0]?.evidence ?? "unknown"}`,
          { ran: false, claims: event.claims },
        );
      }

      const lines = event.claims.map(
        (claim) =>
          `${{ confirmed: "✓", refuted: "✗", unclear: "?" }[claim.verdict]} ${claim.claim}\n    ${claim.evidence}`,
      );
      const verdict =
        refuted.length > 0
          ? `\n${String(refuted.length)} refuted. Fix these before saying the work is done.`
          : event.claims.some((claim) => claim.verdict === "unclear")
            ? "\nNothing refuted, but some claims could not be checked — that is not the same as fine."
            : "\nAll confirmed.";

      return text(`${manifest.displayName} read your changes cold:\n\n${lines.join("\n")}\n${verdict}`, {
        ran: true,
        refuted: refuted.length,
        claims: event.claims,
      });
    },
  );

  return server;
}

/** The daemon's seat runner takes a working directory and a deadline; the injected test executor takes neither. */
function seatExecute(execute: NonNullable<FanoutMcpOptions["execute"]>) {
  return (binary: string, args: readonly string[]) => execute(binary, args);
}

/** Every tool answers twice: words for whoever is reading, and data for whatever is next. */
function text(message: string, data: unknown) {
  return {
    content: [{ type: "text" as const, text: message }],
    structuredContent: data as Record<string, unknown>,
  };
}

async function gate(options: FanoutMcpOptions, plan: PlanGraph, maxParallel: number) {
  const seats = await detectSeats({
    manifests: options.manifests,
    ...(options.execute === undefined ? {} : { execute: options.execute }),
  });
  const head = (await git(["rev-parse", "HEAD"], { cwd: options.repoRoot })).trim();
  const commands = Object.fromEntries(
    plan.lines.flatMap((line) => {
      const adapter = options.adapters.get(line.seat.id);
      if (adapter === undefined) return [];
      return [
        [
          line.id,
          adapter.command({
            missionId: "preview",
            runId: `${line.id}-1`,
            line,
            workdir: join(options.paths.workspaces, "preview", line.id),
            reportPath: join(options.paths.runs, "preview", line.id, "report.md"),
            baseEnv: {},
          }),
        ],
      ];
    }),
  );

  return safetyReport(
    {
      plan,
      planRevision: 1,
      repo: { root: options.repoRoot, baseCommit: head },
      seats: Object.fromEntries(seats.map((seat) => [seat.id, seat])),
      commands,
      denyList: [],
      limits: { maxParallel, perSeat: {} },
    },
    createSafetyDependencies({ repoRoot: options.repoRoot }),
  );
}

async function repoOverview(repoRoot: string) {
  const head = (await git(["rev-parse", "HEAD"], { cwd: repoRoot })).trim();
  const dirty = splitLines(await git(["status", "--porcelain"], { cwd: repoRoot })).map((entry) =>
    entry.slice(3),
  );
  const files = zeroSeparated(await git(["ls-files", "-z"], { cwd: repoRoot }));

  const counts = new Map<string, number>();
  for (const file of files) {
    const area = file.includes("/") ? `${file.slice(0, file.indexOf("/"))}/` : "(root)";
    counts.set(area, (counts.get(area) ?? 0) + 1);
  }
  const areas = [...counts.entries()]
    .map(([path, count]) => ({ path, files: count }))
    .sort((a, b) => b.files - a.files)
    .slice(0, 12);

  return { head, dirty, files: files.length, areas, checks: projectChecks(repoRoot) };
}

/** The commands this project runs to know it is well, read from where they are declared. */
function projectChecks(repoRoot: string): string[] {
  const manifest = join(repoRoot, "package.json");
  if (!existsSync(manifest)) return [];
  try {
    const parsed = JSON.parse(readFileSync(manifest, "utf8")) as { scripts?: Record<string, string> };
    return Object.keys(parsed.scripts ?? {})
      .filter((name) => ["check", "test", "lint", "typecheck", "build"].includes(name))
      .map((name) => `npm run ${name}`);
  } catch {
    return [];
  }
}

function missionIdFor(goal: string): string {
  const slug = goal
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${slug === "" ? "mission" : slug}-${randomBytes(2).toString("hex")}`;
}
