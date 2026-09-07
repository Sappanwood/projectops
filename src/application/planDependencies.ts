import {
  parsePlanDependency,
  parseTaskReference,
  taskReferenceKey,
} from "../backlog/dependencyReference.js";
import type { BacklogItem } from "../backlog/item.js";
import { planItemProject, planMappingReference } from "../plan/planIdentity.js";
import { resolveBacklogContext } from "./backlogApi.js";
import type { Plan } from "../plan/plan.js";
import { readTaskReference } from "./backlogDependencies.js";
import { applicationFailure, applicationSuccess, type ApplicationResult } from "./result.js";

export function materializedDependencies(
  dependencies: string[],
  mapping: Record<string, string>,
  owner?: string,
  target = owner,
): string[] {
  return dependencies.map((value) => {
    if (parsePlanDependency(value)?.kind === "task") return value;
    const mapped = mapping[value]!;
    if (owner === undefined) return mapped;
    const reference = planMappingReference(owner, mapped)!;
    return reference.project === target ? reference.item : taskReferenceKey(reference);
  });
}

export function validatePlanDependencies(
  workspaceDir: string,
  project: string,
  plan: Plan,
  pending?: BacklogItem[],
): ApplicationResult<null> {
  const targets = validatePlanTargets(workspaceDir, project, plan);
  if (!targets.ok) return targets;
  const nodes = new Map<
    string,
    { project: string; item_type: BacklogItem["item_type"]; dependencies: string[] }
  >();
  const mapping = plan.materialization?.mapping;
  const localKey = (key: string) => {
    const reference = mapping?.[key] ? planMappingReference(project, mapping[key]!) : null;
    return reference ? taskReferenceKey(reference) : `#local:${key}`;
  };
  if (pending === undefined) {
    for (const item of plan.items)
      nodes.set(localKey(item.key), {
        project: planItemProject(project, item),
        item_type: item.item_type,
        dependencies: item.depends_on.map((value) =>
          parsePlanDependency(value)?.kind === "local" ? localKey(value) : value,
        ),
      });
  } else {
    for (const item of pending)
      nodes.set(`${item.project}:${item.id}`, {
        project: item.project,
        item_type: item.item_type,
        dependencies: item.depends_on,
      });
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(key: string, dependency = false): ApplicationResult<null> {
    let node = nodes.get(key);
    if (dependency && node && node.item_type !== "task")
      return applicationFailure("PLAN_INVALID", `Dependency ${key} must be a task.`);
    if (visiting.has(key))
      return applicationFailure(
        "PLAN_INVALID",
        `Dependency cycle: ${[...visiting, key].join(" -> ")}.`,
      );
    if (visited.has(key)) return applicationSuccess(null);
    if (!node) {
      const reference = parseTaskReference(key, project);
      if (!reference) return applicationFailure("PLAN_INVALID", `Invalid dependency: ${key}.`);
      const loaded = readTaskReference(workspaceDir, reference);
      if (!loaded.ok) return loaded;
      node = {
        project: reference.project,
        item_type: loaded.data.item.item_type,
        dependencies: loaded.data.item.depends_on,
      };
    }
    visiting.add(key);
    const siblings = new Set<string>();
    for (const value of node.dependencies) {
      const reference = value.startsWith("#local:")
        ? null
        : parseTaskReference(value, node.project);
      const target = value.startsWith("#local:")
        ? value
        : reference
          ? taskReferenceKey(reference)
          : "";
      if (!target) return applicationFailure("PLAN_INVALID", `Invalid dependency: ${value}.`);
      if (siblings.has(target))
        return applicationFailure("PLAN_INVALID", `Duplicate dependency: ${target}.`);
      siblings.add(target);
      const result = visit(target, true);
      if (!result.ok) return result;
    }
    visiting.delete(key);
    visited.add(key);
    return applicationSuccess(null);
  }
  for (const key of nodes.keys()) {
    const result = visit(key);
    if (!result.ok) return result;
  }
  return applicationSuccess(null);
}

export function validatePlanTargets(
  workspaceDir: string,
  owner: string,
  plan: Plan,
): ApplicationResult<null> {
  for (const project of new Set(
    plan.items.filter((item) => item.project !== undefined).map((item) => item.project!),
  )) {
    const context = resolveBacklogContext(workspaceDir, project);
    if (!context.ok) return context;
  }
  for (const item of plan.items) {
    const project = planItemProject(owner, item);
    const parent = plan.items.find((candidate) => candidate.key === item.parent);
    if (parent && planItemProject(owner, parent) !== project)
      return applicationFailure(
        "PLAN_INVALID",
        `Plan item ${item.key} parent must belong to the same target project.`,
      );
    const value = plan.materialization?.mapping[item.key];
    if (value !== undefined) {
      const reference = planMappingReference(owner, value);
      if (!reference || reference.project !== project)
        return applicationFailure(
          "PLAN_INVALID",
          `Plan item ${item.key} materialized project cannot change.`,
        );
    }
  }
  return applicationSuccess(null);
}
