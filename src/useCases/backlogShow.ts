// Application use case: show a full backlog item.

import type { CliIO } from "../io.js";
import { ItemNotFoundError, readItemFile } from "../backlog/itemFs.js";
import { resolveStoreRoot } from "./backlogContext.js";

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
  const store = resolveStoreRoot(projectId, io, cwd);
  if (store === null) return 1;

  let item;
  try {
    item = readItemFile(store.root, itemId);
  } catch (error) {
    if (error instanceof ItemNotFoundError) {
      io.stderr(`Error: ${error.message}`);
      return 1;
    }
    throw error;
  }

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
