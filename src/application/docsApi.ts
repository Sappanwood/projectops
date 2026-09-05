import { getWorkspaceSummary } from "./workspaceApi.js";
import { loadWorkspace } from "../catalog/workspaceStore.js";
import { resolveProjectPath } from "../catalog/workspace.js";
import {
  DocumentReadError,
  listProjectDocuments,
  readProjectDocument,
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
