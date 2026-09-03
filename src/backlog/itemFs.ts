// Filesystem adapter for backlog item files.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { ITEMS_DIR } from "./store.js";
import { parseItemFile, serializeItem, type BacklogItem } from "./item.js";

export class ItemNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Backlog item not found: ${id}`);
  }
}

export function listItemIds(storeRoot: string): string[] {
  const dir = path.join(storeRoot, ITEMS_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith(".md"))
    .map((file) => file.slice(0, -3));
}

export function readItemFile(storeRoot: string, id: string): BacklogItem {
  const file = path.join(storeRoot, ITEMS_DIR, `${id}.md`);
  if (!existsSync(file)) throw new ItemNotFoundError(id);
  return parseItemFile(readFileSync(file, "utf8"));
}

export function writeItemFile(storeRoot: string, item: BacklogItem): void {
  const file = path.join(storeRoot, ITEMS_DIR, `${item.id}.md`);
  writeFileSync(file, serializeItem(item), { flag: "wx" });
}

export function updateItemFile(storeRoot: string, item: BacklogItem): void {
  const file = path.join(storeRoot, ITEMS_DIR, `${item.id}.md`);
  writeFileSync(file, serializeItem(item));
}
