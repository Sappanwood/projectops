import type { DependencyEvidence } from "../execution/attempt.js";
import { createHash } from "node:crypto";
import type { BacklogItem } from "../backlog/item.js";
import type { CodeSnapshot } from "../execution/attempt.js";
import type { Plan } from "../plan/plan.js";

export const PLAN_RUN_SCHEMA = "execution/PlanRun@1";
export type PlanRunNodeState =
  | "pending"
  | "running"
  | "awaiting_acceptance"
  | "accepted"
  | "failed"
  | "unknown";
export type PlanRunNode = {
  key: string;
  item_id: string;
  input: BacklogItem;
  depends_on: string[];
  state: PlanRunNodeState;
  attempt_ids: string[];
  accepted_attempt_id: string | null;
  reuse_note: string | null;
};
export type PlanRunReuse = { itemId: string; attemptId: string; note: string };
export type PlanRun = {
  model?: import("../execution/models.js").ModelRef;
  schema: typeof PLAN_RUN_SCHEMA;
  id: string;
  project_id: string;
  plan_id: string;
  plan_revision: string;
  plan_snapshot: Plan;
  instructions: string;
  mapping: Record<string, string>;
  revision: string;
  created_at: string;
  updated_at: string;
  state: "ready" | "running" | "paused" | "completed" | "stopped";
  capacity: 1;
  initial_baseline: CodeSnapshot;
  baseline: CodeSnapshot;
  nodes: PlanRunNode[];
  external_dependencies: Array<{ input: BacklogItem; attempt_id: string; note: string }>;
  cross_project_dependencies?: DependencyEvidence[];
  controls: Array<{
    action: "pause" | "resume" | "stop" | "close_stopped";
    note: string;
    at: string;
    baseline_digest: string;
  }>;
  diagnostics: string[];
};

export function sameTaskInput(a: BacklogItem, b: BacklogItem): boolean {
  const input = (item: BacklogItem) => {
    const { status, fixed_at, updated, revision, ...content } = item;
    return { ...content, body: content.body.trimEnd() };
  };
  return JSON.stringify(input(a)) === JSON.stringify(input(b));
}

export function planRunRevision(run: PlanRun): string {
  return createHash("sha256")
    .update(JSON.stringify({ ...run, revision: "" }))
    .digest("hex")
    .slice(0, 16);
}

export function nextReadyNode(run: PlanRun): PlanRunNode | undefined {
  if (run.nodes.some((node) => ["running", "unknown", "awaiting_acceptance"].includes(node.state)))
    return undefined;
  const accepted = new Set([
    ...run.nodes.filter((node) => node.state === "accepted").map((node) => node.item_id),
    ...run.external_dependencies.map((entry) => entry.input.id),
    ...(run.cross_project_dependencies ?? []).map(
      (entry) => `${entry.reference.project}:${entry.reference.item}`,
    ),
  ]);
  return run.nodes
    .filter((node) => node.state === "pending" && node.depends_on.every((id) => accepted.has(id)))
    .sort(
      (a, b) =>
        a.input.priority.localeCompare(b.input.priority) || a.item_id.localeCompare(b.item_id),
    )[0];
}
