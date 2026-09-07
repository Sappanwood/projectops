import { planMaterializationState } from "../plan/planIdentity.js";
import { planCompletionEvidence } from "./planCompletionEvidence.js";
import { readPlanPrerequisites } from "./dependencyReadiness.js";
import { computePlanRevision, loadPlanContext } from "./planRevision.js";
import { readPlanExecution } from "./planExecution.js";
import { updatePlan } from "../plan/planFs.js";
import type { Plan } from "../plan/plan.js";
import { applicationFailure, applicationSuccess, type ApplicationResult } from "./result.js";
import { listPlanRuns, validatePlanRunCompletion } from "./planRunApi.js";
import { listParallelRuns, validateParallelRunCompletion } from "./parallelRunApi.js";

export function completePlan(request: {
  workspaceDir: string;
  projectId: string;
  planId: string;
  expectedRevision: string;
}): ApplicationResult<{ plan: Plan; revision: string; no_op: boolean }> {
  const loaded = loadPlanContext(request);
  if (!loaded.ok) return loaded;
  const { plan, plans } = loaded.data;
  const revision = computePlanRevision(plan);
  if (request.expectedRevision !== revision)
    return applicationFailure(
      "REVISION_MISMATCH",
      "Plan revision changed. Reload before marking it complete.",
    );
  if (planMaterializationState(plan) !== "complete")
    return applicationFailure(
      "PLAN_INVALID",
      "Complete materialization is required; recover partial materialization first.",
    );
  const prerequisites = readPlanPrerequisites(request, plan);
  if (prerequisites.diagnostics.length)
    return applicationFailure(
      "PLAN_INVALID",
      prerequisites.diagnostics.map((d) => d.message).join(" "),
    );

  if (!["approved", "done"].includes(plan.status) || !plan.materialization)
    return applicationFailure(
      "PLAN_INVALID",
      "Completion requires an approved, materialized Plan.",
    );
  const execution = readPlanExecution(request, plan);
  if (
    !execution.counts.total ||
    execution.counts.done !== execution.counts.total ||
    execution.items.some((item) => item.status === "unreadable")
  ) {
    return applicationFailure(
      "PLAN_INVALID",
      "Plan must contain at least one task, all mapped items must be readable, and every task must be done.",
    );
  }
  try {
    planCompletionEvidence(request.workspaceDir, request.projectId, plan);
  } catch (error) {
    return applicationFailure(
      "PLAN_INVALID",
      error instanceof Error ? error.message : "Task evidence unavailable.",
    );
  }
  if (plan.status === "done") return applicationSuccess({ plan, revision, no_op: true });
  const runs = listPlanRuns(request);
  if (!runs.ok) return runs;
  const latest = runs.data.runs[0];
  if (latest) {
    const result = validatePlanRunCompletion({ ...request, runId: latest.id }, "recorded");
    if (!result.ok) return result;
  }
  const parallel = listParallelRuns(request);
  if (!parallel.ok) return parallel;
  const latestParallel = parallel.data.runs.toSorted((a, b) =>
    b.created_at.localeCompare(a.created_at),
  )[0];
  if (latestParallel) {
    const result = validateParallelRunCompletion({ ...request, runId: latestParallel.id });
    if (!result.ok) return result;
  }
  const completed: Plan = { ...plan, status: "done" };
  try {
    updatePlan(plans, completed);
  } catch {
    return applicationFailure(
      "PLAN_INVALID",
      "Could not save the completed Plan. Reload and check the file before retrying.",
    );
  }
  return applicationSuccess({
    plan: completed,
    revision: computePlanRevision(completed),
    no_op: false,
  });
}
