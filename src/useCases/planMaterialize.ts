import { validateBacklogDependencies } from "../application/backlogDependencies.js";
import {
  materializedDependencies,
  validatePlanDependencies,
} from "../application/planDependencies.js";
// Application use case: materialize an approved plan into the project's backlog.

import { realpathSync } from "node:fs";
import path from "node:path";

import { addBacklogItem, BacklogAddError } from "../backlog/add.js";
import { listItemIds, readItemFile, rebuildIndex } from "../backlog/itemFs.js";
import {
  formatPlanSource,
  planItemProject,
  planMappingReference,
  planMaterializationState,
} from "../plan/planIdentity.js";
import { recoverMaterializedItem } from "../plan/materializationRecovery.js";
import { INDEX_FILE, ITEMS_DIR } from "../backlog/store.js";
import { materializationOrder, type Plan } from "../plan/plan.js";
import { computePlanRevision } from "../application/planRevision.js";
import {
  PlanNotFoundError,
  PlanParseError,
  planPath,
  readPlan,
  updatePlan,
} from "../plan/planFs.js";
import { isWithinWorkspace } from "../catalog/workspace.js";
import type { CliIO } from "../io.js";
import { resolveStoreRoot } from "./backlogContext.js";
import { resolvePlansRoot } from "./planContext.js";

type MaterializationReceipt = {
  ok: boolean;
  state: "partial" | "complete";
  no_op: boolean;
  plan_id: string;
  mapping: Record<string, string>;
  items: { key: string; project: string; id: string; disposition: "created" | "reused" }[];
  diagnostic?: string;
};

