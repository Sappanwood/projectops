// Shared helper: resolve the backlog store of a registered project.

import type { CliIO } from "../io.js";
import { loadStore, StoreNotFoundError } from "../backlog/storeFs.js";
import type { BacklogStoreManifest } from "../backlog/store.js";
import { projectArtifactRoots } from "../catalog/workspace.js";
import { loadOrReport } from "./workspaceContext.js";

export function resolveStoreRoot(
  projectId: string,
  io: CliIO,
  cwd: string,
): { root: string; manifest: BacklogStoreManifest } | null {
  const workspace = loadOrReport(cwd, io);
  if (workspace === null) return null;
  const { root, manifest } = workspace;
  if (manifest.projects[projectId] === undefined) {
    io.stderr(`Error: project "${projectId}" is not registered`);
    return null;
  }
  const roots = projectArtifactRoots(root, projectId, manifest.artifact_layout);
  const storeRoot = roots.backlog;
  try {
    return { root: storeRoot, manifest: loadStore(storeRoot) };
  } catch (error) {
    if (error instanceof StoreNotFoundError) {
      io.stderr(`Error: ${error.message}. Run "pops backlog init ${projectId}" first.`);
      return null;
    }
    throw error;
  }
}
