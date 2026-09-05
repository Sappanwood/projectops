import type { Plan } from "../plan/plan.js";
import type { Report } from "../report/report.js";
import { PROJECT_DOC_TEMPLATES } from "../docs/projectDocs.js";
import {
  ITEM_STATUSES,
  type ItemStatus,
} from "../backlog/item.js";
import {
  projectArtifactRoots,
  resolveProjectPath,
  workspaceRetrospectiveRoot,
} from "../catalog/workspace.js";
import {
  ManifestParseError,
  WorkspaceNotFoundError,
  loadWorkspace,
} from "../catalog/workspaceStore.js";
import {
  checkProjectDocs,
  ProjectDocsCheckError,
  type ProjectDocsProblem,
} from "../docs/projectDocsFs.js";
import { listPlanIds, readPlan } from "../plan/planFs.js";
import { listReportIds, readReport } from "../report/reportFs.js";
import {
  listRetrospectiveRecords,
} from "../retrospective/retrospectiveFs.js";
import type { RetrospectiveRecord, RetrospectiveStatus } from "../retrospective/retrospective.js";
import { listBacklogItems, type BacklogItemSummary } from "./backlogApi.js";
import { applicationFailure, applicationSuccess, type ApplicationResult } from "./result.js";
import { inspectWorkspace } from "./workspaceInspection.js";
import { getWorkspaceSummary, type WorkspaceProjectSummary } from "./workspaceApi.js";

export type WorkbenchDiagnosticSource =
  | "workspace"
  | "backlog"
  | "plans"
  | "reports"
  | "docs"
  | "retrospectives";

export type WorkbenchDiagnostic = {
  source: WorkbenchDiagnosticSource;
  code: string;
  message: string;
  reference?: string;
};

export type WorkbenchWorkspaceOverview = {
  workspace: { name: string };
  projects: WorkspaceProjectSummary[];
  diagnostics: WorkbenchDiagnostic[];
};

export type WorkbenchBacklogSummary = Pick<
  BacklogItemSummary,
  "id" | "title" | "item_type" | "parent_id" | "priority" | "status" | "depends_on" | "updated" | "revision"
>;

export type WorkbenchProjectOverview = {
  project: WorkspaceProjectSummary;
  backlog: {
    counts: Record<ItemStatus, number>;
    recent: WorkbenchBacklogSummary[];
  };
  plans: Array<{
    id: string;
    title: string;
    status: string;
    item_count: number;
  }>;
  reports: Array<{
    id: string;
    title: string;
    outcome: string;
    created_at: string;
  }>;
  docs: {
    healthy: boolean;
    problems: ProjectDocsProblem[];
  };
  retrospectives: {
    counts: Record<RetrospectiveStatus, number>;
    recent: Array<{
      id: string;
      status: RetrospectiveStatus;
      created_at: string;
      path: string;
    }>;
  };
  diagnostics: WorkbenchDiagnostic[];
};

export function getWorkbenchWorkspaceOverview(
  request: { workspaceDir: string },
): ApplicationResult<WorkbenchWorkspaceOverview> {
  const summary = getWorkspaceSummary(request);
  if (!summary.ok) return summary;
  const inspection = inspectWorkspace(request);
  if (!inspection.ok) return inspection;

  const diagnostics = inspection.data.problems.map((problem): WorkbenchDiagnostic => ({
    source: "workspace",
    code: "WORKSPACE_PROBLEM",
    message: `${problem.project}: ${problem.issue}`,
  }));
  return applicationSuccess({
    workspace: { name: summary.data.name },
    projects: summary.data.projects,
    diagnostics: sortDiagnostics(diagnostics),
  });
}

