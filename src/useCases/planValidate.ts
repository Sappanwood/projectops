// Application use case: validate a stored plan artifact.

import type { CliIO } from "../io.js";
import { isPlanId } from "../plan/plan.js";
import { PlanNotFoundError, PlanParseError, readPlan } from "../plan/planFs.js";
import { resolvePlansRoot } from "./planContext.js";

export function planValidate(
  projectId: string | undefined,
  planId: string | undefined,
  json: boolean,
  io: CliIO,
  cwd: string,
): number {
  if (projectId === undefined || planId === undefined) {
    io.stderr("Usage: pops plan validate <project-id> <plan-id> [--json]");
    return 1;
  }
  const root = resolvePlansRoot(projectId, io, cwd);
  if (root === null) return 1;
  if (!isPlanId(planId)) {
    io.stderr(`Error: invalid plan id: ${planId}`);
    return 1;
  }

  let plan;
  try {
    plan = readPlan(root, planId);
  } catch (error) {
    if (error instanceof PlanNotFoundError || error instanceof PlanParseError) {
      io.stderr(`Error: ${error.message}`);
      return 1;
    }
    throw error;
  }
  if (plan.id !== planId) {
    io.stderr(`Error: plan id mismatch: expected ${planId}, got ${plan.id}`);
    return 1;
  }

  if (json) {
    io.stdout(JSON.stringify({ ok: true, plan }));
  } else {
    io.stdout(`Valid ${plan.id}`);
  }
  return 0;
}
