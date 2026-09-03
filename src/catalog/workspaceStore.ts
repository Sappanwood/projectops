// Filesystem adapter for the catalog domain.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  MANIFEST_DIR,
  MANIFEST_FILE,
  WORKSPACE_SCHEMA,
  type WorkspaceManifest,
} from "./workspace.js";

export class WorkspaceAlreadyExistsError extends Error {
  constructor(public readonly root: string) {
    super(`Workspace already exists at ${root}`);
  }
}

export class WorkspaceNotFoundError extends Error {
  constructor(public readonly startDir: string) {
    super(`No workspace found at or above ${startDir}`);
  }
}

export class ManifestParseError extends Error {
  constructor(public readonly root: string, cause: unknown) {
    super(`Invalid workspace manifest at ${root}: ${String(cause)}`);
  }
}

export function manifestPathFor(root: string): string {
  return path.join(root, MANIFEST_DIR, MANIFEST_FILE);
}

export function findWorkspaceRoot(startDir: string): string | null {
  let dir = path.resolve(startDir);
  for (;;) {
    if (existsSync(manifestPathFor(dir))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function loadWorkspace(startDir: string): {
  root: string;
  manifest: WorkspaceManifest;
} {
  const root = findWorkspaceRoot(startDir);
  if (root === null) throw new WorkspaceNotFoundError(startDir);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPathFor(root), "utf8"));
  } catch (cause) {
    throw new ManifestParseError(root, cause);
  }
  const manifest = parsed as WorkspaceManifest;
  if (typeof manifest !== "object" || manifest === null || manifest.schema !== WORKSPACE_SCHEMA) {
    throw new ManifestParseError(root, "unexpected schema");
  }
  return { root, manifest };
}

export function serializeManifest(manifest: WorkspaceManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function createWorkspaceManifestFile(root: string, manifest: WorkspaceManifest): void {
  const popsDir = path.join(root, MANIFEST_DIR);
  mkdirSync(popsDir, { recursive: true });
  try {
    writeFileSync(manifestPathFor(root), serializeManifest(manifest), { flag: "wx" });
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "EEXIST") {
      throw new WorkspaceAlreadyExistsError(root);
    }
    throw cause;
  }
}

export function saveWorkspace(root: string, manifest: WorkspaceManifest): void {
  writeFileSync(manifestPathFor(root), serializeManifest(manifest));
}
