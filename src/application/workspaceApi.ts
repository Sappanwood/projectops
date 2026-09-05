import {
  ManifestParseError,
  WorkspaceNotFoundError,
  loadWorkspace,
} from "../catalog/workspaceStore.js";
import { applicationFailure, applicationSuccess, type ApplicationResult } from "./result.js";

export type WorkspaceProjectSummary = {
  id: string;
  path: string;
};

export type WorkspaceSummary = {
  name: string;
  projects: WorkspaceProjectSummary[];
};

export type GetWorkspaceSummaryRequest = {
  workspaceDir: string;
};

export function getWorkspaceSummary(
  request: GetWorkspaceSummaryRequest,
): ApplicationResult<WorkspaceSummary> {
  try {
    const { manifest } = loadWorkspace(request.workspaceDir);
    const projects = Object.entries(manifest.projects)
      .map(([id, registration]) => ({ id, path: registration.path }))
      .sort((left, right) => left.id.localeCompare(right.id));
    return applicationSuccess({ name: manifest.name, projects });
  } catch (error) {
    if (error instanceof WorkspaceNotFoundError) {
      return applicationFailure("WORKSPACE_NOT_FOUND", "Workspace not found.");
    }
    if (error instanceof ManifestParseError) {
      return applicationFailure("WORKSPACE_INVALID", "Workspace manifest is invalid.");
    }
    throw error;
  }
}
