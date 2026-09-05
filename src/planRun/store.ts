import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { isWithinWorkspace } from "../catalog/workspace.js";
import { ExecutionError } from "../execution/store.js";
import { PLAN_RUN_SCHEMA, planRunRevision, type PlanRun } from "./planRun.js";

export const newPlanRunId = () => `run-${randomUUID()}`;

export function planRunRoot(executionRoot: string, create = false): string {
  const root = path.join(executionRoot, "plan-runs");
  if (create && !existsSync(root)) mkdirSync(root);
  if (
    existsSync(root) &&
    (!lstatSync(root).isDirectory() ||
      !isWithinWorkspace(realpathSync(executionRoot), realpathSync(root)))
  )
    throw new ExecutionError(
      "EXECUTION_INVALID",
      "Plan run root is not a directory inside executions.",
    );
  return root;
}

function runPath(root: string, runId: string): string {
  if (!/^run-[a-f0-9-]{36}$/.test(runId))
    throw new ExecutionError("EXECUTION_INVALID", "Invalid Plan run ID.");
  const file = path.join(root, `${runId}.json`);
  if (
    existsSync(file) &&
    (!lstatSync(file).isFile() || !isWithinWorkspace(realpathSync(root), realpathSync(file)))
  )
    throw new ExecutionError("EXECUTION_INVALID", "Plan run file is outside its declared root.");
  return file;
}

export function readPlanRun(root: string, runId: string, projectId: string): PlanRun {
  const file = runPath(root, runId);
  if (!existsSync(file)) throw new ExecutionError("EXECUTION_NOT_FOUND", "Plan run not found.");
  const run = JSON.parse(readFileSync(file, "utf8")) as PlanRun;
  if (
    run.schema !== PLAN_RUN_SCHEMA ||
    run.id !== runId ||
    run.project_id !== projectId ||
    run.capacity !== 1 ||
    !["ready", "running", "paused", "completed", "stopped"].includes(run.state) ||
    !Array.isArray(run.nodes) ||
    !Array.isArray(run.external_dependencies) ||
    !Array.isArray(run.controls) ||
    !Array.isArray(run.diagnostics) ||
    !run.baseline?.digest ||
    !run.initial_baseline?.digest ||
    !run.plan_snapshot ||
    typeof run.instructions !== "string" ||
    run.nodes.some(
      (node) =>
        !node.input ||
        node.input.id !== node.item_id ||
        node.input.project !== projectId ||
        !["pending", "running", "awaiting_acceptance", "accepted", "failed", "unknown"].includes(
          node.state,
        ) ||
        !Array.isArray(node.attempt_ids),
    ) ||
    run.revision !== planRunRevision(run)
  )
    throw new ExecutionError(
      "EXECUTION_INVALID",
      "Plan run data is invalid or has changed outside a control operation.",
    );
  return run;
}

export function listStoredPlanRuns(root: string, projectId: string): PlanRun[] {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((file) => /^run-.*\.json$/.test(file))
    .map((file) => readPlanRun(root, file.slice(0, -5), projectId))
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));
}

export function savePlanRun(root: string, run: PlanRun, create = false): PlanRun {
  run.updated_at = new Date().toISOString();
  run.revision = planRunRevision(run);
  writeFileSync(runPath(root, run.id), JSON.stringify(run, null, 2) + "\n", {
    flag: create ? "wx" : "w",
  });
  return run;
}
