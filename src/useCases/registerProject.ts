// Application use case: explicitly register a project directory in a workspace.

import { mkdirSync } from "node:fs";
import path from "node:path";

import type { CliIO } from "../io.js";
import {
  isWithinWorkspace,
  projectArtifactRoots,
  slugifyProjectId,
  toPosixPath,
} from "../catalog/workspace.js";
import { saveWorkspace } from "../catalog/workspaceStore.js";
import { loadOrReport } from "./workspaceContext.js";

export function registerProject(pathArg: string, json: boolean, io: CliIO, cwd: string): number {
  const workspace = loadOrReport(cwd, io);
  if (workspace === null) return 1;
  const { root, manifest } = workspace;
  const target = path.resolve(cwd, pathArg);

  const relToRoot = path.relative(root, target);
  if (relToRoot === "") {
    io.stderr("Error: the workspace root itself cannot be registered as a project");
    return 1;
  }
  if (!isWithinWorkspace(root, target)) {
    io.stderr(`Error: target path is outside the workspace: ${target}`);
    return 1;
  }
  const id = slugifyProjectId(path.basename(target));
  if (id === "") {
    io.stderr(`Error: directory name cannot produce a valid project id: ${path.basename(target)}`);
    return 1;
  }
  const rel = toPosixPath(path.relative(root, target));
  if (Object.hasOwn(manifest.projects, id)) {
    io.stderr(`Error: project "${id}" is already registered`);
    return 1;
  }

  const roots = projectArtifactRoots(root, id, manifest.artifact_layout);
  for (const dir of Object.values(roots)) {
    mkdirSync(dir, { recursive: true });
  }
  manifest.projects[id] = { path: rel };
  saveWorkspace(root, manifest);

  const summary = {
    ok: true,
    project: {
      id,
      path: rel,
      roots: Object.fromEntries(
        Object.entries(roots).map(([key, abs]) => [key, toPosixPath(path.relative(root, abs))]),
      ),
    },
  };
  if (json) {
    io.stdout(JSON.stringify(summary));
  } else {
    io.stdout(`Registered project "${id}" at ${rel}`);
  }
  return 0;
}
