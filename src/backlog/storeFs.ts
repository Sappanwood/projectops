// Filesystem adapter for the backlog domain.

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  INDEX_FILE,
  ITEMS_DIR,
  STORE_MANIFEST_FILE,
  STORE_SCHEMA,
  initialIndex,
  isValidIdPrefix,
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
    !isValidIdPrefix(manifest.id_prefix)
  ) {
    throw new StoreParseError(storeRoot, "unexpected schema");
  }
  return manifest;
}

export function inspectStoreForInitialization(
  workspaceRoot: string,
  storeRoot: string,
): BacklogStoreManifest | null {
  requireDirectory(workspaceRoot, storeRoot);
  const entries = readdirSync(storeRoot);
  const targets = [STORE_MANIFEST_FILE, ITEMS_DIR, INDEX_FILE];
  if (targets.every((name) => !entries.includes(name))) return null;
  if (targets.some((name) => !entries.includes(name))) {
    throw new Error("Store already contains initialization files but is incomplete");
  }
  if (
    !lstatSync(path.join(storeRoot, STORE_MANIFEST_FILE)).isFile() ||
    !lstatSync(path.join(storeRoot, ITEMS_DIR)).isDirectory() ||
    !lstatSync(path.join(storeRoot, INDEX_FILE)).isFile()
  ) {
    throw new Error("Expected regular backlog.json, items directory and INDEX.md");
  }
  return loadStore(storeRoot);
}

export function acquireBacklogInitLock(workspaceRoot: string): () => void {
  requireDirectory(workspaceRoot, path.join(workspaceRoot, ".pops"));
  const runtime = path.join(workspaceRoot, ".pops/runtime");
  try {
    mkdirSync(runtime);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  requireDirectory(workspaceRoot, runtime);
  const lock = path.join(runtime, "backlog-init.lock");
  try {
    mkdirSync(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    throw new Error(
      "Backlog initialization is busy. Retry after it finishes. If interrupted, confirm no backlog init is running before removing the empty .pops/runtime/backlog-init.lock directory.",
    );
  }
  return () => rmdirSync(lock);
}

function requireDirectory(workspaceRoot: string, target: string): void {
  const relative = path.relative(workspaceRoot, target);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("Backlog initialization path is outside the workspace");
  }
  let current = workspaceRoot;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    if (!lstatSync(current).isDirectory()) {
      throw new Error(
        `Expected a regular directory at ${path.relative(workspaceRoot, current)}; inspect symlinks and file types`,
      );
    }
  }
}
