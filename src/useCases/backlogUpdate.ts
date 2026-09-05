// Application use case: update backlog status or revision-protected content.

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { updateBacklogItemStatus, updateBacklogItemContent } from "../application/backlogApi.js";
import type { CliIO } from "../io.js";
import { ITEM_STATUSES, type ItemStatus } from "../backlog/item.js";

type UpdateOptions = {
  status?: string;
  title?: string;
  "body-file"?: string;
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
      "Usage: pops backlog update <project-id> <item-id> (--status <status> | --title <title> | --body-file <file>) [--expected-revision <rev>] [--json]",
    );
    return 1;
  }
  let values: UpdateOptions;
  try {
    const parsed = parseArgs({
      args,
      options: {
        status: { type: "string" },
        title: { type: "string" },
        "body-file": { type: "string" },
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
  const contentEdit = values.title !== undefined || values["body-file"] !== undefined;
  if (contentEdit && values.status !== undefined) { io.stderr("Error: edit content and status separately."); return 1; }
  if (!contentEdit && (values.status === undefined || !ITEM_STATUSES.includes(values.status as ItemStatus))) {
    io.stderr(`Error: --status must be one of: ${ITEM_STATUSES.join(", ")}`);
    return 1;
  }
  let body: string | undefined;
  try { if (values["body-file"] !== undefined) body = readFileSync(values["body-file"], "utf8"); } catch { io.stderr("Error: cannot read body file."); return 1; }
  const result = contentEdit ? updateBacklogItemContent({workspaceDir:cwd, projectId, itemId, expectedRevision: values["expected-revision"] ?? "", ...(values.title === undefined ? {} : {title: values.title}), ...(body === undefined ? {} : {body})}) : updateBacklogItemStatus({
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
    io.stdout(`Updated ${itemId}: ${receipt.changed_fields.join(", ")}`);
  }
  return 0;
}
