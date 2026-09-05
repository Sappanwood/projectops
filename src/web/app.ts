import { isReadPage } from "./readPagesView.js";
import { createApiClient, type ApiClient } from "./apiClient.js";
import { createBacklogController } from "./backlogController.js";
import { renderApp } from "./render.js";
import { setupRouter, type Router } from "./router.js";
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

  function render(): void {
    if (destroyed) return;
    container.innerHTML = renderApp(state);
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
    state = { ...state, retrospectiveFilters: { project: state.selectedProjectId ?? "", task: "", status: "" } };
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
    if (state.currentView === "backlog") await backlog.load(projectId);
    if (isReadPage(state.currentView)) await loadReadPages(projectId);
  }

  async function loadReadPages(projectId: string): Promise<void> {
    const requestId = currentRequestId;
    const readId = ++readRequestId;
    state = { ...state, readPagesLoading: true, readPagesError: null };
    render();
    const result = await apiClient.getReadPages(projectId);
    if (destroyed || requestId !== currentRequestId || readId !== readRequestId || state.selectedProjectId !== projectId) return;
    state = { ...state, readPagesLoading: false,
      readPages: result.ok ? result.data : null,
      readPagesError: result.ok ? null : result.error };
    render();
  }

  async function refresh(): Promise<void> {
    if (state.refreshing) return;
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
    if (state.currentView === "backlog" && state.selectedProjectId !== null && state.projectError === null) {
      await backlog.load(state.selectedProjectId);
    }
    if (isReadPage(state.currentView) && state.selectedProjectId !== null && state.projectError === null) await loadReadPages(state.selectedProjectId);
  }

  function handleRouteChange(route: RouteState): void {
    if (destroyed) return;

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

    if (projectChanged) {
      backlog.reset();
      state = { ...state, readPages: null, readPagesLoading: false, readPagesError: null, retrospectiveFilters: { project: route.projectId ?? "", status: "", task: "" } };
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
      if (route.view === "backlog" && route.projectId !== null) void backlog.load(route.projectId);
      if (isReadPage(route.view) && route.projectId !== null) void loadReadPages(route.projectId);
    }
  }

  const router = typeof options.router === "function"
    ? options.router(handleRouteChange)
    : (options.router ?? setupRouter(handleRouteChange));

  // Global event delegation on container
  function handleClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (target === null) return;

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
      void backlog.select(itemButton.dataset.backlogItem!);
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
    render();
  }

  container.addEventListener("submit", handleSubmit);
  container.addEventListener("click", handleClick);
  container.addEventListener("change", handleChange);

  // Initial load
  const initialRoute = router.getCurrentRoute();
  void loadWorkspaceAndCurrentProject(initialRoute);

  return {
    getState() {
      return state;
    },
    refresh,
    destroy() {
      destroyed = true;
      backlog.destroy();
      container.removeEventListener("submit", handleSubmit);
      container.removeEventListener("click", handleClick);
      container.removeEventListener("change", handleChange);
      router.cleanup();
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
