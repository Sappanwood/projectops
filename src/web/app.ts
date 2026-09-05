import { createParallelRunUi } from "./parallelRunUi.js";
import { createPlanRunUi } from "./planRunUi.js";
import { createExecutionUi } from "./executionUi.js";
import { createFoundationUi } from "./foundationUi.js";
import { isReadPage } from "./readPagesView.js";
import { createApiClient, type ApiClient } from "./apiClient.js";
import { createBacklogController } from "./backlogController.js";
import { renderApp } from "./render.js";
import { formatRoute, parseRoute, setupRouter, type Router } from "./router.js";
import {
  createInitialState,
  selectView,
  setProjectError,
  setProjectLoading,
  setProjectSuccess,
  setRefreshing,
  setWorkspaceError,
  setWorkspaceLoading,
  setWorkspaceSuccess,
} from "./state.js";
import type { AppState, RouteState } from "./types.js";
import { emptyDocsState } from "./docsView.js";
import { rememberModel } from './modelSelector.js';
import type { ModelCatalog } from '../execution/models.js';

export type WorkbenchAppOptions = {
  container: HTMLElement;
  apiClient?: ApiClient;
  router?: Router | ((onChange: (route: RouteState) => void) => Router);
};

export type WorkbenchApp = {
  getState(): AppState;
  refresh(): Promise<void>;
  destroy(): void;
};

