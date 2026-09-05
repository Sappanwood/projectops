// Application use case: bootstrap a backlog store for a registered project.

import path from "node:path";

import type { CliIO } from "../io.js";
import { createStore, StoreAlreadyExistsError } from "../backlog/storeFs.js";
import { deriveIdPrefix, newStoreManifest } from "../backlog/store.js";
import { projectArtifactRoots, toPosixPath } from "../catalog/workspace.js";
import { loadOrReport } from "./workspaceContext.js";

export function initBacklog(
  projectId: string | undefined,
  json: boolean,
  io: CliIO,
  cwd: string,
): number {
  if (projectId === undefined) {
    io.stderr("Usage: pops backlog init <project-id> [--json]");
    return 1;
  }
  const workspace = loadOrReport(cwd, io);
  if (workspace === null) return 1;
  const { root, manifest } = workspace;

  if (!Object.hasOwn(manifest.projects, projectId)) {
    io.stderr(`Error: project "${projectId}" is not registered`);
    return 1;
  }
  const roots = projectArtifactRoots(root, projectId, manifest.artifact_layout);
  const storeRoot = roots.backlog;
  try {
    createStore(storeRoot, newStoreManifest(projectId));
  } catch (error) {
    if (error instanceof StoreAlreadyExistsError) {
      io.stderr(`Error: ${error.message}`);
      return 1;
    }
    throw error;
  }

  const relRoot = toPosixPath(path.relative(root, storeRoot));
  const store = {
    project_id: projectId,
    id_prefix: deriveIdPrefix(projectId),
    root: relRoot,
  };
  if (json) {
    io.stdout(JSON.stringify({ ok: true, store }));
  } else {
    io.stdout(`Initialized backlog store for "${projectId}" at ${relRoot}`);
  }
  return 0;
}
