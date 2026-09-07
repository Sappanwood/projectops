import { formatPlanSource, planMappingReference } from "../plan/planIdentity.js";
import {
  materializedDependencies,
  validatePlanDependencies,
  validatePlanTargets,
} from "./planDependencies.js";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import path from "node:path";
import { isWithinWorkspace, projectArtifactRoots } from "../catalog/workspace.js";
import { loadWorkspace } from "../catalog/workspaceStore.js";
import { parsePlanDraft, PLAN_SCHEMA, type Plan } from "../plan/plan.js";
import { readPlan, planPath, updatePlan, PlanNotFoundError } from "../plan/planFs.js";
import { computeRevision, type BacklogItem } from "../backlog/item.js";
import { updateItemFile, rebuildIndex } from "../backlog/itemFs.js";
import { resolveBacklogContext, showBacklogItem } from "./backlogApi.js";
import { applicationFailure, applicationSuccess, type ApplicationResult } from "./result.js";

import { listExecutions } from "./executionApi.js";

type PlanRequest = { workspaceDir: string; projectId: string; planId: string };
export type PlanRevisionRequest = PlanRequest & {
  draft: unknown;
  expectedRevision: string;
  confirm?: string;
};
export type PlanRevisionReceipt = {
  plan: Plan;
  revision: string;
  applied: boolean;
  confirmation_token: string;
  changes: { key: string; fields: string[]; item_id?: string }[];
  affected_items: { id: string; project: string; revision: string }[];
};
export function computePlanRevision(plan: Plan): string {
  return digest(plan);
}
export function computePlanExecutionRevision(plan: Plan): string {
  return computePlanRevision({
    ...plan,
    status: plan.status === "done" ? "approved" : plan.status,
  });
}
function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function loadPlanContext(
  request: PlanRequest,
): ApplicationResult<{ plans: string; backlog: string; plan: Plan }> {
  try {
    const workspace = loadWorkspace(request.workspaceDir);
    if (!Object.hasOwn(workspace.manifest.projects, request.projectId))
      return applicationFailure("PROJECT_NOT_FOUND", "Project is not registered.");
    if (workspace.manifest.artifact_layout.roots.plans !== PLAN_SCHEMA)
      return applicationFailure("PLAN_INVALID", "Invalid plan artifact type.");
    const roots = projectArtifactRoots(
      workspace.root,
      request.projectId,
      workspace.manifest.artifact_layout,
    );
    const plan = readPlan(roots.plans, request.planId);
    if (plan.id !== request.planId)
      return applicationFailure("PLAN_INVALID", "Plan ID does not match its file.");
    if (
      !isWithinWorkspace(realpathSync(workspace.root), realpathSync(roots.plans)) ||
      !isWithinWorkspace(realpathSync(roots.plans), realpathSync(planPath(roots.plans, plan.id)))
    )
      return applicationFailure(
        "PLAN_INVALID",
        "Plan target resolves outside the declared workspace.",
      );
    return applicationSuccess({ ...roots, plan });
  } catch (error) {
    return error instanceof PlanNotFoundError
      ? applicationFailure("PLAN_NOT_FOUND", "Plan was not found.")
      : applicationFailure("PLAN_INVALID", "Plan or workspace is invalid or unreadable.");
  }
}
export function showPlanRevision(
  request: PlanRequest,
): ApplicationResult<{ plan: Plan; revision: string }> {
  const loaded = loadPlanContext(request);
  if (!loaded.ok) return loaded;
  return applicationSuccess({
    plan: loaded.data.plan,
    revision: computePlanRevision(loaded.data.plan),
  });
}
export function revisePlan(request: PlanRevisionRequest): ApplicationResult<PlanRevisionReceipt> {
  const loaded = loadPlanContext(request);
  if (!loaded.ok) return loaded;
  const { plan: before, plans } = loaded.data;
  if (before.status === "done")
    return applicationFailure(
      "PLAN_INVALID",
      "Completed plans cannot be revised. Create a follow-up plan.",
    );
  if (before.materialization?.state === "partial")
    return applicationFailure(
      "PLAN_INVALID",
      "Partial materialization must be recovered before revision.",
    );
  const revision = computePlanRevision(before);
  if (request.expectedRevision !== revision)
    return applicationFailure(
      "REVISION_MISMATCH",
      `Plan revision mismatch: current ${revision}. Reload and preview again.`,
    );
  const draft = parsePlanDraft(request.draft);
  if (typeof draft === "string") return applicationFailure("PLAN_INVALID", draft);
  const plan: Plan = { ...before, ...draft };
  const targets = validatePlanTargets(request.workspaceDir, request.projectId, plan);
  if (!targets.ok) return targets;
  if (draft.execution_policy === undefined) delete plan.execution_policy;
  const changes: PlanRevisionReceipt["changes"] = [];
  const pending: BacklogItem[] = [];
  const affected: BacklogItem[] = [];
  if (JSON.stringify(before.execution_policy) !== JSON.stringify(plan.execution_policy))
    changes.push({ key: "$plan", fields: ["execution_policy"] });
  if (before.title !== plan.title || before.goal !== plan.goal)
    changes.push({
      key: "$plan",
      fields: ["title", "goal"].filter(
        (key) => before[key as "title" | "goal"] !== plan[key as "title" | "goal"],
      ),
    });
  if (
    JSON.stringify(before.items.map((item) => item.key)) !==
    JSON.stringify(plan.items.map((item) => item.key))
  )
    changes.push({ key: "$plan", fields: ["item_order"] });
  const mapping = before.materialization?.mapping;
  if (
    mapping &&
    (before.items.length !== draft.items.length ||
      draft.items.some((item) => !Object.hasOwn(mapping, item.key)))
  )
    return applicationFailure(
      "PLAN_INVALID",
      "UNSUPPORTED_PLAN_CHANGE: Materialized plans cannot add, remove, or rename keys. Create a separate follow-up plan; existing mapping is preserved.",
    );
  for (const key of new Set([
    ...before.items.map((i) => i.key),
    ...draft.items.map((i) => i.key),
  ])) {
    const old = before.items.find((i) => i.key === key);
    const next = draft.items.find((i) => i.key === key);
    const fields =
      old && next
        ? [
            "project",
            "title",
            "body",
            "priority",
            "item_type",
            "parent",
            "depends_on",
            "parallel",
            "resources",
          ].filter(
            (field) =>
              JSON.stringify(old[field as keyof typeof old]) !==
              JSON.stringify(next[field as keyof typeof next]),
          )
        : [old ? "removed" : "added"];
    if (!fields.length) continue;
    const id = mapping?.[key];
    changes.push({ key, fields, ...(id ? { item_id: id } : {}) });
    if (!id || !next || !old) continue;
    if (fields.includes("item_type") || fields.includes("parent"))
      return applicationFailure(
        "PLAN_INVALID",
        `UNSUPPORTED_PLAN_CHANGE: ${key} type/parent changes require a separate follow-up plan.`,
      );
    const reference = planMappingReference(request.projectId, id)!;
    const targetRequest = { ...request, projectId: reference.project, itemId: reference.item };
    const context = resolveBacklogContext(request.workspaceDir, reference.project);
    if (!context.ok) return context;
    const backlog = context.data.root;
    const found = showBacklogItem(targetRequest);
    if (!found.ok) return found;
    const item = found.data.item;
    const executions = listExecutions(targetRequest);
    if (!executions.ok) return executions;
    if (executions.data.attempts.length)
      return applicationFailure(
        "PLAN_INVALID",
        `TASK_PROTECTED: ${id} has execution history. Keep its plan input unchanged and create follow-up work.`,
      );
    if (item.status !== "todo")
      return applicationFailure(
        "PLAN_INVALID",
        `TASK_PROTECTED: ${id} is ${item.status}. Keep its plan input unchanged and create follow-up work.`,
      );
    if (
      item.source !==
        formatPlanSource(
          { project: request.projectId, planId: before.id, key },
          reference.project,
        ) ||
      item.title !== old.title ||
      item.body.trimEnd() !== old.body.trimEnd() ||
      item.priority !== old.priority ||
      JSON.stringify(item.depends_on) !==
        JSON.stringify(
          materializedDependencies(old.depends_on, mapping!, request.projectId, reference.project),
        )
    )
      return applicationFailure(
        "PLAN_INVALID",
        `TASK_DIVERGED: ${id} was edited independently. Reconcile its content before revising this plan.`,
      );
    try {
      if (
        !isWithinWorkspace(
          realpathSync(loadWorkspace(request.workspaceDir).root),
          realpathSync(backlog),
        ) ||
        !isWithinWorkspace(
          realpathSync(backlog),
          realpathSync(path.join(backlog, "items", `${reference.item}.md`)),
        ) ||
        !isWithinWorkspace(realpathSync(backlog), realpathSync(path.join(backlog, "INDEX.md")))
      )
        return applicationFailure("PLAN_INVALID", "Backlog targets resolve outside their store.");
    } catch {
      return applicationFailure("PLAN_INVALID", "Backlog targets cannot be resolved.");
    }
    affected.push(item);
    const updated = {
      ...item,
      title: next.title,
      body: next.body,
      priority: next.priority,
      depends_on: materializedDependencies(
        next.depends_on,
        mapping!,
        request.projectId,
        reference.project,
      ),
      updated: new Date().toISOString().slice(0, 10),
    };
    updated.revision = computeRevision(updated);
    pending.push(updated);
  }
  if (changes.length) {
    const dependencies = validatePlanDependencies(
      request.workspaceDir,
      request.projectId,
      plan,
      mapping ? pending : undefined,
    );
    if (!dependencies.ok) return dependencies;
  }
  const affected_items = affected.map((item) => ({
    id: item.id,
    project: item.project,
    revision: item.revision,
  }));
  const confirmation_token = digest({ revision, draft, affected_items });
  if (request.confirm !== undefined && request.confirm !== confirmation_token)
    return applicationFailure(
      "REVISION_MISMATCH",
      "Preview changed. Preview again before confirming.",
    );
  if (request.confirm !== undefined && changes.length) {
    if (before.status === "approved")
      plan.approval = {
        approved_at: new Date().toISOString(),
        review_note: `Explicitly confirmed revision ${confirmation_token}`,
      };
    const applied: string[] = [];
    const indexed: string[] = [];
    try {
      const stores = new Set<string>();
      for (const item of pending) {
        const context = resolveBacklogContext(request.workspaceDir, item.project);
        if (!context.ok) throw new Error(context.error.message);
        updateItemFile(context.data.root, item);
        applied.push(`${item.project}:${item.id}`);
        stores.add(context.data.root);
      }
      for (const root of stores) {
        rebuildIndex(root);
        indexed.push(root);
      }
      updatePlan(plans, plan);
    } catch {
      return applicationFailure(
        "PLAN_INVALID",
        `Revision write failed. Applied task files: ${applied.join(", ") || "none"}; rebuilt indexes: ${indexed.length}; Plan write not confirmed (it may already have been saved). Reload the Plan and affected tasks. If the Plan still has its old draft, explicitly restore the applied task fields to that draft using current item revisions, then preview and confirm again. If the Plan already has the requested draft, verify task contents and indexes before further edits. No rollback was attempted.`,
      );
    }
  }
  return applicationSuccess({
    plan,
    revision: request.confirm === undefined ? revision : computePlanRevision(plan),
    applied: request.confirm !== undefined,
    confirmation_token,
    changes,
    affected_items,
  });
}
