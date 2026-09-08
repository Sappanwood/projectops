import type { ModelCatalog } from "../execution/models.js";
import { type ApiClient, createApiClient } from "./apiClient.js";
import { createBacklogController } from "./backlogController.js";
import { createDependencyUi } from "./dependencyUi.js";
import { createDevUi } from "./devUi.js";
import { emptyDocsState } from "./docsView.js";
import { createExecutionUi } from "./executionUi.js";
import { createFoundationUi } from "./foundationUi.js";
import { rememberModel } from "./modelSelector.js";
import { createParallelRunUi } from "./parallelRunUi.js";
import { createPlanGraphUi } from "./planGraphUi.js";
import { createPlanRunUi } from "./planRunUi.js";
import { isReadPage } from "./readPagesView.js";
import { renderApp } from "./render.js";
import { formatRoute, parseRoute, type Router, setupRouter } from "./router.js";
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
  let backlogNavigation = 0;
  let documentRequestId = 0;
  let modelRequestId = 0;
  async function loadModels() {
    if (!apiClient.request) return;
    const request = ++modelRequestId;
    state = { ...state, modelSelection: { ...state.modelSelection, loading: true } };
    const result = await apiClient.request<ModelCatalog>("/api/models");
    if (destroyed || request !== modelRequestId) return;
    state = {
      ...state,
      modelSelection: {
        ...state.modelSelection,
        loading: false,
        ...(result.ok ? { ...result.data, error: "" } : { error: result.error.message }),
      },
    };
    render();
  }
  const backlog = createBacklogController(
    apiClient,
    (next) => {
      state = { ...state, backlog: next };
      render();
    },
    async (projectId) => {
      const requestId = currentRequestId;
      const result = await apiClient.getProjectOverview(projectId);
      if (destroyed || requestId !== currentRequestId || state.selectedProjectId !== projectId)
        return;
      if (result.ok) state = setProjectSuccess(state, result.data);
      else state = setProjectError(state, result.error);
      render();
    },
  );

  const devServices = createDevUi(container, apiClient, () => state);
  const parallelRuns = createParallelRunUi(container, apiClient, () => state);
  const planRuns = createPlanRunUi(container, apiClient, () => state);
  const executions = createExecutionUi(container, apiClient, () => state, refresh);
  const planGraph = createPlanGraphUi(container, apiClient);
  const foundation = createFoundationUi(container, apiClient, () => state, refresh);
  const dependencies = createDependencyUi(container, apiClient, () => state, refresh);

  const readingDetails = new Map<string, boolean>();
  const readingPositions = new Map<string, number>();
  const planPositions = new Map<string, { task: string; offset: number }>();
  const readingFocus = new Map<
    string,
    { selector: string; start: number | null; end: number | null }
  >();
  function saveFocus() {
    if (state.currentView !== "plans") return;
    const active = container.ownerDocument?.activeElement as HTMLInputElement | null;
    if (!active || !active.closest("[data-plan-id]")) return;
    const attr = [
      "data-plan-draft",
      "data-plan-dependency-field",
      "data-foundation-action",
      "data-plan-run-field",
      "data-parallel-field",
    ].find((name) => active.hasAttribute(name));
    const task = active.closest<HTMLElement>(".plan-task");
    const selector = active.id
      ? `#${CSS.escape(active.id)}`
      : attr
        ? `[${attr}="${CSS.escape(active.getAttribute(attr)!)}"]`
        : active.tagName === "SUMMARY" && task
          ? `#${CSS.escape(task.id)} > summary`
          : null;
    if (selector)
      readingFocus.set(formatRoute(state.route), {
        selector,
        start: active.selectionStart,
        end: active.selectionEnd,
      });
  }

  function saveReadingPosition(): void {
    if (
      typeof window === "undefined" ||
      state.projectLoading ||
      state.readPagesLoading ||
      state.docs.loading ||
      state.research?.loading ||
      state.status !== "ready"
    )
      return;
    const key = formatRoute(state.route);
    readingPositions.set(key, window.scrollY);
    if (state.currentView === "plans" && !state.route.planTab) {
      const task = Array.from(container.querySelectorAll<HTMLElement>(".plan-task")).find(
        (element) => element.getBoundingClientRect().bottom > 160,
      );
      if (task && task.getBoundingClientRect().top < innerHeight)
        planPositions.set(key, { task: task.id, offset: task.getBoundingClientRect().top });
      else planPositions.delete(key);
    }
  }
  function restoreReadingPosition(): boolean {
    const position = readingPositions.get(formatRoute(state.route));
    if (typeof window === "undefined" || position === undefined) return false;
    const key = formatRoute(state.route);
    const anchor = planPositions.get(key);
    const task = anchor ? container.ownerDocument.getElementById(anchor.task) : null;
    window.scrollTo({
      top:
        task && anchor
          ? window.scrollY + task.getBoundingClientRect().top - anchor.offset
          : position,
      behavior: "instant",
    });
    if (anchor && !task && container.querySelector("[data-plan-id]")) {
      const notice = container.querySelector("[data-plan-reading-notice]");
      if (notice) notice.textContent = "原阅读任务已不存在，已返回计划中的有效位置。";
    }
    const focus = readingFocus.get(key);
    const control = focus ? container.querySelector<HTMLInputElement>(focus.selector) : null;
    if (control && !control.closest("[hidden]")) {
      control.focus({ preventScroll: true });
      if (
        focus?.start != null &&
        focus.end != null &&
        ["TEXTAREA", "INPUT"].includes(control.tagName)
      )
        control.setSelectionRange(focus.start, focus.end);
    }
    return true;
  }
  const runScroll = new Map<string, number>();
  const graphScroll = new Map<string, { left: number; top: number }>();
  let renderedProject: string | null = null;
  let renderedDoneTarget: string | null = null;
  function render(): void {
    if (destroyed) return;
    const graph = container.querySelector?.<HTMLElement>(".plan-graph-scroll");
    if (graph)
      graphScroll.set(`${renderedProject}/${graph.id}`, {
        left: graph.scrollLeft,
        top: graph.scrollTop,
      });
    for (const detail of container.querySelectorAll?.<HTMLDetailsElement>(
      "details[data-reading-key]",
    ) ?? []) {
      readingDetails.set(`${renderedProject}:${detail.dataset.readingKey}`, detail.open);
    }
    for (const list of container.querySelectorAll?.<HTMLElement>(".run-nodes") ?? []) {
      const panel = list.closest<HTMLElement>("[data-plan-run-panel], [data-parallel-panel]");
      if (panel)
        runScroll.set(
          `${renderedProject}/${panel.dataset.planRunPanel ?? panel.dataset.parallelPanel}/${panel.hasAttribute("data-parallel-panel")}/${panel.dataset.selectedRun}`,
          list.scrollTop,
        );
    }
    const selectedDone =
      state.currentView === "backlog" &&
      state.backlog.items.some(
        (item) => item.id === state.backlog.selectedItemId && item.status === "done",
      )
        ? `${state.selectedProjectId}:${state.backlog.selectedItemId}`
        : null;
    const active = container.ownerDocument?.activeElement;
    const dependencyFocus =
      active?.closest?.("[data-dependency-panel], [data-foundation-plan]") &&
      renderedProject === state.selectedProjectId
        ? {
            attribute: [
              "data-dependency-project",
              "data-dependency-candidate",
              "data-dependency-action",
              "data-plan-dependency-field",
              "data-plan-draft",
              "data-foundation-action",
            ].find((name) => active.hasAttribute(name)),
            plan: (active.closest("[data-foundation-plan]") as HTMLElement | null)?.dataset
              .foundationPlan,
            element: active,
          }
        : null;
    const devFocus =
      active?.closest?.("[data-dev-host]") && renderedProject === state.selectedProjectId
        ? active.id
        : null;
    devServices.saveReading();
    container.innerHTML = renderApp(state);
    devServices.render();
    if (devFocus)
      container.querySelector<HTMLElement>(`#${devFocus}`)?.focus({ preventScroll: true });
    foundation.render();
    const nextGraph = container.querySelector?.<HTMLElement>(".plan-graph-scroll");
    const position = nextGraph
      ? graphScroll.get(`${state.selectedProjectId}/${nextGraph.id}`)
      : null;
    if (nextGraph && position) {
      nextGraph.scrollLeft = position.left;
      nextGraph.scrollTop = position.top;
    }
    dependencies.render();
    if (dependencyFocus?.attribute) {
      const name = dependencyFocus.attribute;
      const value = dependencyFocus.element.getAttribute(name);
      const next = Array.from(container.querySelectorAll<HTMLElement>(`[${name}]`)).find(
        (element) =>
          element.getAttribute(name) === value &&
          (element.closest("[data-foundation-plan]") as HTMLElement | null)?.dataset
            .foundationPlan === dependencyFocus.plan,
      );
      next?.focus({ preventScroll: true });
    }
    executions.render();
    planRuns.render();
    parallelRuns.render();
    renderedProject = state.selectedProjectId;
    for (const list of container.querySelectorAll?.<HTMLElement>(".run-nodes") ?? []) {
      const panel = list.closest<HTMLElement>("[data-plan-run-panel], [data-parallel-panel]");
      if (panel)
        list.scrollTop =
          runScroll.get(
            `${renderedProject}/${panel.dataset.planRunPanel ?? panel.dataset.parallelPanel}/${panel.hasAttribute("data-parallel-panel")}/${panel.dataset.selectedRun}`,
          ) ?? 0;
    }
    for (const detail of container.querySelectorAll?.<HTMLDetailsElement>(
      "details[data-reading-key]",
    ) ?? []) {
      const open = readingDetails.get(`${renderedProject}:${detail.dataset.readingKey}`);
      if (open !== undefined) detail.open = open;
      if (
        detail.dataset.readingKey === "backlog-group-done" &&
        selectedDone !== null &&
        selectedDone !== renderedDoneTarget
      )
        detail.open = true;
    }
    renderedDoneTarget = selectedDone;
    const mermaidRenderer = (
      globalThis as typeof globalThis & {
        projectOpsRenderMermaid?: (root: ParentNode) => Promise<void>;
      }
    ).projectOpsRenderMermaid;
    if (mermaidRenderer) void mermaidRenderer(container);
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
    state = {
      ...state,
      retrospectiveFilters: currentRoute.retrospectiveFilters ?? {
        project: state.selectedProjectId ?? "",
        task: "",
        status: "",
      },
    };
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
    if (isReadPage(state.currentView) || state.currentView === "research")
      await loadReadPages(projectId);
  }

  async function loadBacklogRoute(projectId: string): Promise<void> {
    const navigation = ++backlogNavigation;
    await backlog.load(projectId);
    const route = router.getCurrentRoute();
    if (
      navigation !== backlogNavigation ||
      route.projectId !== projectId ||
      route.view !== "backlog"
    )
      return;
    if (route.itemId && !state.backlog.saving) await backlog.select(route.itemId);
  }

  function focusReadArtifact(): void {
    const route = router.getCurrentRoute();
    const id =
      state.currentView === "plans"
        ? route.planId
        : state.currentView === "reports"
          ? route.reportId
          : state.currentView === "retrospectives"
            ? route.retrospectiveId
            : undefined;
    if (!id) return;
    const attribute =
      state.currentView === "plans"
        ? "planId"
        : state.currentView === "reports"
          ? "reportId"
          : "retrospectiveId";
    for (const detail of container.querySelectorAll?.<HTMLDetailsElement>(
      "[data-plan-id], details[data-report-id], details[data-retrospective-id]",
    ) ?? []) {
      if (detail.dataset[attribute] !== id) continue;
      if (detail.tagName === "DETAILS") detail.open = true;
      detail.scrollIntoView({ block: "start" });
      detail.querySelector<HTMLElement>(".plan-title, summary")?.focus({ preventScroll: true });
    }
  }

  async function loadReadPages(projectId: string): Promise<void> {
    if (state.currentView === "docs") {
      await loadDocs(projectId);
      return;
    }
    if (state.currentView === "research") {
      await loadResearch(projectId);
      return;
    }
    const requestId = currentRequestId;
    const readId = ++readRequestId;
    state = { ...state, readPagesLoading: true, readPagesError: null };
    render();
    const result = await apiClient.getReadPages(projectId);
    if (
      destroyed ||
      requestId !== currentRequestId ||
      readId !== readRequestId ||
      state.selectedProjectId !== projectId
    )
      return;
    state = {
      ...state,
      readPagesLoading: false,
      readPages: result.ok ? result.data : state.readPages,
      readPagesError: result.ok ? null : result.error,
    };
    render();
    if (result.ok) {
      focusReadArtifact();
      restoreReadingPosition();
    }
  }

  function focusDocumentSection(): void {
    const section = router.getCurrentRoute().section;
    if (!section) return;
    const prefix = state.currentView === "research" ? "research" : "doc";
    const target = container.ownerDocument?.getElementById(`${prefix}-heading-${section}`);
    if (target && container.contains(target)) {
      target.scrollIntoView({ block: "start" });
      target.focus({ preventScroll: true });
    }
  }

  async function loadDocs(projectId: string): Promise<void> {
    const request = ++documentRequestId;
    const documentPath = router.getCurrentRoute().documentPath ?? "README.md";
    state = { ...state, docs: { ...emptyDocsState(), loading: true } };
    render();
    const [list, document] = await Promise.all([
      apiClient.listDocuments(projectId),
      apiClient.showDocument(projectId, documentPath),
    ]);
    if (
      destroyed ||
      request !== documentRequestId ||
      state.selectedProjectId !== projectId ||
      state.currentView !== "docs"
    )
      return;
    state = {
      ...state,
      docs: {
        list: list.ok ? list.data : null,
        document: document.ok ? document.data : null,
        loading: false,
        error: document.ok ? null : document.error,
        listError: list.ok ? null : list.error,
      },
    };
    render();
    if (document.ok && !restoreReadingPosition()) focusDocumentSection();
  }

  async function loadResearch(projectId: string): Promise<void> {
    const request = ++documentRequestId;
    const documentPath = router.getCurrentRoute().documentPath;
    state = { ...state, research: { ...emptyDocsState(), loading: true } };
    render();
    const list = await apiClient.listResearch(projectId);
    const document = documentPath
      ? await apiClient.showResearch(projectId, documentPath)
      : ({ ok: true, data: null } as const);
    if (
      destroyed ||
      request !== documentRequestId ||
      state.selectedProjectId !== projectId ||
      state.currentView !== "research"
    )
      return;
    state = {
      ...state,
      research: {
        list: list.ok ? list.data : null,
        document: document.ok ? document.data : null,
        loading: false,
        error: document.ok ? null : document.error,
        listError: list.ok ? null : list.error,
      },
    };
    render();
    if (document.ok && document.data && !restoreReadingPosition()) focusDocumentSection();
  }

  async function refresh(): Promise<void> {
    if (state.refreshing) return;
    void loadModels();
    saveFocus();
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
    if (
      state.currentView === "backlog" &&
      state.selectedProjectId !== null &&
      state.projectError === null
    ) {
      await loadBacklogRoute(state.selectedProjectId);
    }
    if (
      (isReadPage(state.currentView) || state.currentView === "research") &&
      state.selectedProjectId !== null &&
      state.projectError === null
    )
      await loadReadPages(state.selectedProjectId);
  }

  function handleRouteChange(route: RouteState): void {
    if (destroyed) return;
    if (
      route.view === "retrospectives" &&
      state.currentView === "retrospectives" &&
      state.readPages &&
      !state.projectLoading &&
      formatRoute(route) === formatRoute(state.route)
    )
      return;
    saveFocus();
    saveReadingPosition();
    const previousRoute = state.route;
    state = { ...state, route };
    state = {
      ...state,
      selectedPlanId: route.planId ?? null,
      selectedReportId: route.reportId ?? null,
    };

    if (
      route.view === "plans" &&
      previousRoute.view === "plans" &&
      route.projectId === previousRoute.projectId &&
      route.planId === previousRoute.planId &&
      state.readPages &&
      route.planTab !== previousRoute.planTab
    ) {
      const tabNavigation = container.ownerDocument.activeElement?.closest(".plan-section-nav");
      const execution = route.planTab === "execution";
      for (const panel of container.querySelectorAll<HTMLElement>(".plan-card > [role=tabpanel]"))
        panel.hidden = panel.id.endsWith("-execution") !== execution;
      for (const tab of container.querySelectorAll<HTMLElement>(".plan-section-nav [role=tab]")) {
        const selected = tab.id.endsWith("-execution") === execution;
        tab.setAttribute("aria-selected", String(selected));
        tab.tabIndex = selected ? 0 : -1;
        if (selected) tab.focus({ preventScroll: true });
      }
      if (!restoreReadingPosition()) window.scrollTo({ top: 0, behavior: "instant" });
      if (tabNavigation)
        container
          .querySelector<HTMLElement>('.plan-section-nav [aria-selected="true"]')
          ?.focus({ preventScroll: true });
      return;
    }
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
    if (route.view === "retrospectives")
      state = {
        ...state,
        retrospectiveFilters:
          route.retrospectiveFilters ??
          (projectChanged
            ? { project: route.projectId ?? "", status: "", task: "" }
            : state.retrospectiveFilters),
      };
    if (projectChanged || viewChanged) {
      documentRequestId++;
      state = { ...state, docs: emptyDocsState(), research: emptyDocsState() };
    }
    backlogNavigation++;
    if (viewChanged) {
      backlog.reset();
      readRequestId++;
    }

    if (projectChanged) {
      backlog.reset();
      state = {
        ...state,
        readPages: null,
        readPagesLoading: false,
        readPagesError: null,
        retrospectiveFilters: route.retrospectiveFilters ?? {
          project: route.projectId ?? "",
          status: "",
          task: "",
        },
      };
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
      if (route.view === "backlog" && route.projectId !== null)
        void loadBacklogRoute(route.projectId);
      if ((isReadPage(route.view) || route.view === "research") && route.projectId !== null)
        void loadReadPages(route.projectId);
    } else {
      if (route.view === "plans" && previousRoute.planId !== route.planId)
        state = { ...state, readPages: null };
      render();
      if (route.view === "backlog" && route.projectId !== null) {
        backlog.reset();
        void loadBacklogRoute(route.projectId);
      }
      if ((route.view === "plans" || route.view === "reports") && route.projectId !== null)
        void loadReadPages(route.projectId);
      if (route.view === "retrospectives" && route.projectId !== null) {
        if (state.readPages) {
          focusReadArtifact();
          restoreReadingPosition();
        } else void loadReadPages(route.projectId);
      }
      if (route.view === "docs" && route.projectId !== null) {
        if (previousRoute.documentPath === route.documentPath && state.docs.document)
          focusDocumentSection();
        else void loadDocs(route.projectId);
      }
      if (route.view === "research" && route.projectId !== null) {
        if (previousRoute.documentPath === route.documentPath && state.research?.document)
          focusDocumentSection();
        else void loadResearch(route.projectId);
      }
    }
  }

  const router =
    typeof options.router === "function"
      ? options.router(handleRouteChange)
      : (options.router ?? setupRouter(handleRouteChange));

  // Global event delegation on container
  function handleClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (target === null) return;

    const link = target.closest<HTMLAnchorElement>("a[href]");
    if (link && typeof window !== "undefined" && link.hash.startsWith("#/projects/")) {
      const destination = parseRoute(link.hash);
      if (destination.returnTo) {
        const origin = parseRoute(destination.returnTo);
        if (origin.projectId === state.route.projectId && origin.view === state.currentView)
          readingPositions.set(destination.returnTo, window.scrollY);
      }
    }

    if (target.closest("#docs-retry") !== null && state.selectedProjectId !== null) {
      void loadDocs(state.selectedProjectId);
      return;
    }
    if (target.closest("#research-retry") !== null && state.selectedProjectId !== null) {
      void loadResearch(state.selectedProjectId);
      return;
    }

    const expand = target.closest<HTMLElement>("[data-plan-expand]");
    if (expand) {
      for (const task of container.querySelectorAll<HTMLDetailsElement>(".plan-task"))
        task.open = expand.dataset.planExpand === "true";
      return;
    }
    const toc = target.closest<HTMLElement>(".plan-toc-toggle");
    if (toc) {
      toc.setAttribute("aria-expanded", String(toc.getAttribute("aria-expanded") !== "true"));
      return;
    }
    const taskLink = target.closest<HTMLButtonElement>("[data-plan-target]");
    if (taskLink !== null) {
      const detail = container.ownerDocument.getElementById(
        taskLink.dataset.planTarget!,
      ) as HTMLDetailsElement | null;
      if (detail && container.contains(detail)) {
        if (detail.tagName === "DETAILS") detail.open = true;
        detail.scrollIntoView({ block: "start" });
        const focusTarget = detail.tagName === "DETAILS" ? detail.querySelector("summary") : detail;
        if (focusTarget === detail) detail.tabIndex = -1;
        focusTarget?.focus({ preventScroll: true });
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
      router.navigate({
        projectId: state.selectedProjectId,
        view: "backlog",
        itemId: itemButton.dataset.backlogItem!,
        ...(state.selectedPlanId ? { planId: state.selectedPlanId } : {}),
        ...(state.route.returnTo ? { returnTo: state.route.returnTo } : {}),
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
    if (modelSelect?.id === "model-select") {
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
    const value = (name: string) =>
      (form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement).value;
    state = {
      ...state,
      retrospectiveFilters: {
        project: value("project").trim(),
        task: value("task").trim(),
        status: value("status"),
      },
    };
    const nextRoute = {
      ...state.route,
      retrospectiveId: undefined,
      retrospectiveFilters: state.retrospectiveFilters,
    };
    state = { ...state, route: nextRoute };
    render();
    router.navigate(nextRoute);
  }

  if (typeof window !== "undefined")
    window.addEventListener("scroll", saveReadingPosition, { passive: true });
  if (typeof window !== "undefined") window.addEventListener("projectops-mermaid-ready", render);
  container.addEventListener("submit", handleSubmit);
  container.addEventListener("click", handleClick);
  container.addEventListener("change", handleChange);

  // Initial load
  function onPlanTabKey(event: KeyboardEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest?.('.plan-section-nav [role="tab"]')) return;
    const tabs = Array.from(
      container.querySelectorAll<HTMLAnchorElement>('.plan-section-nav [role="tab"]'),
    );
    const current = tabs.indexOf(target as HTMLAnchorElement);
    const index =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : ["ArrowLeft", "ArrowRight"].includes(event.key)
            ? (current + 1) % tabs.length
            : -1;
    if (index < 0) return;
    event.preventDefault();
    tabs[index]?.focus();
    tabs[index]?.click();
  }
  container.addEventListener("keydown", onPlanTabKey);
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
      devServices.destroy();
      foundation.destroy();
      planGraph.destroy();
      dependencies.destroy();
      executions.destroy();
      planRuns.destroy();
      parallelRuns.destroy();
      container.removeEventListener("submit", handleSubmit);
      container.removeEventListener("click", handleClick);
      container.removeEventListener("change", handleChange);
      container.removeEventListener("keydown", onPlanTabKey);
      router.cleanup();
      if (typeof window !== "undefined")
        window.removeEventListener("projectops-mermaid-ready", render);
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
