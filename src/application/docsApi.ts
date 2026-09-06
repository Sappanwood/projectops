import { getWorkspaceSummary } from "./workspaceApi.js";
import { loadWorkspace } from "../catalog/workspaceStore.js";
import { projectArtifactRoots, resolveProjectPath } from "../catalog/workspace.js";
import {
  DocumentReadError,
  listProjectDocuments,
  listResearchDocuments,
  readProjectDocument,
  readResearchDocument,
  type DocumentList,
  type ProjectDocument,
} from "../docs/documentReader.js";
import { applicationFailure, applicationSuccess, type ApplicationResult } from "./result.js";

type DocsRequest = { workspaceDir: string; projectId: string };
function context<T>(
  request: DocsRequest,
  read: (workspace: string, project: string) => T,
): ApplicationResult<T> {
  const summary = getWorkspaceSummary(request);
  if (!summary.ok) return summary;
  const project = summary.data.projects.find((p) => p.id === request.projectId);
  if (!project) return applicationFailure("PROJECT_NOT_FOUND", "项目未登记。");
  try {
    const workspace = loadWorkspace(request.workspaceDir);
    return applicationSuccess(
      read(workspace.root, resolveProjectPath(workspace.root, project.path)),
    );
  } catch (error) {
    return error instanceof DocumentReadError
      ? applicationFailure(error.code, error.message)
      : applicationFailure("DOCUMENT_UNAVAILABLE", "项目文档无法读取。");
  }
}
export function listDocuments(request: DocsRequest): ApplicationResult<DocumentList> {
  return context(request, listProjectDocuments);
}
export function showDocument(
  request: DocsRequest & { path: string },
): ApplicationResult<ProjectDocument> {
  return context(request, (workspace, project) =>
    readProjectDocument(workspace, project, request.path),
  );
}

type ResearchRequest = { workspaceDir: string; projectId: string };
function researchContext<T>(
  request: ResearchRequest,
  read: (workspace: string, researchRoot: string) => T,
): ApplicationResult<T> {
  const summary = getWorkspaceSummary(request);
  if (!summary.ok) return summary;
  const project = summary.data.projects.find((p) => p.id === request.projectId);
  if (!project) return applicationFailure("PROJECT_NOT_FOUND", "项目未登记。");
  try {
    const workspace = loadWorkspace(request.workspaceDir);
    if (workspace.manifest.artifact_layout.roots.research !== "markdown/research@1")
      return applicationFailure(
        "DOCUMENT_UNAVAILABLE",
        `Research artifact type must be markdown/research@1, got ${workspace.manifest.artifact_layout.roots.research ?? "missing"}.`,
      );
    const roots = projectArtifactRoots(
      workspace.root,
      request.projectId,
      workspace.manifest.artifact_layout,
    );
    return applicationSuccess(read(workspace.root, roots.research));
  } catch (error) {
    return error instanceof DocumentReadError
      ? applicationFailure(error.code, error.message)
      : applicationFailure("DOCUMENT_UNAVAILABLE", "Research 文档无法读取。");
  }
}

export function listResearch(request: ResearchRequest): ApplicationResult<DocumentList> {
  return researchContext(request, listResearchDocuments);
}

export function showResearch(
  request: ResearchRequest & { path: string },
): ApplicationResult<ProjectDocument> {
  return researchContext(request, (workspace, root) =>
    readResearchDocument(workspace, root, request.path),
  );
}
