// Application use case: approve a validated plan with an explicit review note.

import { realpathSync } from "node:fs";
import { parseArgs } from "node:util";

import { isWithinWorkspace } from "../catalog/workspace.js";
import type { CliIO } from "../io.js";
import { isPlanId, type Plan } from "../plan/plan.js";
import { PlanNotFoundError, PlanParseError, planPath, readPlan, updatePlan } from "../plan/planFs.js";
import { resolvePlansRoot } from "./planContext.js";

type ApproveOptions = {
  "review-note"?: string;
};

export function planApprove(
  projectId: string | undefined,
  planId: string | undefined,
  args: string[],
  json: boolean,
  io: CliIO,
  cwd: string,
): number {
  if (projectId === undefined || planId === undefined) {
    io.stderr("Usage: pops plan approve <project-id> <plan-id> --review-note <note> [--json]");
    return 1;
  }
  const root = resolvePlansRoot(projectId, io, cwd, true);
  if (root === null) return 1;
  if (!isPlanId(planId)) {
    io.stderr(`Error: invalid plan id: ${planId}`);
    return 1;
  }

  let values: ApproveOptions;
  try {
    values = parseArgs({
      args,
      options: { "review-note": { type: "string" } },
      allowPositionals: false,
      strict: true,
    }).values as ApproveOptions;
  } catch {
    io.stderr("Error: invalid arguments");
    return 1;
  }
  const reviewNote = values["review-note"]?.trim();
  if (reviewNote === undefined || reviewNote === "") {
    io.stderr("Error: --review-note must be a non-empty string");
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
  if (plan.status === "approved") {
    io.stderr(`Error: plan already approved: ${planId}`);
    return 1;
  }

  const approved: Plan = {
    ...plan,
    status: "approved",
    approval: {
      approved_at: new Date().toISOString(),
      review_note: reviewNote,
    },
  };
  const targetProblem = planTargetProblem(root, planId);
  if (targetProblem !== null) {
    io.stderr(`Error: ${targetProblem}`);
    return 1;
  }
  updatePlan(root, approved);

  if (json) {
    io.stdout(JSON.stringify({ ok: true, plan: approved }));
  } else {
    io.stdout(`Approved ${approved.id}`);
  }
  return 0;
}

function planTargetProblem(root: string, planId: string): string | null {
  try {
    const canonicalRoot = realpathSync(root);
    const canonicalPlan = realpathSync(planPath(root, planId));
    if (!isWithinWorkspace(canonicalRoot, canonicalPlan)) {
      return "plan target resolves outside the plans root";
    }
  } catch {
    return "plan target cannot be resolved";
  }
  return null;
}
