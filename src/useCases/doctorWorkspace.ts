// Application use case: validate workspace topology.

import { existsSync, lstatSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

import type { CliIO } from "../io.js";
import {
  ARTIFACT_KEYS,
  ARTIFACT_TYPES,
  projectArtifactRoots,
  resolveProjectPath,
  RETROSPECTIVE_ARTIFACT_TYPE,
  isWithinWorkspace,
  workspaceRetrospectiveRoot,
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
  if (manifest.retrospectives.type !== RETROSPECTIVE_ARTIFACT_TYPE) {
    problems.push({
      project: "workspace",
      issue: `retrospectives artifact type mismatch: expected ${RETROSPECTIVE_ARTIFACT_TYPE}, got ${manifest.retrospectives.type ?? "missing"}`,
    });
  } else {
    const retrospectivesRoot = workspaceRetrospectiveRoot(root, manifest.retrospectives);
    const issue = retrospectiveRootProblem(root, retrospectivesRoot);
    if (issue !== null) problems.push({ project: "workspace", issue });
  }
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

function retrospectiveRootProblem(workspaceRoot: string, target: string): string | null {
  const relative = path.relative(workspaceRoot, target);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    return "retrospectives root resolves outside the workspace";
  }

  let current = workspaceRoot;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if (isErrno(error, "ENOENT")) return "missing retrospectives root";
      return `retrospectives root cannot be inspected: ${formatFsError(error)}`;
    }
    if (stat.isSymbolicLink()) return "retrospectives root path contains a symlink";
    if (!stat.isDirectory()) return "retrospectives root is not a directory";
  }

  try {
    if (!isWithinWorkspace(realpathSync(workspaceRoot), realpathSync(target))) {
      return "retrospectives root resolves outside the workspace";
    }
  } catch (error) {
    return `retrospectives root cannot be resolved: ${formatFsError(error)}`;
  }
  return null;
}

function isErrno(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function formatFsError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
