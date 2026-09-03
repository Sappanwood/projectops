// Application use case: create a backlog item.

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import type { CliIO } from "../io.js";
import {
  CATEGORIES,
  ITEM_TYPES,
  PRIORITIES,
  computeRevision,
  nextItemId,
  type BacklogItem,
  type Category,
  type ItemType,
  type Priority,
} from "../backlog/item.js";
import { ItemNotFoundError, listItemIds, readItemFile, writeItemFile } from "../backlog/itemFs.js";
import { resolveStoreRoot } from "./backlogContext.js";

type AddOptions = {
  title?: string;
  category?: string;
  priority?: string;
  "item-type"?: string;
  "parent-id"?: string;
  "depends-on"?: string;
  body?: string;
  "body-file"?: string;
  stdin?: boolean;
};

export function backlogAdd(
  projectId: string | undefined,
  args: string[],
  json: boolean,
  io: CliIO,
  cwd: string,
): number {
  if (projectId === undefined) {
    io.stderr("Usage: pops backlog add <project-id> -T <title> -c <category> --priority <P0-P3> [options]");
    return 1;
  }
  const store = resolveStoreRoot(projectId, io, cwd);
  if (store === null) return 1;

  let values: AddOptions;
  try {
    const parsed = parseArgs({
      args,
      options: {
        title: { type: "string", short: "T" },
        category: { type: "string", short: "c" },
        priority: { type: "string" },
        "item-type": { type: "string" },
        "parent-id": { type: "string" },
        "depends-on": { type: "string" },
        body: { type: "string", short: "b" },
        "body-file": { type: "string" },
        stdin: { type: "boolean" },
      },
      allowPositionals: true,
      strict: true,
    });
    values = parsed.values as AddOptions;
  } catch {
    io.stderr("Error: invalid arguments");
    return 1;
  }

  const title = values.title;
  if (title === undefined || title === "") {
    io.stderr("Error: --title is required");
    return 1;
  }
  if (values.category === undefined || !CATEGORIES.includes(values.category as Category)) {
    io.stderr(`Error: --category must be one of: ${CATEGORIES.join(", ")}`);
    return 1;
  }
  if (values.priority === undefined || !PRIORITIES.includes(values.priority as Priority)) {
    io.stderr(`Error: --priority must be one of: ${PRIORITIES.join(", ")}`);
    return 1;
  }
  const itemType = (values["item-type"] ?? "task") as ItemType;
  if (!ITEM_TYPES.includes(itemType)) {
    io.stderr(`Error: --item-type must be one of: ${ITEM_TYPES.join(", ")}`);
    return 1;
  }

  const parentId = values["parent-id"] ?? null;
  if (parentId !== null) {
    if (itemType === "epic") {
      io.stderr("Error: an epic cannot have a parent");
      return 1;
    }
    try {
      const parent = readItemFile(store.root, parentId);
      if (parent.item_type !== "epic") {
        io.stderr(`Error: parent ${parentId} is not an epic`);
        return 1;
      }
    } catch (error) {
      if (error instanceof ItemNotFoundError) {
        io.stderr(`Error: parent item not found: ${parentId}`);
        return 1;
      }
      throw error;
    }
  }

  const dependsOn = values["depends-on"] === undefined ? [] : values["depends-on"].split(",");
  for (const depId of dependsOn) {
    if (!listItemIds(store.root).includes(depId)) {
      io.stderr(`Error: dependency item not found: ${depId}`);
      return 1;
    }
  }

  let body = values.body ?? "";
  if (values["body-file"] !== undefined) {
    try {
      body = readFileSync(values["body-file"], "utf8");
    } catch {
      io.stderr(`Error: cannot read body file: ${values["body-file"]}`);
      return 1;
    }
  } else if (values.stdin === true) {
    body = io.stdin?.() ?? "";
  }

  const today = new Date().toISOString().slice(0, 10);
  const id = nextItemId(store.manifest.id_prefix, listItemIds(store.root));
  const item: BacklogItem = {
    id,
    project: store.manifest.project_id,
    title,
    item_type: itemType,
    parent_id: parentId,
    category: values.category as Category,
    priority: values.priority as Priority,
    effort: "M",
    impact: "medium",
    status: "todo",
    source: "",
    fixed_at: null,
    tags: [],
    depends_on: dependsOn,
    related_docs: [],
    created: today,
    updated: today,
    revision: "",
    body,
  };
  item.revision = computeRevision(item);
  writeItemFile(store.root, item);

  if (json) {
    io.stdout(JSON.stringify({ ok: true, item }));
  } else {
    io.stdout(`Added ${id}: ${title}`);
  }
  return 0;
}
