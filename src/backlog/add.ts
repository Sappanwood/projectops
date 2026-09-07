// Backlog application helper shared by CLI and plan materialization.

import {
  CATEGORIES,
  ITEM_TYPES,
  PRIORITIES,
  computeRevision,
  isItemIdForPrefix,
  nextItemId,
  type BacklogItem,
  type Category,
  type ItemType,
  type Priority,
} from "./item.js";
import {
  ItemNotFoundError,
  listItemIds,
  readItemFile,
  rebuildIndex,
  writeItemFile,
} from "./itemFs.js";
import type { BacklogStoreManifest } from "./store.js";

export type BacklogItemDraft = {
  title: string;
  category: Category;
  priority: Priority;
  item_type: ItemType;
  parent_id: string | null;
  depends_on: string[];
  body: string;
  source?: string;
};

export class BacklogAddError extends Error {}

export function addBacklogItem(
  storeRoot: string,
  manifest: BacklogStoreManifest,
  draft: BacklogItemDraft,
  validateDependencies?: (itemId: string, dependencies: string[]) => void,
): BacklogItem {
  if (typeof draft.title !== "string" || !draft.title.trim())
    throw new BacklogAddError("--title is required");
  if (!CATEGORIES.includes(draft.category)) {
    throw new BacklogAddError(`--category must be one of: ${CATEGORIES.join(", ")}`);
  }
  if (!PRIORITIES.includes(draft.priority)) {
    throw new BacklogAddError(`--priority must be one of: ${PRIORITIES.join(", ")}`);
  }
  if (!ITEM_TYPES.includes(draft.item_type)) {
    throw new BacklogAddError(`--item-type must be one of: ${ITEM_TYPES.join(", ")}`);
  }

  if (draft.parent_id !== null) {
    if (draft.item_type === "epic") throw new BacklogAddError("an epic cannot have a parent");
    if (!isItemIdForPrefix(draft.parent_id, manifest.id_prefix)) {
      throw new BacklogAddError(`invalid item id: ${draft.parent_id}`);
    }
    try {
      const parent = readItemFile(storeRoot, draft.parent_id);
      if (parent.item_type !== "epic")
        throw new BacklogAddError(`parent ${draft.parent_id} is not an epic`);
    } catch (error) {
      if (error instanceof BacklogAddError) throw error;
      if (error instanceof ItemNotFoundError) {
        throw new BacklogAddError(`parent item not found: ${draft.parent_id}`);
      }
      throw error;
    }
  }

  const existingIds = listItemIds(storeRoot);
  const id = nextItemId(manifest.id_prefix, existingIds);
  if (validateDependencies) validateDependencies(id, draft.depends_on);
  else
    for (const dependency of draft.depends_on) {
      if (!isItemIdForPrefix(dependency, manifest.id_prefix)) {
        throw new BacklogAddError(`invalid item id: ${dependency}`);
      }
      if (!existingIds.includes(dependency)) {
        throw new BacklogAddError(`dependency item not found: ${dependency}`);
      }
    }

  const today = new Date().toISOString().slice(0, 10);
  const item: BacklogItem = {
    id,
    project: manifest.project_id,
    title: draft.title,
    item_type: draft.item_type,
    parent_id: draft.parent_id,
    category: draft.category,
    priority: draft.priority,
    effort: "M",
    impact: "medium",
    status: "todo",
    source: draft.source ?? "",
    fixed_at: null,
    tags: [],
    depends_on: [...draft.depends_on],
    related_docs: [],
    created: today,
    updated: today,
    revision: "",
    body: draft.body,
  };
  item.revision = computeRevision(item);
  writeItemFile(storeRoot, item);
  rebuildIndex(storeRoot);
  return item;
}
