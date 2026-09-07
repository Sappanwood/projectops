import { inspectDevConfiguration } from "./devApi.js";
import { existsSync, lstatSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

import {
  ARTIFACT_KEYS,
  ARTIFACT_TYPES,
  projectArtifactRoots,
  resolveProjectPath,
  RETROSPECTIVE_ARTIFACT_TYPE,
  isWithinWorkspace,
  workspaceRetrospectiveRoot,
} from "../catalog/workspace.js";
import {
  ManifestParseError,
  WorkspaceNotFoundError,
  loadWorkspace,
} from "../catalog/workspaceStore.js";
import { applicationFailure, applicationSuccess, type ApplicationResult } from "./result.js";

export type WorkspaceProblem = {
  project: string;
  issue: string;
};

export type WorkspaceInspection = {
  healthy: boolean;
  problems: WorkspaceProblem[];
};

export function inspectWorkspace(request: {
  workspaceDir: string;
}): ApplicationResult<WorkspaceInspection> {
  let workspace;
  try {
    workspace = loadWorkspace(request.workspaceDir);
  } catch (error) {
    if (error instanceof WorkspaceNotFoundError) {
      return applicationFailure("WORKSPACE_NOT_FOUND", "Workspace not found.");
    }
    if (error instanceof ManifestParseError) {
      return applicationFailure("WORKSPACE_INVALID", "Workspace manifest is invalid.");
    }
    throw error;
  }

  const { root, manifest } = workspace;
  const problems: WorkspaceProblem[] = [...inspectDevConfiguration(root).problems];
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
  for (const [id, registration] of Object.entries(manifest.projects).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const projectDir = resolveProjectPath(root, registration.path);
    if (!existsSync(projectDir)) {
      problems.push({ project: id, issue: `project directory missing: ${registration.path}` });
      continue;
    }
    if (!statSync(projectDir).isDirectory()) {
      problems.push({
        project: id,
        issue: `project path is not a directory: ${registration.path}`,
      });
      continue;
    }
    const roots = projectArtifactRoots(root, id, manifest.artifact_layout);
    for (const [key, directory] of Object.entries(roots)) {
      if (!existsSync(directory)) {
        problems.push({ project: id, issue: `missing artifact root: ${key}` });
      } else if (!statSync(directory).isDirectory()) {
        problems.push({ project: id, issue: `artifact root ${key} is not a directory` });
      }
    }
  }

  return applicationSuccess({ healthy: problems.length === 0, problems });
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
      return "retrospectives root cannot be inspected";
    }
    if (stat.isSymbolicLink()) return "retrospectives root path contains a symlink";
    if (!stat.isDirectory()) return "retrospectives root is not a directory";
  }

  try {
    if (!isWithinWorkspace(realpathSync(workspaceRoot), realpathSync(target))) {
      return "retrospectives root resolves outside the workspace";
    }
  } catch {
    return "retrospectives root cannot be resolved";
  }
  return null;
}

function isErrno(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
