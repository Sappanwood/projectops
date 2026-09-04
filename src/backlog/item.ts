// Backlog domain: item schema, markdown serialization, and pure helpers.

import { createHash } from "node:crypto";

export const ITEM_STATUSES = ["todo", "in_progress", "done", "cancelled", "blocked"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const ITEM_TYPES = ["task", "epic"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const CATEGORIES = [
  "bug",
  "a11y",
  "ux",
  "i18n",
  "testing",
  "feature",
  "refactor",
  "perf",
  "docs",
  "architecture",
  "security",
  "research",
  "ops",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const PRIORITIES = ["P0", "P1", "P2", "P3"] as const;
export type Priority = (typeof PRIORITIES)[number];

export type BacklogItem = {
  id: string;
  project: string;
  title: string;
  item_type: ItemType;
  parent_id: string | null;
  category: Category;
  priority: Priority;
  effort: string;
  impact: string;
  status: ItemStatus;
  source: string;
  fixed_at: string | null;
  tags: string[];
  depends_on: string[];
  related_docs: string[];
  created: string;
  updated: string;
  revision: string;
  body: string;
};

const SCALAR_FIELDS = [
  "id",
  "project",
  "title",
  "item_type",
  "parent_id",
  "category",
  "priority",
  "effort",
  "impact",
  "status",
  "source",
  "fixed_at",
  "created",
  "updated",
  "revision",
] as const;

const LIST_FIELDS = ["tags", "depends_on", "related_docs"] as const;

function serializeScalar(value: string | null): string {
  if (value === null) return "null";
  if (value === "") return "''";
  if (/^[\s#"'\-?:,{}[\]]/.test(value) || /[\s#":]$/.test(value) || value.includes("\n")) {
    return JSON.stringify(value);
  }
  return value;
}

function parseScalar(value: string): string | null {
  if (value === "null") return null;
  if (value === "''") return "";
  if (value.startsWith("[") || value.startsWith('"')) {
    return JSON.parse(value) as string;
  }
  return value;
}

function serializeList(value: string[]): string {
  return JSON.stringify(value);
}

export class ItemParseError extends Error {
  constructor(public readonly id: string, cause: string) {
    super(`Invalid backlog item ${id}: ${cause}`);
  }
}

export function serializeItem(item: BacklogItem): string {
  const lines: string[] = ["---"];
  for (const field of SCALAR_FIELDS) {
    lines.push(`${field}: ${serializeScalar(item[field] as string | null)}`);
  }
  for (const field of LIST_FIELDS) {
    lines.push(`${field}: ${serializeList(item[field] as string[])}`);
  }
  lines.push("---", "");
  lines.push(item.body);
  return `${lines.join("\n").trimEnd()}\n`;
}

export function parseItemFile(content: string): BacklogItem {
  const lines = content.split("\n");
  if (lines[0] !== "---") throw new ItemParseError("?", "missing frontmatter");
  const end = lines.indexOf("---", 1);
  if (end === -1) throw new ItemParseError("?", "unterminated frontmatter");

  const raw: Record<string, unknown> = {};
  for (const line of lines.slice(1, end)) {
    const idx = line.indexOf(": ");
    if (idx === -1) continue;
    raw[line.slice(0, idx)] = line.slice(idx + 2);
  }

  const id = parseScalar(String(raw.id));
  if (id === null) throw new ItemParseError("?", "missing id");

  const scalar = (field: string, fallback: string): string => {
    const value = raw[field];
    if (typeof value !== "string") return fallback;
    const parsed = parseScalar(value);
    return parsed ?? fallback;
  };
  const list = (field: string): string[] => {
    const value = raw[field];
    if (typeof value !== "string") return [];
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch {
      throw new ItemParseError(id, `invalid ${field}`);
    }
  };

  const body = lines.slice(end + 1).join("\n").replace(/^\n/, "");
  return {
    id,
    project: scalar("project", ""),
    title: scalar("title", ""),
    item_type: scalar("item_type", "task") as ItemType,
    parent_id: parseScalar(String(raw.parent_id ?? "null")),
    category: scalar("category", "feature") as Category,
    priority: scalar("priority", "P1") as Priority,
    effort: scalar("effort", "M"),
    impact: scalar("impact", "medium"),
    status: scalar("status", "todo") as ItemStatus,
    source: scalar("source", ""),
    fixed_at: parseScalar(String(raw.fixed_at ?? "null")),
    tags: list("tags"),
    depends_on: list("depends_on"),
    related_docs: list("related_docs"),
    created: scalar("created", ""),
    updated: scalar("updated", ""),
    revision: scalar("revision", ""),
    body,
  };
}

export function computeRevision(item: Omit<BacklogItem, "revision">): string {
  const { body, ...fields } = item;
  const payload = JSON.stringify({ ...fields, body });
  return createHash("sha256").update(payload).digest("hex").slice(0, 8);
}

export function nextItemId(prefix: string, existingIds: readonly string[]): string {
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  let maxSeq = 0;
  for (const existing of existingIds) {
    const match = pattern.exec(existing);
    if (match !== null) {
      const seq = Number(match[1]);
      if (seq > maxSeq) maxSeq = seq;
    }
  }
  let seq = maxSeq + 1;
  for (;;) {
    const id = `${prefix}-${String(seq).padStart(3, "0")}`;
    if (!existingIds.includes(id)) return id;
    seq += 1;
  }
}

export function isItemIdForPrefix(id: string, prefix: string): boolean {
  return id.startsWith(`${prefix}-`) && /^[A-Z0-9]+-\d{3,}$/.test(id);
}
