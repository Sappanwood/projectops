// Application use case: update a backlog item's status with revision protection.

import { parseArgs } from "node:util";

import { updateBacklogItemStatus } from "../application/backlogApi.js";
import type { CliIO } from "../io.js";
import { ITEM_STATUSES, type ItemStatus } from "../backlog/item.js";

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
  const result = updateBacklogItemStatus({
    workspaceDir: cwd,
    projectId,
    itemId,
    status: values.status as ItemStatus,
    ...(values["expected-revision"] === undefined
      ? {}
      : { expectedRevision: values["expected-revision"] }),
  });
  if (!result.ok) {
    const suffix = result.error.code === "BACKLOG_STORE_NOT_FOUND"
      ? ` Run "pops backlog init ${projectId}" first.`
      : "";
    io.stderr(`Error: ${result.error.message}${suffix}`);
    return 1;
  }
  const receipt = result.data;
  if (json) {
    io.stdout(JSON.stringify({ ok: true, ...receipt }));
  } else if (receipt.no_op) {
    io.stdout(`No changes (${itemId})`);
  } else {
    io.stdout(`Updated ${itemId}: ${receipt.before.status} -> ${receipt.result.status}`);
  }
  return 0;
}
