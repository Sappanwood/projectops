import type {
  AppError,
  AppState,
  RouteState,
  ViewType,
  WorkbenchProjectOverview,
  WorkbenchWorkspaceOverview,
} from "./types.js";
import { emptyBacklogState } from "./backlogController.js";
import { emptyDocsState } from "./docsView.js";

export function createInitialState(route?: RouteState): AppState {
  return {
    route: route ?? {projectId:null, view:"overview"},
    docs: emptyDocsState(),
    selectedPlanId: route?.planId ?? null,
    selectedReportId: route?.reportId ?? null,
    backlog: emptyBacklogState(),
    readPages: null,
    readPagesLoading: false,
    readPagesError: null,
    retrospectiveFilters: { project: route?.projectId ?? "", status: "", task: "" },
    status: "loading",
    refreshing: false,
    error: null,
    workspace: null,
    selectedProjectId: route?.projectId ?? null,
    currentView: route?.view ?? "overview",
    projectOverview: null,
    projectLoading: false,
    projectError: null,
  };
}

export function setWorkspaceLoading(state: AppState): AppState {
  return {
    ...state,
    status: "loading",
    error: null,
  };
}

export function setWorkspaceSuccess(
  state: AppState,
  workspace: WorkbenchWorkspaceOverview,
  route: RouteState,
): AppState {
  let selectedProjectId: string | null = null;
  let projectError: AppError | null = null;

  if (route.projectId !== null) {
    const exists = workspace.projects.some((p) => p.id === route.projectId);
    if (exists) {
      selectedProjectId = route.projectId;
    } else {
      selectedProjectId = route.projectId;
      projectError = {
        code: "PROJECT_NOT_FOUND",
        message: `Project "${route.projectId}" was not found in this workspace.`,
      };
    }
  }

  return {
    ...state,
    status: "ready",
    workspace,
    error: null,
    refreshing: false,
    selectedProjectId,
    currentView: route.view,
    route,
    selectedPlanId: route.planId ?? null,
    selectedReportId: route.reportId ?? null,
    projectError,
    // if project is not found or changed, clear stale overview
    projectOverview:
      state.projectOverview?.project.id === selectedProjectId
        ? state.projectOverview
        : null,
  };
}

export function setWorkspaceError(state: AppState, error: AppError): AppState {
  return {
    ...state,
    status: "error",
    error,
    refreshing: false,
    projectLoading: false,
  };
}

export function setProjectLoading(state: AppState, projectId: string): AppState {
  return {
    ...state,
    selectedProjectId: projectId,
    projectLoading: true,
    projectError: null,
    refreshing: false,
  };
}

export function setProjectSuccess(
  state: AppState,
  projectOverview: WorkbenchProjectOverview,
): AppState {
  return {
    ...state,
    selectedProjectId: projectOverview.project.id,
    projectOverview,
    projectLoading: false,
    projectError: null,
    refreshing: false,
  };
}

export function setProjectError(state: AppState, error: AppError): AppState {
  return {
    ...state,
    projectLoading: false,
    projectOverview: null,
    projectError: error,
    refreshing: false,
  };
}

export function selectView(state: AppState, view: ViewType): AppState {
  return {
    ...state,
    currentView: view,
  };
}

export function selectProject(state: AppState, projectId: string | null): AppState {
  if (projectId === null) {
    return {
      ...state,
      selectedProjectId: null,
      projectOverview: null,
      projectLoading: false,
      projectError: null,
    };
  }
  return {
    ...state,
    selectedProjectId: projectId,
    projectLoading: true,
    projectError: null,
  };
}

export function setRefreshing(state: AppState, refreshing: boolean): AppState {
  return {
    ...state,
    refreshing,
  };
}
