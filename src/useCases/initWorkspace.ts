// Application use case: initialize a workspace shell.

import { lstatSync, mkdirSync, unlinkSync } from "node:fs";
import path from "node:path";

import type { CliIO } from "../io.js";
import { newWorkspaceManifest, workspaceRetrospectiveRoot } from "../catalog/workspace.js";
import { createRetrospectiveStore, RetrospectiveRootError, RetrospectiveStoreAlreadyExistsError } from "../retrospective/retrospectiveFs.js";
import {
  WorkspaceAlreadyExistsError,
  createWorkspaceManifestFile,
  manifestPathFor,
} from "../catalog/workspaceStore.js";

export function initWorkspace(targetArg: string | undefined, io: CliIO, cwd: string): number {
  const dir = path.resolve(cwd, targetArg ?? ".");
  mkdirSync(dir, { recursive: true });
  const name = path.basename(dir) || "workspace";
  const manifest = newWorkspaceManifest(name);
  let manifestCreated = false;
  try {
    createWorkspaceManifestFile(dir, manifest);
    manifestCreated = true;
    createRetrospectiveStore(dir, workspaceRetrospectiveRoot(dir, manifest.retrospectives));
  } catch (error) {
    if (manifestCreated) removeCreatedManifest(dir);
    if (error instanceof WorkspaceAlreadyExistsError) {
      io.stderr(`Error: ${error.message}`);
      return 1;
    }
    if (error instanceof RetrospectiveStoreAlreadyExistsError || error instanceof RetrospectiveRootError) {
      io.stderr(`Error: ${error.message}`);
      return 1;
    }
    throw error;
  }
  io.stdout(`Initialized workspace "${name}" at ${dir}`);
  return 0;
}

function removeCreatedManifest(root: string): void {
  const file = manifestPathFor(root);
  try {
    const stat = lstatSync(file);
    if (stat.isFile() && !stat.isSymbolicLink()) unlinkSync(file);
  } catch {
    // Best-effort cleanup preserves the original bootstrap diagnostic.
  }
}
