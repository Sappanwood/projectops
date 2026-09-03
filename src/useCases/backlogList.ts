// Application use case: list backlog items.

import { parseArgs } from "node:util";

import type { CliIO } from "../io.js";
import { ITEM_STATUSES, type BacklogItem, type ItemStatus } from "../backlog/item.js";
import { listItemIds, readItemFile } from "../backlog/itemFs.js";
import { resolveStoreRoot } from "./backlogContext.js";

export function backlogList(
  projectId: string | undefined,
  args: string[],
  json: boolean,
  io: CliIO,
  cwd: string,
): number {
  if (projectId === undefined) {
    io.stderr("Usage: pops backlog list <project-id> [--status <status>] [--json]");
    return 1;
  }
  const store = resolveStoreRoot(projectId, io, cwd);
  if (store === null) return 1;

  let status: ItemStatus | undefined;
  try {
    const parsed = parseArgs({
      args,
      options: { status: { type: "string" } },
      allowPositionals: true,
      strict: true,
    });
    const rawStatus = parsed.values.status;
    if (rawStatus !== undefined) {
      if (!ITEM_STATUSES.includes(rawStatus as ItemStatus)) {
        io.stderr(`Error: --status must be one of: ${ITEM_STATUSES.join(", ")}`);
        return 1;
      }
      status = rawStatus as ItemStatus;
    }
  } catch {
    io.stderr("Error: invalid arguments");
    return 1;
  }

  let items = listItemIds(store.root)
    .sort()
    .map((id) => readItemFile(store.root, id));
  if (status !== undefined) {
    items = items.filter((item) => item.status === status);
  }

  if (json) {
    const summary = items.map((item) => summarize(item));
    io.stdout(JSON.stringify({ ok: true, items: summary }));
  } else if (items.length === 0) {
    io.stdout("No items");
  } else {
    for (const item of items) {
      io.stdout(`${item.id}  ${item.priority}  ${item.status}  ${item.title}`);
    }
  }
  return 0;
}

function summarize(item: BacklogItem): Record<string, unknown> {
  const { body: _body, ...rest } = item;
  return rest;
}
