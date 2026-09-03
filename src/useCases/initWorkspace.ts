// Application use case: initialize a workspace shell.

import { mkdirSync } from "node:fs";
import path from "node:path";

import type { CliIO } from "../io.js";
import { newWorkspaceManifest } from "../catalog/workspace.js";
import {
  WorkspaceAlreadyExistsError,
  createWorkspaceManifestFile,
} from "../catalog/workspaceStore.js";

export function initWorkspace(targetArg: string | undefined, io: CliIO, cwd: string): number {
  const dir = path.resolve(cwd, targetArg ?? ".");
  mkdirSync(dir, { recursive: true });
  const name = path.basename(dir) || "workspace";
  try {
    createWorkspaceManifestFile(dir, newWorkspaceManifest(name));
  } catch (error) {
    if (error instanceof WorkspaceAlreadyExistsError) {
      io.stderr(`Error: ${error.message}`);
      return 1;
    }
    throw error;
  }
  io.stdout(`Initialized workspace "${name}" at ${dir}`);
  return 0;
}
