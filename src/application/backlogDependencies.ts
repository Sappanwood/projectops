import {
  parseTaskReference,
  taskReferenceKey,
  type TaskReference,
} from "../backlog/dependencyReference.js";
import type { BacklogItem } from "../backlog/item.js";
import { showBacklogItem } from "./backlogApi.js";
import { applicationFailure, applicationSuccess, type ApplicationResult } from "./result.js";

export function readTaskReference(
  workspaceDir: string,
  reference: TaskReference,
): ApplicationResult<{ reference: TaskReference; item: BacklogItem }> {
  const key = taskReferenceKey(reference);
  try {
    const result = showBacklogItem({
      workspaceDir,
      projectId: reference.project,
      itemId: reference.item,
    });
    if (!result.ok)
      return applicationFailure(result.error.code, `Dependency ${key}: ${result.error.message}`);
    if (result.data.item.project !== reference.project || result.data.item.item_type !== "task")
      return applicationFailure(
        "ITEM_INVALID",
        `${key}: expected a task owned by ${reference.project}.`,
      );
    return applicationSuccess({ reference, item: result.data.item });
  } catch (error) {
    return applicationFailure("ITEM_INVALID", `${key}: cannot read dependency: ${String(error)}`);
  }
}

export function validateBacklogDependencies(
  workspaceDir: string,
  owner: TaskReference,
  dependencies: string[],
): ApplicationResult<{ dependencies: string[] }> {
  if (!Array.isArray(dependencies) || dependencies.some((value) => typeof value !== "string"))
    return applicationFailure("ITEM_INVALID", "depends_on must be a string array.");
  const visiting = new Set<string>([taskReferenceKey(owner)]);
  const visited = new Set<string>();
  function visit(project: string, refs: string[], direct: boolean): ApplicationResult<null> {
    const siblings = new Set<string>();
    for (const value of refs) {
      const reference = parseTaskReference(value, project);
      if (!reference)
        return applicationFailure(
          "ITEM_INVALID",
          `${project}: invalid dependency reference ${value}.`,
        );
      const key = taskReferenceKey(reference);
      if (siblings.has(key))
        return applicationFailure("ITEM_INVALID", `Duplicate dependency: ${key}.`);
      siblings.add(key);
    }
    for (const value of refs) {
      const reference = parseTaskReference(value, project)!;
      const key = taskReferenceKey(reference);
      if (direct && key === taskReferenceKey(owner))
        return applicationFailure("ITEM_INVALID", `Self dependency: ${key}.`);
      if (visiting.has(key))
        return applicationFailure(
          "ITEM_INVALID",
          `Dependency cycle: ${[...visiting, key].join(" -> ")}.`,
        );
      if (visited.has(key)) continue;
      const loaded = readTaskReference(workspaceDir, reference);
      if (!loaded.ok) return loaded;
      visiting.add(key);
      const nested = visit(reference.project, loaded.data.item.depends_on, false);
      if (!nested.ok) return nested;
      visiting.delete(key);
      visited.add(key);
    }
    return applicationSuccess(null);
  }
  const result = visit(owner.project, dependencies, true);
  return result.ok ? applicationSuccess({ dependencies }) : result;
}

export function getBacklogDependencies(request: {
  workspaceDir: string;
  projectId: string;
  itemId: string;
}): ApplicationResult<{
  dependencies: { reference: TaskReference; item: BacklogItem }[];
  diagnostics: { reference: string; code: string; message: string }[];
}> {
  const item = showBacklogItem(request);
  if (!item.ok) return item;
  const dependencies: { reference: TaskReference; item: BacklogItem }[] = [];
  const diagnostics: { reference: string; code: string; message: string }[] = [];
  for (const value of item.data.item.depends_on) {
    const reference = parseTaskReference(value, request.projectId);
    if (!reference) {
      diagnostics.push({
        reference: value,
        code: "ITEM_INVALID",
        message: `Invalid reference: ${value}.`,
      });
      continue;
    }
    const result = readTaskReference(request.workspaceDir, reference);
    if (result.ok) dependencies.push(result.data);
    else diagnostics.push({ reference: taskReferenceKey(reference), ...result.error });
  }
  return applicationSuccess({ dependencies, diagnostics });
}