export function getWorkbenchProjectOverview(
  request: { workspaceDir: string; projectId: string },
): ApplicationResult<WorkbenchProjectOverview> {
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
  if (!Object.hasOwn(workspace.manifest.projects, request.projectId)) {
    return applicationFailure("PROJECT_NOT_FOUND", `Project "${request.projectId}" is not registered.`);
  }
  const registration = workspace.manifest.projects[request.projectId]!;

  const diagnostics: WorkbenchDiagnostic[] = [];
  const inspection = inspectWorkspace({ workspaceDir: request.workspaceDir });
  if (inspection.ok) {
    for (const problem of inspection.data.problems) {
      if (problem.project === "workspace" || problem.project === request.projectId) {
        diagnostics.push({
          source: "workspace",
          code: "WORKSPACE_PROBLEM",
          message: `${problem.project}: ${problem.issue}`,
        });
      }
    }
  }

  const roots = projectArtifactRoots(
    workspace.root,
    request.projectId,
    workspace.manifest.artifact_layout,
  );
  const project = { id: request.projectId, path: registration.path };
  const backlog = readBacklog(request.workspaceDir, request.projectId, diagnostics);
  const plans = readPlans(roots.plans, diagnostics).map((plan) => ({ id: plan.id, title: plan.title, status: plan.status, item_count: plan.items.length }));
  const reports = readReports(workspace.root, roots.reports, diagnostics).map((report) => ({ id: report.id, title: report.title, outcome: report.outcome, created_at: report.created_at }));
  const docs = readDocs(
    workspace.root,
    resolveProjectPath(workspace.root, registration.path),
    diagnostics,
  );
  const retrospectives = readRetrospectives(
    workspace.root,
    workspaceRetrospectiveRoot(workspace.root, workspace.manifest.retrospectives),
    request.projectId,
    diagnostics,
  );

  return applicationSuccess({
    project,
    backlog,
    plans,
    reports,
    docs,
    retrospectives,
    diagnostics: sortDiagnostics(diagnostics),
  });
}

function readBacklog(
  workspaceDir: string,
  projectId: string,
  diagnostics: WorkbenchDiagnostic[],
): WorkbenchProjectOverview["backlog"] {
  const counts = emptyBacklogCounts();
  let result;
  try {
    result = listBacklogItems({ workspaceDir, projectId });
  } catch {
    diagnostics.push({
      source: "backlog",
      code: "DOMAIN_UNAVAILABLE",
      message: "Backlog items could not be listed.",
    });
    return { counts, recent: [] };
  }
  if (!result.ok) {
    diagnostics.push({
      source: "backlog",
      code: result.error.code,
      message: result.error.message,
    });
    return { counts, recent: [] };
  }
  for (const item of result.data.items) counts[item.status] += 1;
  const recent = [...result.data.items]
    .sort((left, right) => right.updated.localeCompare(left.updated) || left.id.localeCompare(right.id))
    .slice(0, 5)
    .map(toWorkbenchBacklogSummary);
  return { counts, recent };
}

function readPlans(
  root: string,
  diagnostics: WorkbenchDiagnostic[],
): Plan[] {
  let ids: string[];
  try {
    ids = listPlanIds(root);
  } catch {
    diagnostics.push({ source: "plans", code: "DOMAIN_UNAVAILABLE", message: "Plans could not be listed." });
    return [];
  }
  const plans: Plan[] = [];
  for (const id of ids) {
    try {
      const plan = readPlan(root, id);
      if (plan.id !== id) {
        throw new Error(`Plan id mismatch: expected ${id}, got ${plan.id}`);
      }
      plans.push(plan);
    } catch {
      diagnostics.push({
        source: "plans",
        code: "ARTIFACT_INVALID",
        message: `Plan ${id} is invalid.`,
        reference: `plans/${id}.json`,
      });
    }
  }
  return plans;
}

function readReports(
  workspaceRoot: string,
  root: string,
  diagnostics: WorkbenchDiagnostic[],
): Report[] {
  let ids: string[];
  try {
    ids = listReportIds(workspaceRoot, root);
  } catch {
    diagnostics.push({ source: "reports", code: "DOMAIN_UNAVAILABLE", message: "Reports could not be listed." });
    return [];
  }
  const reports: Report[] = [];
  for (const id of ids) {
    try {
      const report = readReport(workspaceRoot, root, id);
      reports.push(report);
    } catch {
      diagnostics.push({
        source: "reports",
        code: "ARTIFACT_INVALID",
        message: `Report ${id} is invalid.`,
        reference: `reports/${id}.md`,
      });
    }
  }
  return reports;
}

function readDocs(
  workspaceRoot: string,
  projectDir: string,
  diagnostics: WorkbenchDiagnostic[],
): WorkbenchProjectOverview["docs"] {
  try {
    const problems = checkProjectDocs(workspaceRoot, projectDir);
    return { healthy: problems.length === 0, problems };
  } catch (error) {
    if (!(error instanceof ProjectDocsCheckError)) throw error;
    diagnostics.push({ source: "docs", code: "DOMAIN_UNAVAILABLE", message: "Project Docs could not be checked." });
    return { healthy: false, problems: [] };
  }
}