export function createWorkbenchApp(options: WorkbenchAppOptions): WorkbenchApp {
  const container = options.container;
  const apiClient = options.apiClient ?? createApiClient();

  let state: AppState = createInitialState();
  let destroyed = false;
  let currentRequestId = 0;
  let readRequestId = 0;
  let backlogNavigation = 0;
  let documentRequestId = 0;
  let modelRequestId = 0;
  async function loadModels() {
    if (!apiClient.request) return;
    const request = ++modelRequestId;
    state = { ...state, modelSelection: { ...state.modelSelection, loading: true } };
    const result = await apiClient.request<ModelCatalog>('/api/models');
    if (destroyed || request !== modelRequestId) return;
    state = { ...state, modelSelection: { ...state.modelSelection, loading: false,
      ...(result.ok ? { ...result.data, error: '' } : { error: result.error.message }) } };
    render();
  }
  const backlog = createBacklogController(apiClient, (next) => {
    state = { ...state, backlog: next };
    render();
  }, async (projectId) => {
    const requestId = currentRequestId;
    const result = await apiClient.getProjectOverview(projectId);
    if (destroyed || requestId !== currentRequestId || state.selectedProjectId !== projectId) return;
    if (result.ok) state = setProjectSuccess(state, result.data);
    else state = setProjectError(state, result.error);
    render();
  });

  const parallelRuns = createParallelRunUi(container, apiClient, () => state);
  const planRuns = createPlanRunUi(container, apiClient, () => state);
  const executions = createExecutionUi(container, apiClient, () => state, refresh);
  const foundation = createFoundationUi(container, apiClient, () => state, refresh);

  const readingDetails = new Map<string, boolean>();
  const readingPositions = new Map<string, number>();
  function saveReadingPosition(): void {
    if (typeof window === "undefined" || state.projectLoading || state.readPagesLoading || state.docs.loading || state.status !== "ready") return;
    readingPositions.set(formatRoute(state.route), window.scrollY);
  }
  function restoreReadingPosition(): boolean {
    const position = readingPositions.get(formatRoute(state.route));
    if (typeof window === "undefined" || position === undefined) return false;
    window.scrollTo({top:position,behavior:"instant"});
    return true;
  }
  let renderedProject: string | null = null;
  function render(): void {
    if (destroyed) return;
    for (const detail of container.querySelectorAll?.<HTMLDetailsElement>("details[data-reading-key]") ?? []) {
      readingDetails.set(`${renderedProject}:${detail.dataset.readingKey}`, detail.open);
    }
    container.innerHTML = renderApp(state);
    foundation.render();
    executions.render();
    planRuns.render();
    parallelRuns.render();
    renderedProject = state.selectedProjectId;
    for (const detail of container.querySelectorAll?.<HTMLDetailsElement>("details[data-reading-key]") ?? []) {
      const open = readingDetails.get(`${renderedProject}:${detail.dataset.readingKey}`);
      if (open !== undefined) detail.open = open;
    }
  }

  async function loadWorkspaceAndCurrentProject(route: RouteState): Promise<void> {
    const requestId = ++currentRequestId;
    state = setWorkspaceLoading(state);
    render();

    const workspaceResult = await apiClient.getWorkspaceOverview();
    if (destroyed || requestId !== currentRequestId) return;

    if (!workspaceResult.ok) {
      state = setWorkspaceError(state, {
        code: workspaceResult.error.code,
        message: workspaceResult.error.message,
      });
      render();
      return;
    }

    const currentRoute = router.getCurrentRoute();
    state = setWorkspaceSuccess(state, workspaceResult.data, currentRoute);
    state = { ...state, retrospectiveFilters: currentRoute.retrospectiveFilters ?? { project: state.selectedProjectId ?? "", task: "", status: "" } };
    render();

    // If a valid project is selected, load its overview
    if (state.selectedProjectId !== null && state.projectError === null) {
      await loadProject(state.selectedProjectId, requestId);
    }
  }

  async function loadProject(projectId: string, parentRequestId?: number): Promise<void> {
    const requestId = parentRequestId ?? ++currentRequestId;
    state = setProjectLoading(state, projectId);
    render();

    const projectResult = await apiClient.getProjectOverview(projectId);
    if (destroyed) return;
    if (requestId !== currentRequestId || state.selectedProjectId !== projectId) {
      return;
    }

    if (!projectResult.ok) {
      state = setProjectError(state, {
        code: projectResult.error.code,
        message: projectResult.error.message,
      });
      render();
      return;
    }

    state = setProjectSuccess(state, projectResult.data);
    render();
    if (state.currentView === "overview") restoreReadingPosition();
    if (state.currentView === "backlog") await loadBacklogRoute(projectId);
    if (isReadPage(state.currentView)) await loadReadPages(projectId);
  }

  async function loadBacklogRoute(projectId: string): Promise<void> {
    const navigation = ++backlogNavigation;
    await backlog.load(projectId);
    const route = router.getCurrentRoute();
    if (navigation !== backlogNavigation || route.projectId !== projectId || route.view !== "backlog") return;
    if (route.itemId && !state.backlog.saving) await backlog.select(route.itemId);
  }

  function focusReadArtifact(): void {
    const route = router.getCurrentRoute();
    const id = state.currentView === "plans" ? route.planId : state.currentView === "reports" ? route.reportId : state.currentView === "retrospectives" ? route.retrospectiveId : undefined;
    if (!id) return;
    const attribute = state.currentView === "plans" ? "planId" : state.currentView === "reports" ? "reportId" : "retrospectiveId";
    for (const detail of container.querySelectorAll?.<HTMLDetailsElement>("details[data-plan-id], details[data-report-id], details[data-retrospective-id]") ?? []) {
      if (detail.dataset[attribute] !== id) continue;
      detail.open = true;
      detail.scrollIntoView({ block: "start" });
      detail.querySelector<HTMLElement>("summary")?.focus({ preventScroll: true });
    }
  }

  async function loadReadPages(projectId: string): Promise<void> {
    if (state.currentView === "docs") { await loadDocs(projectId); return; }
    const requestId = currentRequestId;
    const readId = ++readRequestId;
    state = { ...state, readPages: null, readPagesLoading: true, readPagesError: null };
    render();
    const result = await apiClient.getReadPages(projectId);
    if (destroyed || requestId !== currentRequestId || readId !== readRequestId || state.selectedProjectId !== projectId) return;
    state = { ...state, readPagesLoading: false,
      readPages: result.ok ? result.data : null,
      readPagesError: result.ok ? null : result.error };
    render();
    if (result.ok) { focusReadArtifact(); restoreReadingPosition(); }
  }

  function focusDocumentSection(): void {
    const section = router.getCurrentRoute().section;
    if (!section) return;
    const target = container.ownerDocument?.getElementById(`doc-heading-${section}`);
    if (target && container.contains(target)) { target.scrollIntoView({block:"start"}); target.focus({preventScroll:true}); }
  }

  async function loadDocs(projectId: string): Promise<void> {
    const request = ++documentRequestId;
    const documentPath = router.getCurrentRoute().documentPath ?? "README.md";
    state = {...state, docs:{...emptyDocsState(), loading:true}};
    render();
    const [list, document] = await Promise.all([apiClient.listDocuments(projectId), apiClient.showDocument(projectId, documentPath)]);
    if (destroyed || request !== documentRequestId || state.selectedProjectId !== projectId || state.currentView !== "docs") return;
    state = {...state, docs:{list:list.ok ? list.data : null, document:document.ok ? document.data : null, loading:false, error:document.ok ? null : document.error, listError:list.ok ? null : list.error}};
    render();
    if (document.ok && !restoreReadingPosition()) focusDocumentSection();
  }

  async function refresh(): Promise<void> {
    if (state.refreshing) return;
    void loadModels();
    saveReadingPosition();
    const requestId = ++currentRequestId;
    state = setRefreshing(state, true);
    render();

    const workspaceResult = await apiClient.getWorkspaceOverview();
    if (destroyed || requestId !== currentRequestId) return;

    if (!workspaceResult.ok) {
      state = setWorkspaceError(state, {
        code: workspaceResult.error.code,
        message: workspaceResult.error.message,
      });
      render();
      return;
    }

    const currentRoute = router.getCurrentRoute();
    state = setWorkspaceSuccess(state, workspaceResult.data, currentRoute);

    if (state.selectedProjectId !== null && state.projectError === null) {
      const targetProjectId = state.selectedProjectId;
      const projectResult = await apiClient.getProjectOverview(targetProjectId);
      if (destroyed) return;
      if (requestId !== currentRequestId || state.selectedProjectId !== targetProjectId) {
        return;
      }

      if (!projectResult.ok) {
        state = setProjectError(state, {
          code: projectResult.error.code,
          message: projectResult.error.message,
        });
      } else {
        state = setProjectSuccess(state, projectResult.data);
      }
    } else {
      state = setRefreshing(state, false);
    }

    render();
    if (state.currentView === "overview") restoreReadingPosition();
    if (state.currentView === "backlog" && state.selectedProjectId !== null && state.projectError === null) {
      await loadBacklogRoute(state.selectedProjectId);
    }
    if (isReadPage(state.currentView) && state.selectedProjectId !== null && state.projectError === null) await loadReadPages(state.selectedProjectId);
  }

  function handleRouteChange(route: RouteState): void {
    if (destroyed) return;
    if (route.view === "retrospectives" && state.currentView === "retrospectives" && state.readPages && !state.projectLoading && formatRoute(route) === formatRoute(state.route)) return;
    saveReadingPosition();
    const previousRoute = state.route;
    state = {...state, route};
    state = { ...state, selectedPlanId: route.planId ?? null, selectedReportId: route.reportId ?? null };

    if (state.workspace === null || state.status === "loading") {
      if (state.status === "loading") {
        state = {
          ...state,
          selectedProjectId: route.projectId,
          currentView: route.view,
        };
        render();
        return;
      }
      void loadWorkspaceAndCurrentProject(route);
      return;
    }

    const projectChanged = route.projectId !== state.selectedProjectId;
    const viewChanged = route.view !== state.currentView;
    if (route.view === "retrospectives") state = {...state,retrospectiveFilters:route.retrospectiveFilters ?? (projectChanged ? {project:route.projectId ?? "",status:"",task:""} : state.retrospectiveFilters)};
    if (projectChanged || viewChanged) { documentRequestId++; state = {...state, docs:emptyDocsState()}; }
    backlogNavigation++;
    if (viewChanged) { backlog.reset(); readRequestId++; }

    if (projectChanged) {
      backlog.reset();
      state = { ...state, readPages: null, readPagesLoading: false, readPagesError: null, retrospectiveFilters: route.retrospectiveFilters ?? { project: route.projectId ?? "", status: "", task: "" } };
      if (route.projectId === null) {
        currentRequestId++;
        state = {
          ...state,
          refreshing: false,
          selectedProjectId: null,
          projectOverview: null,
          projectLoading: false,
          projectError: null,
          currentView: route.view,
        };
        render();
      } else {
        state = {
          ...selectView(state, route.view),
          refreshing: false,
        };
        void loadProject(route.projectId);
      }
    } else if (viewChanged) {
      state = selectView(state, route.view);
      render();
      if (route.view === "overview" && route.projectId !== null) void loadProject(route.projectId);
      if (route.view === "backlog" && route.projectId !== null) void loadBacklogRoute(route.projectId);
      if (isReadPage(route.view) && route.projectId !== null) void loadReadPages(route.projectId);
    } else {
      render();
      if (route.view === "backlog" && route.projectId !== null) {
        backlog.reset();
        void loadBacklogRoute(route.projectId);
      }
      if ((route.view === "plans" || route.view === "reports") && route.projectId !== null) void loadReadPages(route.projectId);
      if (route.view === "retrospectives" && route.projectId !== null) {
        if (state.readPages) { focusReadArtifact(); restoreReadingPosition(); }
        else void loadReadPages(route.projectId);
      }
      if (route.view === "docs" && route.projectId !== null) {
        if (previousRoute.documentPath === route.documentPath && state.docs.document) focusDocumentSection();
        else void loadDocs(route.projectId);
      }
    }
  }

  const router = typeof options.router === "function"
    ? options.router(handleRouteChange)
    : (options.router ?? setupRouter(handleRouteChange));

  // Global event delegation on container
  function handleClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (target === null) return;

    const link = target.closest<HTMLAnchorElement>('a[href]');
    if (link && typeof window !== "undefined" && link.hash.startsWith("#/projects/")) {
      const destination = parseRoute(link.hash);
      if (destination.returnTo) {
        const origin = parseRoute(destination.returnTo);
        if (origin.projectId === state.route.projectId && origin.view === state.currentView) readingPositions.set(destination.returnTo,window.scrollY);
      }
    }

    if (target.closest("#docs-retry") !== null && state.selectedProjectId !== null) { void loadDocs(state.selectedProjectId); return; }

    const taskLink = target.closest<HTMLButtonElement>("[data-plan-target]");
    if (taskLink !== null) {
      const detail = container.ownerDocument.getElementById(taskLink.dataset.planTarget!) as HTMLDetailsElement | null;
      if (detail && container.contains(detail)) {
        detail.open = true;
        detail.scrollIntoView({ block: "start" });
        detail.querySelector("summary")?.focus({ preventScroll: true });
      }
      return;
    }

    const refreshBtn = target.closest<HTMLButtonElement>("#btn-refresh");
    if (refreshBtn !== null) {
      event.preventDefault();
      void refresh();
      return;
    }

    const retryBtn = target.closest<HTMLButtonElement>("#btn-retry");
    if (retryBtn !== null) {
      event.preventDefault();
      void loadWorkspaceAndCurrentProject(router.getCurrentRoute());
      return;
    }
    if (target.closest("#read-pages-retry") !== null && state.selectedProjectId !== null) {
      void loadReadPages(state.selectedProjectId);
      return;
    }
    const itemButton = target.closest<HTMLButtonElement>("[data-backlog-item]");
    if (itemButton !== null) {
      router.navigate({ projectId: state.selectedProjectId, view: "backlog", itemId: itemButton.dataset.backlogItem!,
        ...(state.selectedPlanId ? { planId: state.selectedPlanId } : {}),
        ...(state.route.returnTo ? {returnTo:state.route.returnTo} : {}),
      });
      return;
    }
    const statusButton = target.closest<HTMLButtonElement>("[data-backlog-status]");
    if (statusButton !== null) {
      void backlog.update(statusButton.dataset.backlogStatus!);
      return;
    }
    if (target.closest("#backlog-item-refresh") !== null && state.backlog.selectedItemId !== null) {
      void backlog.select(state.backlog.selectedItemId);
      return;
    }
    if (target.closest("#backlog-refresh") !== null && state.selectedProjectId !== null) {
      void backlog.load(state.selectedProjectId);
    }
  }

  function handleChange(event: Event): void {
    const modelSelect = event.target as HTMLSelectElement | null;
    if (modelSelect?.id === 'model-select') {
      const selected = modelSelect.value ? JSON.parse(modelSelect.value) : null;
      state = { ...state, modelSelection: { ...state.modelSelection, selected } };
      rememberModel(selected);
      render();
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target === null) return;

    if (target.id === "project-select") {
      const select = target as HTMLSelectElement;
      const nextProjectId = select.value === "" ? null : select.value;
      router.navigate({
        projectId: nextProjectId,
        view: state.currentView,
      });
    }
  }

  function handleSubmit(event: Event): void {
    const form = event.target as HTMLFormElement | null;
    if (form?.id !== "retrospective-filters") return;
    event.preventDefault();
    const value = (name: string) => (form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement).value;
    state = { ...state, retrospectiveFilters: {
      project: value("project").trim(),
      task: value("task").trim(),
      status: value("status"),
    } };
    const nextRoute = {...state.route, retrospectiveId:undefined, retrospectiveFilters:state.retrospectiveFilters};
    state = {...state,route:nextRoute};
    render();
    router.navigate(nextRoute);
  }

  if (typeof window !== "undefined") window.addEventListener("scroll", saveReadingPosition, {passive:true});
  container.addEventListener("submit", handleSubmit);
  container.addEventListener("click", handleClick);
  container.addEventListener("change", handleChange);

  // Initial load
  const initialRoute = router.getCurrentRoute();
  void loadWorkspaceAndCurrentProject(initialRoute);
  void loadModels();

  return {
    getState() {
      return state;
    },
    refresh,
    destroy() {
      destroyed = true;
      backlog.destroy();
      foundation.destroy();
      executions.destroy();
      planRuns.destroy();
      parallelRuns.destroy();
      container.removeEventListener("submit", handleSubmit);
      container.removeEventListener("click", handleClick);
      container.removeEventListener("change", handleChange);
      router.cleanup();
      if (typeof window !== "undefined") window.removeEventListener("scroll", saveReadingPosition);
    },
  };
}

// Auto-mount in browser if root app element is found
if (typeof window !== "undefined" && typeof document !== "undefined") {
  const root = document.getElementById("app");
  if (root !== null) {
    createWorkbenchApp({ container: root });
  }
}
