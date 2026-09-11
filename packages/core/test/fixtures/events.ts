import type { EventType, FanoutEventInput, PlanGraph } from "../../src/index.ts";

export const SHA = "0123456789abcdef0123456789abcdef01234567";

export const samplePlan: PlanGraph = {
  lines: [
    {
      id: "map-export",
      title: "Map the export code",
      role: "auditor",
      prompt: "Map every place that builds or serves exports.",
      seat: { id: "codex", effort: "high" },
      scope: { write: [] },
      dependsOn: [],
      checks: [],
    },
    {
      id: "api-export",
      title: "CSV export endpoint",
      role: "builder",
      prompt: "Add GET /export.csv.",
      seat: { id: "codex" },
      scope: { write: ["src/api/export/**"] },
      dependsOn: ["map-export"],
      checks: ["pnpm test"],
    },
  ],
};

type Samples = { [T in EventType]: Extract<FanoutEventInput, { type: T }> };

/** One valid example of every event type. The type makes a missing sample a compile error. */
export const samples: Samples = {
  "seat.detected": {
    type: "seat.detected",
    seat: {
      id: "codex",
      displayName: "OpenAI Codex",
      binary: "codex",
      version: "0.154.0",
      supported: true,
      signedIn: "yes",
      models: [],
      efforts: ["low", "medium", "high"],
      billing: "subscription",
    },
  },
  "mission.created": {
    type: "mission.created",
    missionId: "csv-export",
    goal: "Add CSV export",
    repo: { root: "/work/app", baseCommit: SHA },
    limits: { maxParallel: 4, timeoutMinutes: 60 },
  },
  "plan.proposed": { type: "plan.proposed", missionId: "csv-export", plan: samplePlan, by: "lead" },
  "plan.revised": {
    type: "plan.revised",
    missionId: "csv-export",
    plan: samplePlan,
    by: "user",
    note: "Use Kimi for the tests",
  },
  "safety.report": {
    type: "safety.report",
    missionId: "csv-export",
    planRevision: 1,
    ok: true,
    checks: [{ id: "scopes-disjoint", ok: true, severity: "block", message: "Write scopes don't overlap." }],
  },
  "run.queued": {
    type: "run.queued",
    missionId: "csv-export",
    runId: "api-export-1",
    lineId: "api-export",
    seat: { id: "codex" },
    attempt: 1,
  },
  "run.started": {
    type: "run.started",
    missionId: "csv-export",
    runId: "api-export-1",
    workdir: "/tmp/fanout/api-export-1",
    argv: ["codex", "exec", "--json", "Add GET /export.csv."],
  },
  "run.progress": { type: "run.progress", missionId: "csv-export", runId: "api-export-1", phase: "coding" },
  "run.tool": {
    type: "run.tool",
    missionId: "csv-export",
    runId: "api-export-1",
    tool: "edit",
    files: ["src/api/export/route.ts"],
  },
  "run.usage": {
    type: "run.usage",
    missionId: "csv-export",
    runId: "api-export-1",
    seat: "codex",
    amount: 3,
    unit: "messages",
    estimated: true,
  },
  "run.finished": {
    type: "run.finished",
    missionId: "csv-export",
    runId: "api-export-1",
    status: "done",
    exitCode: 0,
    diffStat: { files: 2, insertions: 84, deletions: 3 },
  },
  "review.done": {
    type: "review.done",
    missionId: "csv-export",
    runId: "api-export-1",
    verdict: "accept",
    notes: "Escapes quotes; streams rows.",
    by: { id: "claude" },
  },
  "checks.done": {
    type: "checks.done",
    missionId: "csv-export",
    runId: "api-export-1",
    ok: true,
    summary: "12 tests pass",
  },
  "proof.done": {
    type: "proof.done",
    missionId: "csv-export",
    runId: "api-export-1",
    ok: true,
    failedOnOld: ["export > escapes quotes"],
  },
  "merge.applied": {
    type: "merge.applied",
    missionId: "csv-export",
    runId: "api-export-1",
    files: ["src/api/export/route.ts"],
  },
  "merge.conflict": {
    type: "merge.conflict",
    missionId: "csv-export",
    runId: "api-export-1",
    files: ["src/api/index.ts"],
  },
  "run.dropped": {
    type: "run.dropped",
    missionId: "csv-export",
    runId: "api-export-1",
    reason: "Rejected twice in review",
  },
  "route.changed": {
    type: "route.changed",
    missionId: "csv-export",
    lineId: "api-export",
    from: { id: "codex" },
    to: { id: "kimi" },
    reason: "Codex hit its 5-hour limit",
  },
  "policy.breach": {
    type: "policy.breach",
    missionId: "csv-export",
    runId: "api-export-1",
    limit: "timeoutMinutes",
    action: "killed",
  },
  "mission.finished": {
    type: "mission.finished",
    missionId: "csv-export",
    outcome: "completed",
    summary: "1 merged",
  },
};
