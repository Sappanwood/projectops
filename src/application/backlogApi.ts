import { existsSync, statSync } from "node:fs";
import path from "node:path";

import { projectArtifactRoots } from "../catalog/workspace.js";
import {
  ManifestParseError,
  WorkspaceNotFoundError,
  loadWorkspace,
} from "../catalog/workspaceStore.js";
import {
  ITEM_STATUSES,
  ItemParseError,
  computeRevision,
  isItemIdForPrefix,
  type BacklogItem,
  type ItemStatus,
} from "../backlog/item.js";
import {
  ItemNotFoundError,
  listItemIds,
  readItemFile,
  rebuildIndex,
  updateItemFile,
} from "../backlog/itemFs.js";
import {
  StoreNotFoundError,
  StoreParseError,
  loadStore,
} from "../backlog/storeFs.js";
import { ITEMS_DIR, type BacklogStoreManifest } from "../backlog/store.js";
import { applicationFailure, applicationSuccess, type ApplicationResult } from "./result.js";

export type BacklogItemSummary = Omit<BacklogItem, "body">;

export type ListBacklogItemsRequest = {
  workspaceDir: string;
  projectId: string;
  status?: string;
};

export type ShowBacklogItemRequest = {
  workspaceDir: string;
  projectId: string;
  itemId: string;
};

export type UpdateBacklogItemStatusRequest = ShowBacklogItemRequest & {
  status: string;
  expectedRevision?: string;
};

export type BacklogMutationReceipt = {
  no_op: boolean;
  changed_fields: string[];
  revision: string;
  before: BacklogItem;
  result: BacklogItem;
};

type BacklogContext = {
  root: string;
  manifest: BacklogStoreManifest;
};

export function listBacklogItems(
  request: ListBacklogItemsRequest,
): ApplicationResult<{ items: BacklogItemSummary[] }> {
  if (request.status !== undefined && !ITEM_STATUSES.includes(request.status as ItemStatus)) {
    return applicationFailure("INVALID_STATUS", `Status must be one of: ${ITEM_STATUSES.join(", ")}.`);
  }
  const context = resolveBacklogContext(request.workspaceDir, request.projectId);
  if (!context.ok) return context;

  let items: BacklogItem[] = [];
  for (const id of listItemIds(context.data.root).sort()) {
    try {
      const item = readItemFile(context.data.root, id);
      if (item.id !== id) {
        return applicationFailure(
          "ITEM_ID_MISMATCH",
          `Item id mismatch in ${id}.md: expected ${id}, got ${item.id}.`,
        );
      }
      items.push(item);
    } catch (error) {
      if (error instanceof ItemParseError) {
        return applicationFailure("ITEM_INVALID", error.message);
      }
      throw error;
    }
  }
  if (request.status !== undefined) {
    items = items.filter((item) => item.status === request.status);
  }
  return applicationSuccess({
    items: items.map(({ body: _body, ...summary }) => summary),
  });
}

export function showBacklogItem(
  request: ShowBacklogItemRequest,
): ApplicationResult<{ item: BacklogItem }> {
  const context = resolveBacklogContext(request.workspaceDir, request.projectId);
  if (!context.ok) return context;
  const invalidId = validateItemId(request.itemId, context.data.manifest.id_prefix);
  if (invalidId !== null) return invalidId;

  const item = readItem(context.data.root, request.itemId);
  if (!item.ok) return item;
  return applicationSuccess({ item: item.data });
}

