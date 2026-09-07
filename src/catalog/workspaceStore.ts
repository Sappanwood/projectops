// Filesystem adapter for the catalog domain.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { validateDevDescriptor } from "../dev/config.js";

import {
  isProjectId,
  MANIFEST_DIR,
  MANIFEST_FILE,
  RETROSPECTIVE_ARTIFACT_TYPE,
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
  constructor(
    public readonly root: string,
    cause: unknown,
  ) {
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
  const problem = validateManifest(parsed);
  if (problem !== null) throw new ManifestParseError(root, problem);
  return { root, manifest: parsed as WorkspaceManifest };
}

function validateManifest(value: unknown): string | null {
  if (!isRecord(value) || value.schema !== WORKSPACE_SCHEMA) return "unexpected schema";
  if (typeof value.name !== "string" || value.name === "") return "invalid name";
  if (!isRecord(value.artifact_layout)) return "invalid artifact_layout";
  if (!isSafeRelativePath(value.artifact_layout.ops_root))
    return "invalid artifact_layout.ops_root";
  if (!isRecord(value.artifact_layout.roots)) return "invalid artifact_layout.roots";
  for (const [key, type] of Object.entries(value.artifact_layout.roots)) {
    if (typeof type !== "string") return `invalid artifact type for ${key}`;
  }
  if (
    !isRecord(value.retrospectives) ||
    value.retrospectives.type !== RETROSPECTIVE_ARTIFACT_TYPE ||
    !isSafeRelativePath(value.retrospectives.root)
  ) {
    return "invalid retrospectives descriptor";
  }
  if (!isRecord(value.projects)) return "invalid projects";
  for (const [id, registration] of Object.entries(value.projects)) {
    if (!isProjectId(id)) return `invalid project id: ${id}`;
    if (!isRecord(registration) || !isSafeRelativePath(registration.path)) {
      return `invalid project registration: ${id}`;
    }
    if (registration.dev !== undefined) {
      const problem = validateDevDescriptor(registration.dev);
      if (problem) return `${id}: ${problem}`;
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeRelativePath(value: unknown): value is string {
  if (typeof value !== "string" || value === "" || value.includes("\\")) return false;
  const parts = value.split("/");
  return (
    !value.startsWith("/") && parts.every((part) => part !== "" && part !== "." && part !== "..")
  );
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
