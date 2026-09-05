import type { WorkbenchReadPages } from "../application/workbenchReadModel.js";
import type { RetrospectiveFilters } from "./readPagesView.js";
import type {
  WorkbenchBacklogSummary,
  WorkbenchDiagnostic,
  WorkbenchProjectOverview,
  WorkbenchWorkspaceOverview,
} from "../application/workbenchReadModel.js";
import type { WorkspaceProjectSummary } from "../application/workspaceApi.js";
import type { BacklogViewState } from "./backlogController.js";
import type { DocsState } from "./docsView.js";

export type ViewType =
  | "overview"
  | "backlog"
  | "plans"
  | "reports"
  | "docs"
  | "retrospectives";

export const VIEW_TYPES: readonly ViewType[] = [
  "overview",
  "backlog",
  "plans",
  "reports",
  "docs",
  "retrospectives",
] as const;

export function isValidView(view: string): view is ViewType {
  return (VIEW_TYPES as readonly string[]).includes(view);
}

export type RouteState = {
  retrospectiveId?: string | undefined;
  retrospectiveFilters?: RetrospectiveFilters | undefined;
  returnTo?: string | undefined;
  documentPath?: string | undefined;
  section?: string | undefined;
  itemId?: string;
  reportId?: string;
  planId?: string;
  projectId: string | null;
  view: ViewType;
};

export type AppStatus = "loading" | "ready" | "error";

export type AppError = {
  code?: string | undefined;
  message: string;
};

export type AppState = {
  modelSelection: import('./modelSelector.js').ModelSelectionState;
  route: RouteState;
  docs: DocsState;
  selectedPlanId: string | null;
  selectedReportId: string | null;
  readPages: WorkbenchReadPages | null;
  readPagesLoading: boolean;
  readPagesError: AppError | null;
  retrospectiveFilters: RetrospectiveFilters;
  backlog: BacklogViewState;
  status: AppStatus;
  refreshing: boolean;
  error: AppError | null;
  workspace: WorkbenchWorkspaceOverview | null;
  selectedProjectId: string | null;
  currentView: ViewType;
  projectOverview: WorkbenchProjectOverview | null;
  projectLoading: boolean;
  projectError: AppError | null;
};

export type {
  WorkbenchBacklogSummary,
  WorkbenchDiagnostic,
  WorkbenchProjectOverview,
  WorkbenchWorkspaceOverview,
  WorkspaceProjectSummary,
};
