// Application use case: show a full backlog item.

import { showBacklogItem } from "../application/backlogApi.js";
import type { CliIO } from "../io.js";

export function backlogShow(
  projectId: string | undefined,
  itemId: string | undefined,
  json: boolean,
  io: CliIO,
  cwd: string,
): number {
  if (projectId === undefined || itemId === undefined) {
    io.stderr("Usage: pops backlog show <project-id> <item-id> [--json]");
    return 1;
  }
  const result = showBacklogItem({ workspaceDir: cwd, projectId, itemId });
  if (!result.ok) {
    const suffix = result.error.code === "BACKLOG_STORE_NOT_FOUND"
      ? ` Run "pops backlog init ${projectId}" first.`
      : "";
    io.stderr(`Error: ${result.error.message}${suffix}`);
    return 1;
  }
  const { item } = result.data;

  if (json) {
    io.stdout(JSON.stringify(item));
  } else {
    const details = [
      `${item.id}  [${item.status}]  ${item.priority}  ${item.category}`,
      item.title,
      "",
    ];
    if (item.body !== "") details.push(item.body);
    io.stdout(details.join("\n"));
  }
  return 0;
}
