// Backlog domain: store manifest schema and pure logic.

import { ITEM_STATUSES, type BacklogItem } from "./item.js";

export const STORE_SCHEMA = "backlog/Store@1";
export const STORE_MANIFEST_FILE = "backlog.json";
export const ITEMS_DIR = "items";
export const INDEX_FILE = "INDEX.md";

export type BacklogStoreManifest = {
  schema: typeof STORE_SCHEMA;
  project_id: string;
  id_prefix: string;
};

export function isValidIdPrefix(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !/[^A-Z0-9]/.test(value);
}

export function deriveIdPrefix(projectId: string, occupied: ReadonlySet<string>): string {
  const base = projectId.replace(/-/g, "").slice(0, 3).toUpperCase();
  let candidate = base;
  for (let suffix = 2; occupied.has(candidate); suffix += 1) candidate = `${base}${suffix}`;
  return candidate;
}

export function newStoreManifest(projectId: string, idPrefix: string): BacklogStoreManifest {
  return {
    schema: STORE_SCHEMA,
    project_id: projectId,
    id_prefix: idPrefix,
  };
}

export function initialIndex(): string {
  return renderIndex([]);
}

export function renderIndex(items: readonly BacklogItem[]): string {
  const counts = Object.fromEntries(ITEM_STATUSES.map((status) => [status, 0])) as Record<
    BacklogItem["status"],
    number
  >;
  for (const item of items) counts[item.status] += 1;
  return [
    "# Backlog Index",
    "",
    "> Auto-generated",
    `> Total items: ${items.length}`,
    "",
    "## Status",
    "",
    ...ITEM_STATUSES.map((status) => `- ${status}: ${counts[status]}`),
    "",
  ].join("\n");
}