function readRetrospectives(
  workspaceRoot: string,
  root: string,
  projectId: string,
  diagnostics: WorkbenchDiagnostic[],
): WorkbenchProjectOverview["retrospectives"] {
  const counts = { inbox: 0, active: 0, archive: 0 };
  const records = readRetrospectiveRecords(workspaceRoot, root, diagnostics)
    .filter((record) => record.project === projectId);
  for (const record of records) counts[record.status] += 1;
  const recent = records
    .sort((left, right) => right.created_at.localeCompare(left.created_at) || left.id.localeCompare(right.id))
    .slice(0, 5)
    .map((record) => ({
      id: record.id,
      status: record.status,
      created_at: record.created_at,
      path: record.path,
    }));
  return { counts, recent };
}

function emptyBacklogCounts(): Record<ItemStatus, number> {
  return Object.fromEntries(ITEM_STATUSES.map((status) => [status, 0])) as Record<ItemStatus, number>;
}

function toWorkbenchBacklogSummary(item: BacklogItemSummary): WorkbenchBacklogSummary {
  return {
    id: item.id,
    title: item.title,
    item_type: item.item_type,
    parent_id: item.parent_id,
    priority: item.priority,
    status: item.status,
    depends_on: [...item.depends_on],
    updated: item.updated,
    revision: item.revision,
  };
}

function sortDiagnostics(diagnostics: WorkbenchDiagnostic[]): WorkbenchDiagnostic[] {
  return diagnostics.sort((left, right) => {
    const leftKey = `${left.source}\0${left.reference ?? ""}\0${left.code}\0${left.message}`;
    const rightKey = `${right.source}\0${right.reference ?? ""}\0${right.code}\0${right.message}`;
    return leftKey.localeCompare(rightKey);
  });
}

function readRetrospectiveRecords(
  workspaceRoot: string,
  root: string,
  diagnostics: WorkbenchDiagnostic[],
): RetrospectiveRecord[] {
  try {
    const result = listRetrospectiveRecords(workspaceRoot, root);
    for (const diagnostic of result.diagnostics) {
      diagnostics.push({
        source: "retrospectives",
        code: "ARTIFACT_INVALID",
        message: `Retrospective ${diagnostic.id} is invalid.`,
        reference: diagnostic.path,
      });
    }
    return result.records;
  } catch {
    diagnostics.push({
      source: "retrospectives",
      code: "DOMAIN_UNAVAILABLE",
      message: "Retrospectives could not be listed.",
    });
    return [];
  }
}

export type WorkbenchReadPages = {
  plans: Plan[];
  reports: Report[];
  documents: Array<{ path: string; issue: string | null }>;
  retrospectives: RetrospectiveRecord[];
  diagnostics: WorkbenchDiagnostic[];
};

export function getWorkbenchReadPages(
  request: { workspaceDir: string; projectId: string },
): ApplicationResult<WorkbenchReadPages> {
  const summary = getWorkspaceSummary(request);
  if (!summary.ok) return summary;
  const project = summary.data.projects.find((entry) => entry.id === request.projectId);
  if (project === undefined) {
    return applicationFailure("PROJECT_NOT_FOUND", `Project "${request.projectId}" is not registered.`);
  }
  const workspace = loadWorkspace(request.workspaceDir);
  const roots = projectArtifactRoots(workspace.root, request.projectId, workspace.manifest.artifact_layout);
  const diagnostics: WorkbenchDiagnostic[] = [];
  const plans = readPlans(roots.plans, diagnostics);
  const reports = readReports(workspace.root, roots.reports, diagnostics);
  const docs = readDocs(workspace.root, resolveProjectPath(workspace.root, project.path), diagnostics);
  const documents = PROJECT_DOC_TEMPLATES.map(({ path }) => ({
    path,
    issue: docs.problems.find((problem) => problem.path === path)?.issue ?? (docs.healthy || docs.problems.length > 0 ? null : "unavailable"),
  }));
  const retrospectives = readRetrospectiveRecords(
    workspace.root,
    workspaceRetrospectiveRoot(workspace.root, workspace.manifest.retrospectives),
    diagnostics,
  );
  return applicationSuccess({ plans, reports, documents, retrospectives, diagnostics: sortDiagnostics(diagnostics) });
}
