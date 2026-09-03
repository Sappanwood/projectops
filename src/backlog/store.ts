// Backlog domain: store manifest schema and pure logic.

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
  return [
    "# Backlog Index",
    "",
    "> Auto-generated",
    "> Total items: 0",
    "",
    "## Status",
    "",
    "- todo: 0",
    "- in_progress: 0",
    "- done: 0",
    "",
  ].join("\n");
}