export function planMaterialize(
  projectId: string | undefined,
  planId: string | undefined,
  json: boolean,
  io: CliIO,
  cwd: string,
): number {
  if (projectId === undefined || planId === undefined) {
    io.stderr("Usage: pops plan materialize <project-id> <plan-id> [--json]");
    return 1;
  }
  const plansRoot = resolvePlansRoot(projectId, io, cwd, true);
  if (plansRoot === null) return 1;

  let plan: Plan;
  try {
    plan = readPlan(plansRoot, planId);
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
  if (plan.status !== "approved" && plan.status !== "done") {
    io.stderr(`Error: plan must be approved before materialization: ${planId}`);
    return 1;
  }

  const targetProblem = planTargetProblem(plansRoot, planId);
  if (targetProblem !== null) {
    io.stderr(`Error: ${targetProblem}`);
    return 1;
  }
  const stores = new Map<string, NonNullable<ReturnType<typeof resolveStoreRoot>>>();
  for (const project of new Set(plan.items.map((item) => planItemProject(projectId, item)))) {
    const store = resolveStoreRoot(project, io, cwd);
    if (store === null) return 1;
    const problem = materializationTargetProblem(store.workspaceRoot, store.root);
    if (problem !== null || store.manifest.project_id !== project) {
      io.stderr(`Error: ${project}: ${problem ?? "backlog project identity mismatch"}`);
      return 1;
    }
    stores.set(project, store);
  }

  if (planMaterializationState(plan) === "complete") {
    const receipt = buildReceipt(
      projectId,
      plan,
      plan.materialization!.mapping,
      new Set(),
      undefined,
      true,
    );
    if (json) io.stdout(JSON.stringify(receipt));
    else io.stdout(`No changes (${plan.id})`);
    return 0;
  }

  const dependencies = validatePlanDependencies(cwd, projectId, plan);
  if (!dependencies.ok) {
    io.stderr(`Error: ${dependencies.error.message}`);
    return 1;
  }

  const order = materializationOrder(plan.items);
  if (typeof order === "string") {
    io.stderr(`Error: ${order}`);
    return 1;
  }

  const mapping = { ...plan.materialization?.mapping };
  const created = new Set<string>();
  let expectedRevision = computePlanRevision(plan);
  const persist = (partial: boolean) => {
    if (computePlanRevision(readPlan(plansRoot, planId)) !== expectedRevision)
      throw new Error(
        "Plan revision changed; reload and reconcile materialization sources before retrying.",
      );
    const next: Plan = {
      ...plan,
      materialization: {
        materialized_at: plan.materialization?.materialized_at ?? new Date().toISOString(),
        mapping: { ...mapping },
        ...(partial ? { state: "partial" as const } : {}),
      },
    };
    updatePlan(plansRoot, next);
    plan = next;
    expectedRevision = computePlanRevision(next);
  };
  try {
    // Read all target items before writing so source conflicts cannot be ignored.
    const existing = new Map(
      [...stores].map(([project, store]) => [
        project,
        listItemIds(store.root).map((id) => readItemFile(store.root, id)),
      ]),
    );
    for (const item of order) {
      const project = planItemProject(projectId, item);
      const store = stores.get(project)!;
      const draft = {
        title: item.title,
        category: "feature" as const,
        priority: item.priority,
        item_type: item.item_type,
        parent_id:
          item.parent === undefined
            ? null
            : planMappingReference(projectId, mapping[item.parent]!)!.item,
        depends_on: materializedDependencies(item.depends_on, mapping, projectId, project),
        body: item.body,
        source: formatPlanSource({ project: projectId, planId: plan.id, key: item.key }, project),
      };
      const reused = recoverMaterializedItem(
        existing.get(project)!,
        draft,
        project,
        mapping[item.key] === undefined
          ? undefined
          : planMappingReference(projectId, mapping[item.key]!)!.item,
      );
      const record = (id: string) => {
        mapping[item.key] = project === projectId ? id : `${project}:${id}`;
        persist(true);
      };
      if (reused) {
        record(reused.id);
        rebuildIndex(store.root);
      } else {
        addBacklogItem(
          store.root,
          store.manifest,
          draft,
          (id, refs) => {
            const checked = validateBacklogDependencies(cwd, { project, item: id }, refs);
            if (!checked.ok) throw new BacklogAddError(checked.error.message);
          },
          (result) => {
            created.add(item.key);
            record(result.id);
          },
        );
      }
    }
    persist(false);
  } catch (error) {
    const diagnostic = `${error instanceof Error ? error.message : String(error)}. Known mapping is returned; retry verifies source and content before reusing items. If the Plan cannot be read, reconcile its source records before retrying.`;
    const receipt = buildReceipt(projectId, plan, mapping, created, diagnostic);
    if (json) io.stdout(JSON.stringify(receipt));
    io.stderr(`Error: ${diagnostic}`);
    return 1;
  }
  const receipt = buildReceipt(projectId, plan, mapping, created);
  if (json) io.stdout(JSON.stringify(receipt));
  else io.stdout(`Materialized ${plan.id}`);
  return 0;
}

function buildReceipt(
  owner: string,
  plan: Plan,
  mapping: Record<string, string>,
  created: Set<string>,
  diagnostic?: string,
  noOp = false,
): MaterializationReceipt {
  return {
    ok: diagnostic === undefined,
    state: diagnostic === undefined ? "complete" : "partial",
    no_op: noOp,
    plan_id: plan.id,
    mapping,
    items: plan.items
      .filter((item) => mapping[item.key] !== undefined)
      .map((item) => {
        const reference = planMappingReference(owner, mapping[item.key]!)!;
        return {
          key: item.key,
          project: reference.project,
          id: reference.item,
          disposition: created.has(item.key) ? "created" : "reused",
        };
      }),
    ...(diagnostic === undefined ? {} : { diagnostic }),
  };
}

function materializationTargetProblem(workspaceRoot: string, storeRoot: string): string | null {
  try {
    const canonicalWorkspace = realpathSync(workspaceRoot);
    const canonicalStore = realpathSync(storeRoot);
    const canonicalItems = realpathSync(path.join(storeRoot, ITEMS_DIR));
    const canonicalIndex = realpathSync(path.join(storeRoot, INDEX_FILE));
    if (!isWithinWorkspace(canonicalWorkspace, canonicalStore)) {
      return "backlog store resolves outside the workspace";
    }
    if (!isWithinWorkspace(canonicalStore, canonicalItems)) {
      return "backlog items directory resolves outside the store";
    }
    if (!isWithinWorkspace(canonicalStore, canonicalIndex)) {
      return "backlog index resolves outside the store";
    }
  } catch {
    return "backlog mutation targets cannot be resolved";
  }
  return null;
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
