import { z } from "zod";
import { LineId, SeatRef } from "./common.ts";
import { ScopeGlob, scopesMayOverlap } from "./scope.ts";

export const LineRole = z.enum(["auditor", "builder", "tester"]);
export type LineRole = z.infer<typeof LineRole>;

/** One task in a mission. Auditors are read-only; builders and testers declare where they may write. */
export const PlanLine = z.strictObject({
  id: LineId,
  title: z.string().trim().min(1).max(120),
  role: LineRole,
  prompt: z.string().min(1).max(100_000),
  seat: SeatRef,
  scope: z.strictObject({ write: z.array(ScopeGlob).max(64) }),
  dependsOn: z.array(LineId).max(32).default([]),
  checks: z.array(z.string().min(1).max(500)).max(16).default([]),
  timeoutMinutes: z.int().min(1).max(240).optional(),
  /**
   * This line fixes a bug, so the gate will not merge it without a test proven to fail on the old code.
   *
   * Declared when the mission is planned rather than judged afterwards, because the moment to decide whether
   * something is a fix is before an agent has written a persuasive explanation of why its change is fine.
   */
  fixesBug: z.boolean().default(false),
});
export type PlanLine = z.infer<typeof PlanLine>;

export const PlanGraph = z.strictObject({
  lines: z.array(PlanLine).min(1).max(32),
});
export type PlanGraph = z.infer<typeof PlanGraph>;

export type PlanIssueCode =
  | "duplicate_line"
  | "unknown_dependency"
  | "self_dependency"
  | "dependency_cycle"
  | "auditor_writes"
  | "missing_write_scope"
  | "scope_overlap";

export interface PlanIssue {
  code: PlanIssueCode;
  message: string;
  lineIds: string[];
}

/**
 * Checks the rules a schema can't express: the dependency graph and the write scopes of lines that may run at the
 * same time. Returns every issue found, in a stable order; an empty list means the plan is launchable.
 */
export function validatePlan(plan: PlanGraph): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const { lines } = plan;

  const indexById = new Map<string, number>();
  lines.forEach((line, index) => {
    if (indexById.has(line.id)) {
      issues.push({
        code: "duplicate_line",
        message: `Line id "${line.id}" is used more than once.`,
        lineIds: [line.id],
      });
    } else {
      indexById.set(line.id, index);
    }
  });

  const edges: number[][] = lines.map((line) => {
    const targets: number[] = [];
    for (const dependency of line.dependsOn) {
      if (dependency === line.id) {
        issues.push({
          code: "self_dependency",
          message: `Line "${line.id}" depends on itself.`,
          lineIds: [line.id],
        });
        continue;
      }
      const target = indexById.get(dependency);
      if (target === undefined) {
        issues.push({
          code: "unknown_dependency",
          message: `Line "${line.id}" depends on "${dependency}", which is not in the plan.`,
          lineIds: [line.id],
        });
      } else {
        targets.push(target);
      }
    }
    return targets;
  });

  for (const cycle of findCycles(edges)) {
    const ids = cycle.map((index) => lines[index]?.id ?? "?");
    issues.push({
      code: "dependency_cycle",
      message: `Dependencies form a cycle: ${[...ids, ids[0]].join(" → ")}.`,
      lineIds: ids,
    });
  }

  for (const line of lines) {
    if (line.role === "auditor" && line.scope.write.length > 0) {
      issues.push({
        code: "auditor_writes",
        message: `Line "${line.id}" is an auditor, so it is read-only; remove its write scope or make it a builder.`,
        lineIds: [line.id],
      });
    }
    if (line.role !== "auditor" && line.scope.write.length === 0) {
      issues.push({
        code: "missing_write_scope",
        message: `Line "${line.id}" is a ${line.role} but declares no write scope.`,
        lineIds: [line.id],
      });
    }
  }

  const reaches = reachability(edges);
  for (let i = 0; i < lines.length; i += 1) {
    for (let j = i + 1; j < lines.length; j += 1) {
      const a = lines[i];
      const b = lines[j];
      if (a === undefined || b === undefined) continue;
      if (reaches[i]?.has(j) === true || reaches[j]?.has(i) === true) continue;
      const clash = firstOverlap(a.scope.write, b.scope.write);
      if (clash !== undefined) {
        issues.push({
          code: "scope_overlap",
          message:
            `Lines "${a.id}" and "${b.id}" can run at the same time and may both write ` +
            `"${clash[0]}" / "${clash[1]}". Make one depend on the other, or narrow the scopes.`,
          lineIds: [a.id, b.id],
        });
      }
    }
  }

  return issues;
}

function firstOverlap(left: string[], right: string[]): [string, string] | undefined {
  for (const a of left) {
    for (const b of right) {
      if (scopesMayOverlap(a, b)) return [a, b];
    }
  }
  return undefined;
}

/** For each node, every node it can reach by following edges (its transitive dependencies). */
function reachability(edges: number[][]): Set<number>[] {
  return edges.map((_, start) => {
    const seen = new Set<number>();
    const stack = [...(edges[start] ?? [])];
    for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
      if (seen.has(next)) continue;
      seen.add(next);
      stack.push(...(edges[next] ?? []));
    }
    return seen;
  });
}

/** One cycle per back edge found by a depth-first search, each listed from its first node in plan order. */
function findCycles(edges: number[][]): number[][] {
  const state = new Array<"new" | "open" | "done">(edges.length).fill("new");
  const path: number[] = [];
  const cycles: number[][] = [];

  const visit = (node: number): void => {
    state[node] = "open";
    path.push(node);
    for (const next of edges[node] ?? []) {
      if (state[next] === "open") {
        cycles.push(path.slice(path.indexOf(next)));
      } else if (state[next] === "new") {
        visit(next);
      }
    }
    path.pop();
    state[node] = "done";
  };

  edges.forEach((_, node) => {
    if (state[node] === "new") visit(node);
  });
  return cycles;
}
