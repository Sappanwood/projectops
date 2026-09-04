// Filesystem adapter for backlog item files.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { INDEX_FILE, ITEMS_DIR, renderIndex } from "./store.js";
import { parseItemFile, serializeItem, type BacklogItem } from "./item.js";

export class ItemNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Backlog item not found: ${id}`);
  }
}

export class InvalidItemIdError extends Error {
  constructor(public readonly id: string) {
    super(`Invalid item id: ${id}`);
  }
}

function itemPath(storeRoot: string, id: string): string {
  if (!/^[A-Z0-9]+-\d{3,}$/.test(id)) throw new InvalidItemIdError(id);
  return path.join(storeRoot, ITEMS_DIR, `${id}.md`);
}

export function listItemIds(storeRoot: string): string[] {
  const dir = path.join(storeRoot, ITEMS_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith(".md"))
    .map((file) => file.slice(0, -3));
}

export function readItemFile(storeRoot: string, id: string): BacklogItem {
  const file = itemPath(storeRoot, id);
  if (!existsSync(file)) throw new ItemNotFoundError(id);
  return parseItemFile(readFileSync(file, "utf8"));
}

export function writeItemFile(storeRoot: string, item: BacklogItem): void {
  const file = itemPath(storeRoot, item.id);
  writeFileSync(file, serializeItem(item), { flag: "wx" });
}

export function updateItemFile(storeRoot: string, item: BacklogItem): void {
  const file = itemPath(storeRoot, item.id);
  writeFileSync(file, serializeItem(item));
}

export function rebuildIndex(storeRoot: string): void {
  const items = listItemIds(storeRoot)
    .sort()
    .map((id) => readItemFile(storeRoot, id));
  writeFileSync(path.join(storeRoot, INDEX_FILE), renderIndex(items));
}
