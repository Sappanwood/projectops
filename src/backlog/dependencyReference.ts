import { isProjectId } from "../catalog/workspace.js";

export type TaskReference = { project: string; item: string };
export type PlanDependency =
  | { kind: "local"; key: string }
  | { kind: "task"; reference: TaskReference };

export function parseTaskReference(value: string, project: string): TaskReference | null {
  const parts = value.split(":");
  if (parts.length > 2) return null;
  const owner = parts.length === 2 ? parts[0]! : project;
  const item = parts.at(-1)!;
  if (!isProjectId(owner) || !/^[A-Z0-9]+-\d{3,}$/.test(item)) return null;
  return { project: owner, item };
}

export function parsePlanDependency(value: string): PlanDependency | null {
  if (/^[a-z][a-z0-9-]*$/.test(value)) return { kind: "local", key: value };
  if (!value.includes(":")) return null;
  const reference = parseTaskReference(value, "");
  return reference === null ? null : { kind: "task", reference };
}

export function taskReferenceKey(reference: TaskReference): string {
  return `${reference.project}:${reference.item}`;
}
