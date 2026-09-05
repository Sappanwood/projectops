// Shared helper: resolve the plans root of a registered project.

import { realpathSync } from "node:fs";

import { isWithinWorkspace, projectArtifactRoots } from "../catalog/workspace.js";
import type { CliIO } from "../io.js";
import { PLAN_SCHEMA } from "../plan/plan.js";
import { loadOrReport } from "./workspaceContext.js";

export function resolvePlansRoot(
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
  const plansType = workspace.manifest.artifact_layout.roots.plans;
  if (plansType !== PLAN_SCHEMA) {
    io.stderr(`Error: plans artifact type must be ${PLAN_SCHEMA}, got ${plansType ?? "missing"}`);
    return null;
  }
  const plansRoot = projectArtifactRoots(
    workspace.root,
    projectId,
    workspace.manifest.artifact_layout,
  ).plans;
  if (!requireWritableContainment) return plansRoot;

  try {
    if (!isWithinWorkspace(realpathSync(workspace.root), realpathSync(plansRoot))) {
      io.stderr("Error: plans root resolves outside the workspace");
      return null;
    }
  } catch {
    io.stderr("Error: plans root cannot be resolved");
    return null;
  }
  return plansRoot;
}
