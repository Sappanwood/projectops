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

export function deriveIdPrefix(projectId: string): string {
  return projectId.replace(/-/g, "").slice(0, 3).toUpperCase();
}

export function newStoreManifest(projectId: string): BacklogStoreManifest {
  return {
    schema: STORE_SCHEMA,
    project_id: projectId,
    id_prefix: deriveIdPrefix(projectId),
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
