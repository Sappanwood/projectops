// Application use case: validate workspace topology.

import { existsSync } from "node:fs";

import type { CliIO } from "../io.js";
import { projectArtifactRoots, resolveProjectPath } from "../catalog/workspace.js";
import { loadOrReport } from "./workspaceContext.js";

export type WorkspaceProblem = {
  project: string;
  issue: string;
};

export function doctorWorkspace(json: boolean, io: CliIO, cwd: string): number {
  const workspace = loadOrReport(cwd, io);
  if (workspace === null) return 1;
  const { root, manifest } = workspace;

  const problems: WorkspaceProblem[] = [];
  for (const [id, registration] of Object.entries(manifest.projects)) {
    const projectDir = resolveProjectPath(root, registration.path);
    if (!existsSync(projectDir)) {
      problems.push({ project: id, issue: `project directory missing: ${registration.path}` });
      continue;
    }
    const roots = projectArtifactRoots(root, id, manifest.artifact_layout);
    for (const [key, dir] of Object.entries(roots)) {
      if (!existsSync(dir)) {
        problems.push({ project: id, issue: `missing artifact root: ${key}` });
      }
    }
  }

  const ok = problems.length === 0;
  if (json) {
    io.stdout(JSON.stringify({ ok, problems }));
  } else if (ok) {
    io.stdout("Workspace is healthy");
  } else {
    for (const problem of problems) {
      io.stdout(`${problem.project}: ${problem.issue}`);
    }
  }
  return ok ? 0 : 1;
}
