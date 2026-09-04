// Application use case: materialize an approved plan into the project's backlog.

import { realpathSync } from "node:fs";
import path from "node:path";

import { addBacklogItem, BacklogAddError } from "../backlog/add.js";
import { INDEX_FILE, ITEMS_DIR } from "../backlog/store.js";
import { materializationOrder, type Plan } from "../plan/plan.js";
import { PlanNotFoundError, PlanParseError, planPath, readPlan, updatePlan } from "../plan/planFs.js";
import { isWithinWorkspace } from "../catalog/workspace.js";
import type { CliIO } from "../io.js";
import { resolveStoreRoot } from "./backlogContext.js";
import { resolvePlansRoot } from "./planContext.js";

type MaterializationReceipt = {
  ok: true;
  no_op: boolean;
  plan_id: string;
  mapping: Record<string, string>;
  items: { key: string; id: string; disposition: "created" | "reused" }[];
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
  const store = resolveStoreRoot(projectId, io, cwd);
  if (store === null) return 1;

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
  if (plan.status !== "approved") {
    io.stderr(`Error: plan must be approved before materialization: ${planId}`);
    return 1;
  }

  const targetProblem = planTargetProblem(plansRoot, planId);
  if (targetProblem !== null) {
    io.stderr(`Error: ${targetProblem}`);
    return 1;
  }
  const backlogTargetProblem = materializationTargetProblem(store.workspaceRoot, store.root);
  if (backlogTargetProblem !== null) {
    io.stderr(`Error: ${backlogTargetProblem}`);
    return 1;
  }

  if (plan.materialization !== undefined) {
    const receipt = buildReceipt(plan, plan.materialization.mapping, "reused");
    if (json) io.stdout(JSON.stringify(receipt));
    else io.stdout(`No changes (${plan.id})`);
    return 0;
  }

  const order = materializationOrder(plan.items);
  if (typeof order === "string") {
    io.stderr(`Error: ${order}`);
    return 1;
  }

  const mapping: Record<string, string> = {};
  try {
    for (const item of order) {
      const result = addBacklogItem(store.root, store.manifest, {
        title: item.title,
        category: "feature",
        priority: item.priority,
        item_type: item.item_type,
        parent_id: item.parent === undefined ? null : mapping[item.parent] ?? null,
        depends_on: item.depends_on.map((key) => mapping[key]!).filter((id): id is string => id !== undefined),
        body: item.body,
        source: `plan:${plan.id}#${item.key}`,
      });
      mapping[item.key] = result.id;
    }
  } catch (error) {
    if (error instanceof BacklogAddError) {
      io.stderr(`Error: ${error.message}`);
      return 1;
    }
    throw error;
  }

  const materialized = {
    materialized_at: new Date().toISOString(),
    mapping: Object.fromEntries(plan.items.map((item) => [item.key, mapping[item.key]!])),
  };
  updatePlan(plansRoot, { ...plan, materialization: materialized });

  const receipt = buildReceipt({ ...plan, materialization: materialized }, materialized.mapping, "created");
  if (json) io.stdout(JSON.stringify(receipt));
  else io.stdout(`Materialized ${plan.id}`);
  return 0;
}

function buildReceipt(
  plan: Plan,
  mapping: Record<string, string>,
  disposition: "created" | "reused",
): MaterializationReceipt {
  return {
    ok: true,
    no_op: disposition === "reused",
    plan_id: plan.id,
    mapping,
    items: plan.items.map((item) => ({ key: item.key, id: mapping[item.key]!, disposition })),
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
