// Application use case: list backlog items.

import { parseArgs } from "node:util";

import { listBacklogItems } from "../application/backlogApi.js";
import type { CliIO } from "../io.js";
import { ITEM_STATUSES, type ItemStatus } from "../backlog/item.js";

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

  const result = listBacklogItems({
    workspaceDir: cwd,
    projectId,
    ...(status === undefined ? {} : { status }),
  });
  if (!result.ok) {
    const suffix =
      result.error.code === "BACKLOG_STORE_NOT_FOUND"
        ? ` Run "pops backlog init ${projectId}" first.`
        : "";
    io.stderr(`Error: ${result.error.message}${suffix}`);
    return 1;
  }
  const { items } = result.data;

  if (json) {
    io.stdout(JSON.stringify({ ok: true, items }));
  } else if (items.length === 0) {
    io.stdout("No items");
  } else {
    for (const item of items) {
      io.stdout(`${item.id}  ${item.priority}  ${item.status}  ${item.title}`);
    }
  }
  return 0;
}
