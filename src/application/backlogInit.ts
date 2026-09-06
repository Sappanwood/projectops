import path from "node:path";
import { deriveIdPrefix, isValidIdPrefix, newStoreManifest } from "../backlog/store.js";
import {
  acquireBacklogInitLock,
  createStore,
  inspectStoreForInitialization,
} from "../backlog/storeFs.js";
import { ARTIFACT_TYPES, projectArtifactRoots, toPosixPath } from "../catalog/workspace.js";
import { loadWorkspace } from "../catalog/workspaceStore.js";

export function initializeBacklog(
  workspaceRoot: string,
  projectId: string,
  requestedPrefix?: string,
): { project_id: string; id_prefix: string; root: string } {
  if (requestedPrefix !== undefined && !isValidIdPrefix(requestedPrefix)) {
    throw new Error(
      "--id-prefix must be non-empty ASCII uppercase letters or digits (A-Z, 0-9); input is not normalized",
    );
  }
  let release: (() => void) | undefined;
  try {
    release = acquireBacklogInitLock(workspaceRoot);
    const { manifest } = loadWorkspace(workspaceRoot);
    if (!Object.hasOwn(manifest.projects, projectId)) {
      throw new Error(`Project "${projectId}" is not registered`);
    }
    if (manifest.artifact_layout.roots.backlog !== ARTIFACT_TYPES.backlog) {
      throw new Error(
        `Backlog artifact type must be ${ARTIFACT_TYPES.backlog}; correct the workspace manifest descriptor`,
      );
    }
    const storeRoot = projectArtifactRoots(
      workspaceRoot,
      projectId,
      manifest.artifact_layout,
    ).backlog;
    const occupied = new Map<string, string[]>();
    const projects = [
      projectId,
      ...Object.keys(manifest.projects)
        .filter((id) => id !== projectId)
        .sort(),
    ];
    for (const id of projects) {
      const root = projectArtifactRoots(workspaceRoot, id, manifest.artifact_layout).backlog;
      const relative = toPosixPath(path.relative(workspaceRoot, root));
      let store;
      try {
        store = inspectStoreForInitialization(workspaceRoot, root);
        if (store !== null && store.project_id !== id) {
          throw new Error(`project_id must be "${id}", got "${store.project_id}"`);
        }
      } catch (error) {
        throw new Error(
          `Cannot inspect backlog for project "${id}" at ${relative}: ${error instanceof Error ? error.message : String(error)}. Inspect permissions and repair or restore this store before retrying.`,
        );
      }
      if (store === null) continue;
      if (id === projectId)
        throw new Error(`Backlog store already exists for "${id}" at ${relative}`);
      const owners = occupied.get(store.id_prefix) ?? [];
      owners.push(id);
      occupied.set(store.id_prefix, owners);
    }
    if (requestedPrefix !== undefined && occupied.has(requestedPrefix)) {
      throw new Error(
        `Backlog id-prefix "${requestedPrefix}" is already used by project(s): ${occupied.get(requestedPrefix)!.join(", ")}. Choose another --id-prefix.`,
      );
    }
    const prefix = requestedPrefix ?? deriveIdPrefix(projectId, new Set(occupied.keys()));
    const store = newStoreManifest(projectId, prefix);
    createStore(storeRoot, store);
    return {
      project_id: store.project_id,
      id_prefix: store.id_prefix,
      root: toPosixPath(path.relative(workspaceRoot, storeRoot)),
    };
  } catch (error) {
    throw new Error(
      (error instanceof Error ? error.message : String(error)).replaceAll(workspaceRoot, "."),
    );
  } finally {
    release?.();
  }
}
