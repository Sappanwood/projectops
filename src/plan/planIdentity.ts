import { parseTaskReference, type TaskReference } from "../backlog/dependencyReference.js";
import { isProjectId } from "../catalog/workspace.js";
import { isPlanId, type Plan, type PlanItem } from "./plan.js";

export function planItemProject(owner: string, item: PlanItem): string {
  return item.project ?? owner;
}

export function planMappingReference(owner: string, value: string): TaskReference | null {
  return parseTaskReference(value, owner);
}

export function planMaterializationState(plan: Plan): "none" | "partial" | "complete" {
  return plan.materialization === undefined ? "none" : (plan.materialization.state ?? "complete");
}

export type PlanSource = { project: string; planId: string; key: string };

export function formatPlanSource(source: PlanSource, itemProject: string): string {
  const owner = source.project === itemProject ? "" : `${source.project}:`;
  return `plan:${owner}${source.planId}#${source.key}`;
}

export function parsePlanSource(value: string | null, itemProject: string): PlanSource | null {
  const match = value?.match(/^plan:(?:([a-z][a-z0-9-]*):)?(plan-[a-z0-9-]+)#([a-z][a-z0-9-]*)$/);
  if (!match) return null;
  const project = match[1] ?? itemProject;
  if (!isProjectId(project) || !isPlanId(match[2]!)) return null;
  return { project, planId: match[2]!, key: match[3]! };
}
