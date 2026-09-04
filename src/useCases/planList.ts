// Application use case: list plan summaries.

import type { CliIO } from "../io.js";
import { listPlanIds, readPlan } from "../plan/planFs.js";
import { resolvePlansRoot } from "./planContext.js";

export function planList(projectId: string | undefined, json: boolean, io: CliIO, cwd: string): number {
  if (projectId === undefined) {
    io.stderr("Usage: pops plan list <project-id> [--json]");
    return 1;
  }
  const root = resolvePlansRoot(projectId, io, cwd);
  if (root === null) return 1;
  const plans = listPlanIds(root).map((id) => readPlan(root, id));

  if (json) {
    io.stdout(JSON.stringify({
      ok: true,
      plans: plans.map((plan) => ({ id: plan.id, title: plan.title, goal: plan.goal, item_count: plan.items.length })),
    }));
  } else if (plans.length === 0) {
    io.stdout("No plans");
  } else {
    for (const plan of plans) io.stdout(`${plan.id}  ${plan.title}`);
  }
  return 0;
}
