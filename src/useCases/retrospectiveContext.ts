// Shared helper: resolve the workspace-level Retrospective store from Manifest@1.

import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";

import {
  RETROSPECTIVE_ARTIFACT_TYPE,
  isWithinWorkspace,
  workspaceRetrospectiveRoot,
} from "../catalog/workspace.js";
import type { CliIO } from "../io.js";
import { loadOrReport } from "./workspaceContext.js";

export function resolveRetrospectivesRoot(
  io: CliIO,
  cwd: string,
  requireExisting = false,
): string | null {
  const workspace = loadOrReport(cwd, io);
  if (workspace === null) return null;
  const { root, manifest } = workspace;
  if (manifest.retrospectives.type !== RETROSPECTIVE_ARTIFACT_TYPE) {
    io.stderr(`Error: retrospectives artifact type must be ${RETROSPECTIVE_ARTIFACT_TYPE}`);
    return null;
  }
  const target = workspaceRetrospectiveRoot(root, manifest.retrospectives);
  try {
    const workspaceCanonical = realpathSync(root);
    if (inspectStaticPath(root, target, requireExisting) === "missing") {
      return target;
    }
    if (!isWithinWorkspace(workspaceCanonical, realpathSync(target))) {
      io.stderr("Error: retrospectives root resolves outside the workspace");
      return null;
    }
  } catch (error) {
    if (!requireExisting && isErrno(error, "ENOENT")) return target;
    io.stderr(`Error: retrospectives root cannot be resolved: ${formatFsError(error)}`);
    return null;
  }
  return target;
}

function isErrno(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function formatFsError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function inspectStaticPath(workspaceRoot: string, target: string, requireExisting: boolean): "existing" | "missing" {
  const relative = path.relative(workspaceRoot, target);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("retrospectives root resolves outside the workspace");
  }

  let current = workspaceRoot;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if (isErrno(error, "ENOENT")) {
        if (requireExisting) throw new Error("retrospectives root does not exist");
        return "missing";
      }
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error("retrospectives root path contains a symlink");
    if (!stat.isDirectory()) throw new Error("retrospectives root is not a directory");
  }
  return "existing";
}
