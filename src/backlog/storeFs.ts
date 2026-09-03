// Filesystem adapter for the backlog domain.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  INDEX_FILE,
  ITEMS_DIR,
  STORE_MANIFEST_FILE,
  STORE_SCHEMA,
  initialIndex,
  type BacklogStoreManifest,
} from "./store.js";

export class StoreAlreadyExistsError extends Error {
  constructor(public readonly root: string) {
    super(`Backlog store already exists at ${root}`);
  }
}

export class StoreNotFoundError extends Error {
  constructor(public readonly root: string) {
    super(`No backlog store found at ${root}`);
  }
}

export class StoreParseError extends Error {
  constructor(public readonly root: string, cause: unknown) {
    super(`Invalid backlog store at ${root}: ${String(cause)}`);
  }
}

export function createStore(storeRoot: string, manifest: BacklogStoreManifest): void {
  mkdirSync(storeRoot, { recursive: true });
  const manifestFile = path.join(storeRoot, STORE_MANIFEST_FILE);
  if (existsSync(manifestFile)) throw new StoreAlreadyExistsError(storeRoot);
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  mkdirSync(path.join(storeRoot, ITEMS_DIR), { recursive: true });
  writeFileSync(path.join(storeRoot, INDEX_FILE), initialIndex());
}

export function loadStore(storeRoot: string): BacklogStoreManifest {
  const manifestFile = path.join(storeRoot, STORE_MANIFEST_FILE);
  if (!existsSync(manifestFile)) throw new StoreNotFoundError(storeRoot);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestFile, "utf8"));
  } catch (cause) {
    throw new StoreParseError(storeRoot, cause);
  }
  const manifest = parsed as BacklogStoreManifest;
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    manifest.schema !== STORE_SCHEMA
  ) {
    throw new StoreParseError(storeRoot, "unexpected schema");
  }
  return manifest;
}
