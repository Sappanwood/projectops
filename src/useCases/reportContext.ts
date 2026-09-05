// Shared helper: resolve the reports root of a registered project.

import { realpathSync } from "node:fs";

import { isWithinWorkspace, projectArtifactRoots } from "../catalog/workspace.js";
import type { CliIO } from "../io.js";
import { loadOrReport } from "./workspaceContext.js";

export const REPORT_ARTIFACT_TYPE = "markdown/report@1";

export function resolveReportsRoot(
  projectId: string,
  io: CliIO,
  cwd: string,
  requireWritableContainment = false,
): string | null {
  const workspace = loadOrReport(cwd, io);
  if (workspace === null) return null;
  if (!Object.hasOwn(workspace.manifest.projects, projectId)) {
    io.stderr(`Error: project "${projectId}" is not registered`);
    return null;
  }
  const reportsType = workspace.manifest.artifact_layout.roots.reports;
  if (reportsType !== REPORT_ARTIFACT_TYPE) {
    io.stderr(
      `Error: reports artifact type must be ${REPORT_ARTIFACT_TYPE}, got ${reportsType ?? "missing"}`,
    );
    return null;
  }
  const reportsRoot = projectArtifactRoots(
    workspace.root,
    projectId,
    workspace.manifest.artifact_layout,
  ).reports;
  if (!requireWritableContainment) return reportsRoot;

  try {
    if (!isWithinWorkspace(realpathSync(workspace.root), realpathSync(reportsRoot))) {
      io.stderr("Error: reports root resolves outside the workspace");
      return null;
    }
  } catch {
    io.stderr("Error: reports root cannot be resolved");
    return null;
  }
  return reportsRoot;
}
