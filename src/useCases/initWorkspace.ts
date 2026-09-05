// Application use case: initialize a workspace shell.

import { lstatSync, mkdirSync, unlinkSync } from "node:fs";
import path from "node:path";

import type { CliIO } from "../io.js";
import { newWorkspaceManifest, workspaceRetrospectiveRoot } from "../catalog/workspace.js";
import { createRetrospectiveStore } from "../retrospective/retrospectiveFs.js";
import {
  createWorkspaceManifestFile,
  manifestPathFor,
} from "../catalog/workspaceStore.js";

export function initWorkspace(targetArg: string | undefined, json: boolean, io: CliIO, cwd: string): number {
  const dir = path.resolve(cwd, targetArg ?? ".");
  const name = path.basename(dir) || "workspace";
  const manifest = newWorkspaceManifest(name);
  let manifestCreated = false;
  try {
    mkdirSync(dir, { recursive: true });
    createWorkspaceManifestFile(dir, manifest);
    manifestCreated = true;
    createRetrospectiveStore(dir, workspaceRetrospectiveRoot(dir, manifest.retrospectives));
  } catch (error) {
    if (manifestCreated) removeCreatedManifest(dir);
    const message = error instanceof Error ? error.message : String(error);
    if (json) io.stdout(JSON.stringify({ ok: false, error: message }));
    else io.stderr(`Error: ${message}`);
    return 1;
  }
  if (json) {
    io.stdout(JSON.stringify({ ok: true, workspace: { name, manifest: ".pops/workspace.json" } }));
  } else {
    io.stdout(`Initialized workspace "${name}" at ${dir}`);
  }
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
