// Application use case: validate workspace topology.

import { existsSync, statSync } from "node:fs";

import type { CliIO } from "../io.js";
import {
  ARTIFACT_KEYS,
  ARTIFACT_TYPES,
  projectArtifactRoots,
  resolveProjectPath,
} from "../catalog/workspace.js";
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
  for (const key of ARTIFACT_KEYS) {
    const actual = manifest.artifact_layout.roots[key];
    const expected = ARTIFACT_TYPES[key];
    if (actual !== expected) {
      problems.push({
        project: "workspace",
        issue: `artifact ${key} type mismatch: expected ${expected}, got ${actual ?? "missing"}`,
      });
    }
  }
  for (const key of Object.keys(manifest.artifact_layout.roots)) {
    if (!ARTIFACT_KEYS.includes(key as (typeof ARTIFACT_KEYS)[number])) {
      problems.push({ project: "workspace", issue: `unexpected artifact type: ${key}` });
    }
  }
  for (const [id, registration] of Object.entries(manifest.projects)) {
    const projectDir = resolveProjectPath(root, registration.path);
    if (!existsSync(projectDir)) {
      problems.push({ project: id, issue: `project directory missing: ${registration.path}` });
      continue;
    }
    if (!statSync(projectDir).isDirectory()) {
      problems.push({ project: id, issue: `project path is not a directory: ${registration.path}` });
      continue;
    }
    const roots = projectArtifactRoots(root, id, manifest.artifact_layout);
    for (const [key, dir] of Object.entries(roots)) {
      if (!existsSync(dir)) {
        problems.push({ project: id, issue: `missing artifact root: ${key}` });
      } else if (!statSync(dir).isDirectory()) {
        problems.push({ project: id, issue: `artifact root ${key} is not a directory` });
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
