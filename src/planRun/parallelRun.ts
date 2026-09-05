import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { BacklogItem } from "../backlog/item.js";
import type { Plan } from "../plan/plan.js";
import { ExecutionError } from "../execution/store.js";
import type { LandingResult, NodeWorkspace, RunWorkspace } from "./worktrees.js";
export const PARALLEL_RUN_SCHEMA = "execution/ParallelRun@1";
export type ParallelNode = {
  key: string;
  item_id: string;
  input: BacklogItem;
  depends_on: string[];
  parallel: boolean;
  resources: string[];
  state:
    | "pending"
    | "running"
    | "awaiting_acceptance"
    | "awaiting_landing"
    | "landing"
    | "landed"
    | "failed"
    | "unknown";
  attempt_ids: string[];
  workspace: NodeWorkspace | null;
  landings: LandingResult[];
};
export type ParallelRun = {
  model?: import("../execution/models.js").ModelRef;
  schema: typeof PARALLEL_RUN_SCHEMA;
  id: string;
  project_id: string;
  plan_id: string;
  plan_revision: string;
  plan_snapshot: Plan;
  mapping: Record<string, string>;
  revision: string;
  created_at: string;
  updated_at: string;
  state: "ready" | "running" | "paused" | "completed" | "stopped";
  capacity: 2;
  workspace: RunWorkspace;
  integration_head: string;
  commands: string[][];
  nodes: ParallelNode[];
  controls: Array<{
    action: string;
    note: string;
    at: string;
    node_key?: string;
    attempt_id?: string;
  }>;
  diagnostics: string[];
};
export function parallelRevision(run: ParallelRun) {
  return createHash("sha256")
    .update(JSON.stringify({ ...run, revision: "" }))
    .digest("hex")
    .slice(0, 16);
}
export function parallelRoot(executions: string, create = false) {
  const root = path.join(executions, "parallel-runs");
  if (create && !existsSync(root)) mkdirSync(root);
  if (existsSync(root) && (lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory()))
    throw new ExecutionError("EXECUTION_INVALID", "Parallel run root must be a regular directory.");
  return root;
}
function file(root: string, runId: string) {
  if (!/^run-[a-f0-9-]{36}$/.test(runId))
    throw new ExecutionError("EXECUTION_INVALID", "Invalid parallel run ID.");
  const target = path.join(root, `${runId}.json`);
  if (existsSync(target) && (lstatSync(target).isSymbolicLink() || !lstatSync(target).isFile()))
    throw new ExecutionError("EXECUTION_INVALID", "Parallel run record must be a regular file.");
  return target;
}
export function readParallelRun(root: string, runId: string, projectId: string): ParallelRun {
  const target = file(root, runId);
  if (!existsSync(target))
    throw new ExecutionError("EXECUTION_NOT_FOUND", "Parallel run not found.");
  const run = JSON.parse(readFileSync(target, "utf8")) as ParallelRun;
  if (
    run.schema !== PARALLEL_RUN_SCHEMA ||
    run.id !== runId ||
    run.project_id !== projectId ||
    run.capacity !== 2 ||
    !["ready", "running", "paused", "completed", "stopped"].includes(run.state) ||
    !Array.isArray(run.nodes) ||
    !Array.isArray(run.commands) ||
    !Array.isArray(run.controls) ||
    !Array.isArray(run.diagnostics) ||
    run.workspace?.runId !== run.id ||
    !run.integration_head ||
    run.revision !== parallelRevision(run) ||
    run.nodes.some(
      (node) =>
        node.input?.id !== node.item_id ||
        node.input.project !== projectId ||
        ![
          "pending",
          "running",
          "awaiting_acceptance",
          "awaiting_landing",
          "landing",
          "landed",
          "failed",
          "unknown",
        ].includes(node.state) ||
        !Array.isArray(node.attempt_ids) ||
        !Array.isArray(node.landings) ||
        !Array.isArray(node.resources) ||
        typeof node.parallel !== "boolean",
    )
  )
    throw new ExecutionError(
      "EXECUTION_INVALID",
      "Parallel run scope or lifecycle data is invalid.",
    );
  return run;
}
export function listStoredParallelRuns(root: string, projectId: string) {
  return existsSync(root)
    ? readdirSync(root)
        .filter((name) => /^run-.*\.json$/.test(name))
        .map((name) => readParallelRun(root, name.slice(0, -5), projectId))
    : [];
}
export function saveParallelRun(root: string, run: ParallelRun, create = false) {
  run.updated_at = new Date().toISOString();
  run.revision = parallelRevision(run);
  writeFileSync(file(root, run.id), JSON.stringify(run, null, 2) + "\n", {
    flag: create ? "wx" : "w",
  });
  return run;
}
export function nextParallelNode(run: ParallelRun): ParallelNode | undefined {
  const occupied = run.nodes.filter((node) =>
    ["running", "awaiting_acceptance", "awaiting_landing", "landing", "unknown"].includes(
      node.state,
    ),
  );
  if (occupied.length >= 2) return undefined;
  const landed = new Set(
    run.nodes.filter((node) => node.state === "landed").map((node) => node.item_id),
  );
  return run.nodes
    .filter((node) => node.state === "pending" && node.depends_on.every((id) => landed.has(id)))
    .sort(
      (a, b) =>
        a.input.priority.localeCompare(b.input.priority) || a.item_id.localeCompare(b.item_id),
    )
    .find(
      (node) =>
        occupied.length === 0 ||
        (node.parallel &&
          occupied.every(
            (other) =>
              other.parallel &&
              !other.resources.some((resource) => node.resources.includes(resource)),
          )),
    );
}
