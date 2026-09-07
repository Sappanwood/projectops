import type { Plan } from "../plan/plan.js";
import { planMappingReference, planMaterializationState } from "../plan/planIdentity.js";
import { freezeDependency, type DependencyEvidence } from "./dependencyReadiness.js";
import { ExecutionError } from "../execution/store.js";

export function planCompletionEvidence(
  workspaceDir: string,
  owner: string,
  plan: Plan,
): DependencyEvidence[] {
  if (planMaterializationState(plan) !== "complete")
    throw new ExecutionError(
      "EXECUTION_CONFLICT",
      "Complete materialization is required; recover partial materialization first.",
    );
  return plan.items
    .filter((item) => item.item_type === "task")
    .map((item) => {
      const reference = planMappingReference(owner, plan.materialization!.mapping[item.key]!);
      if (!reference)
        throw new ExecutionError("EXECUTION_INVALID", `Missing mapping for ${item.key}.`);
      return freezeDependency(workspaceDir, reference);
    });
}
