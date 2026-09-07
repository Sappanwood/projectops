import type { Plan } from "../plan/plan.js";
import {
  planItemProject,
  planMappingReference,
  planMaterializationState,
} from "../plan/planIdentity.js";
import { ExecutionError } from "../execution/store.js";

export function requireSingleProjectRun(owner: string, plan: Plan): void {
  if (planMaterializationState(plan) !== "complete")
    throw new ExecutionError(
      "EXECUTION_CONFLICT",
      "Automatic runs require complete materialization; recover partial materialization first.",
    );
  if (
    plan.items.some((item) => planItemProject(owner, item) !== owner) ||
    Object.values(plan.materialization!.mapping).some(
      (value) => planMappingReference(owner, value)?.project !== owner,
    )
  )
    throw new ExecutionError(
      "EXECUTION_CONFLICT",
      "Cross-project Plans cannot use automatic runs. Execute individual tasks in their own projects.",
    );
}
