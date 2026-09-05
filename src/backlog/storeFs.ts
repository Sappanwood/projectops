// Filesystem adapter for the backlog domain.

import { existsSync, mkdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
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
  constructor(
    public readonly root: string,
    cause: unknown,
  ) {
    super(`Invalid backlog store at ${root}: ${String(cause)}`);
  }
}

export function createStore(storeRoot: string, manifest: BacklogStoreManifest): void {
  mkdirSync(storeRoot, { recursive: true });
  const manifestFile = path.join(storeRoot, STORE_MANIFEST_FILE);
  const itemsDir = path.join(storeRoot, ITEMS_DIR);
  const indexFile = path.join(storeRoot, INDEX_FILE);
  if ([manifestFile, itemsDir, indexFile].some((entry) => existsSync(entry))) {
    throw new StoreAlreadyExistsError(storeRoot);
  }

  let manifestCreated = false;
  let itemsCreated = false;
  let indexCreated = false;
  try {
    writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
    manifestCreated = true;
    mkdirSync(itemsDir);
    itemsCreated = true;
    writeFileSync(indexFile, initialIndex(), { flag: "wx" });
    indexCreated = true;
  } catch (cause) {
    if (indexCreated) unlinkSync(indexFile);
    if (itemsCreated) rmdirSync(itemsDir);
    if (manifestCreated) unlinkSync(manifestFile);
    if ((cause as NodeJS.ErrnoException).code === "EEXIST") {
      throw new StoreAlreadyExistsError(storeRoot);
    }
    throw cause;
  }
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
    manifest.schema !== STORE_SCHEMA ||
    typeof manifest.project_id !== "string" ||
    manifest.project_id === "" ||
    typeof manifest.id_prefix !== "string" ||
    !/^[A-Z0-9]+$/.test(manifest.id_prefix)
  ) {
    throw new StoreParseError(storeRoot, "unexpected schema");
  }
  return manifest;
}
