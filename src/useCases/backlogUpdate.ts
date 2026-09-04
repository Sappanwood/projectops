// Application use case: update a backlog item's status with revision protection.

import { parseArgs } from "node:util";

import type { CliIO } from "../io.js";
import {
  ITEM_STATUSES,
  computeRevision,
  isItemIdForPrefix,
  type BacklogItem,
  type ItemStatus,
} from "../backlog/item.js";
import { ItemNotFoundError, readItemFile, rebuildIndex, updateItemFile } from "../backlog/itemFs.js";
import { resolveStoreRoot } from "./backlogContext.js";

type UpdateOptions = {
  status?: string;
  "expected-revision"?: string;
};

export function backlogUpdate(
  projectId: string | undefined,
  itemId: string | undefined,
  args: string[],
  json: boolean,
  io: CliIO,
  cwd: string,
): number {
  if (projectId === undefined || itemId === undefined) {
    io.stderr(
      "Usage: pops backlog update <project-id> <item-id> --status <status> [--expected-revision <rev>] [--json]",
    );
    return 1;
  }
  const store = resolveStoreRoot(projectId, io, cwd);
  if (store === null) return 1;
  if (!isItemIdForPrefix(itemId, store.manifest.id_prefix)) {
    io.stderr(`Error: invalid item id: ${itemId}`);
    return 1;
  }

  let values: UpdateOptions;
  try {
    const parsed = parseArgs({
      args,
      options: {
        status: { type: "string" },
        "expected-revision": { type: "string" },
      },
      allowPositionals: true,
      strict: true,
    });
    values = parsed.values as UpdateOptions;
  } catch {
    io.stderr("Error: invalid arguments");
    return 1;
  }
  if (values.status === undefined || !ITEM_STATUSES.includes(values.status as ItemStatus)) {
    io.stderr(`Error: --status must be one of: ${ITEM_STATUSES.join(", ")}`);
    return 1;
  }
  const newStatus = values.status as ItemStatus;

  let before: BacklogItem;
  try {
    before = readItemFile(store.root, itemId);
  } catch (error) {
    if (error instanceof ItemNotFoundError) {
      io.stderr(`Error: ${error.message}`);
      return 1;
    }
    throw error;
  }
  if (before.id !== itemId) {
    io.stderr(`Error: item id mismatch: expected ${itemId}, got ${before.id}`);
    return 1;
  }

  if (values["expected-revision"] !== undefined && values["expected-revision"] !== before.revision) {
    io.stderr(
      `Error: revision mismatch for ${itemId}: expected ${values["expected-revision"]}, current ${before.revision}`,
    );
    return 1;
  }

  if (newStatus === before.status) {
    const receipt = buildReceipt(before, before, []);
    if (json) {
      io.stdout(JSON.stringify(receipt));
    } else {
      io.stdout(`No changes (${itemId})`);
    }
    return 0;
  }

  const today = new Date().toISOString().slice(0, 10);
  const result: BacklogItem = {
    ...before,
    status: newStatus,
    fixed_at: newStatus === "done" ? today : null,
    updated: today,
    revision: "",
  };
  result.revision = computeRevision(result);

  const changedFields = diffFields(before, result);
  if (changedFields.length === 0) {
    const receipt = buildReceipt(before, result, changedFields);
    if (json) {
      io.stdout(JSON.stringify(receipt));
    } else {
      io.stdout(`No changes (${itemId})`);
    }
    return 0;
  }

  updateItemFile(store.root, result);
  rebuildIndex(store.root);
  const receipt = buildReceipt(before, result, changedFields);
  if (json) {
    io.stdout(JSON.stringify(receipt));
  } else {
    io.stdout(`Updated ${itemId}: ${before.status} -> ${result.status}`);
  }
  return 0;
}

function diffFields(before: BacklogItem, result: BacklogItem): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(result)]);
  const changed: string[] = [];
  for (const key of keys) {
    const b = (before as unknown as Record<string, unknown>)[key];
    const r = (result as unknown as Record<string, unknown>)[key];
    if (JSON.stringify(b) !== JSON.stringify(r)) changed.push(key);
  }
  return changed;
}

function buildReceipt(
  before: BacklogItem,
  result: BacklogItem,
  changedFields: string[],
): Record<string, unknown> {
  return {
    ok: true,
    no_op: changedFields.length === 0,
    changed_fields: changedFields,
    revision: result.revision,
    before,
    result,
  };
}