export function updateBacklogItemStatus(
  request: UpdateBacklogItemStatusRequest,
): ApplicationResult<BacklogMutationReceipt> {
  if (!ITEM_STATUSES.includes(request.status as ItemStatus)) {
    return applicationFailure("INVALID_STATUS", `Status must be one of: ${ITEM_STATUSES.join(", ")}.`);
  }
  const context = resolveBacklogContext(request.workspaceDir, request.projectId);
  if (!context.ok) return context;
  const invalidId = validateItemId(request.itemId, context.data.manifest.id_prefix);
  if (invalidId !== null) return invalidId;

  const loaded = readItem(context.data.root, request.itemId);
  if (!loaded.ok) return loaded;
  const before = loaded.data;
  if (request.expectedRevision !== undefined && request.expectedRevision !== before.revision) {
    return applicationFailure(
      "REVISION_MISMATCH",
      `Revision mismatch for ${request.itemId}: expected ${request.expectedRevision}, current ${before.revision}.`,
    );
  }

  const status = request.status as ItemStatus;
  if (status === before.status) return applicationSuccess(buildReceipt(before, before, []));

  const today = new Date().toISOString().slice(0, 10);
  const result: BacklogItem = {
    ...before,
    status,
    fixed_at: status === "done" ? today : null,
    updated: today,
    revision: "",
  };
  result.revision = computeRevision(result);
  const changedFields = diffFields(before, result);
  if (changedFields.length === 0) return applicationSuccess(buildReceipt(before, result, changedFields));

  updateItemFile(context.data.root, result);
  rebuildIndex(context.data.root);
  return applicationSuccess(buildReceipt(before, result, changedFields));
}

function resolveBacklogContext(
  workspaceDir: string,
  projectId: string,
): ApplicationResult<BacklogContext> {
  let workspace;
  try {
    workspace = loadWorkspace(workspaceDir);
  } catch (error) {
    if (error instanceof WorkspaceNotFoundError) {
      return applicationFailure("WORKSPACE_NOT_FOUND", "Workspace not found.");
    }
    if (error instanceof ManifestParseError) {
      return applicationFailure("WORKSPACE_INVALID", "Workspace manifest is invalid.");
    }
    throw error;
  }
  if (!Object.hasOwn(workspace.manifest.projects, projectId)) {
    return applicationFailure("PROJECT_NOT_FOUND", `Project "${projectId}" is not registered.`);
  }

  const root = projectArtifactRoots(
    workspace.root,
    projectId,
    workspace.manifest.artifact_layout,
  ).backlog;
  try {
    const manifest = loadStore(root);
    const itemsDir = path.join(root, ITEMS_DIR);
    if (!existsSync(itemsDir) || !statSync(itemsDir).isDirectory()) {
      return applicationFailure(
        "BACKLOG_STORE_INVALID",
        `Backlog store is invalid for project "${projectId}".`,
      );
    }
    return applicationSuccess({ root, manifest });
  } catch (error) {
    if (error instanceof StoreNotFoundError) {
      return applicationFailure(
        "BACKLOG_STORE_NOT_FOUND",
        `Backlog store is not initialized for project "${projectId}".`,
      );
    }
    if (error instanceof StoreParseError) {
      return applicationFailure(
        "BACKLOG_STORE_INVALID",
        `Backlog store is invalid for project "${projectId}".`,
      );
    }
    throw error;
  }
}

function validateItemId(
  itemId: string,
  prefix: string,
): ApplicationResult<never> | null {
  if (isItemIdForPrefix(itemId, prefix)) return null;
  return applicationFailure("INVALID_ITEM_ID", `Invalid item id: ${itemId}.`);
}

function readItem(
  storeRoot: string,
  itemId: string,
): ApplicationResult<BacklogItem> {
  let item;
  try {
    item = readItemFile(storeRoot, itemId);
  } catch (error) {
    if (error instanceof ItemNotFoundError) {
      return applicationFailure("ITEM_NOT_FOUND", `Backlog item not found: ${itemId}.`);
    }
    if (error instanceof ItemParseError) {
      return applicationFailure("ITEM_INVALID", error.message);
    }
    throw error;
  }
  if (item.id !== itemId) {
    return applicationFailure(
      "ITEM_ID_MISMATCH",
      `Item id mismatch: expected ${itemId}, got ${item.id}.`,
    );
  }
  return applicationSuccess(item);
}

function diffFields(before: BacklogItem, result: BacklogItem): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(result)]);
  const changed: string[] = [];
  for (const key of keys) {
    const beforeValue = (before as unknown as Record<string, unknown>)[key];
    const resultValue = (result as unknown as Record<string, unknown>)[key];
    if (JSON.stringify(beforeValue) !== JSON.stringify(resultValue)) changed.push(key);
  }
  return changed;
}

function buildReceipt(
  before: BacklogItem,
  result: BacklogItem,
  changedFields: string[],
): BacklogMutationReceipt {
  return {
    no_op: changedFields.length === 0,
    changed_fields: changedFields,
    revision: result.revision,
    before,
    result,
  };
}
