import assert from "node:assert/strict";
import test from "node:test";

import { createApiClient } from "../src/web/apiClient.js";
import { createWorkbenchApp } from "../src/web/app.js";
import {
  escapeHtml,
  renderApp,
  renderDiagnostics,
  renderHeader,
  renderProjectNav,
} from "../src/web/render.js";
import { formatRoute, parseRoute } from "../src/web/router.js";
import {
  createInitialState,
  selectProject,
  selectView,
  setProjectSuccess,
  setRefreshing,
  setWorkspaceError,
  setWorkspaceSuccess,
} from "../src/web/state.js";
import type {
  AppState,
  WorkbenchProjectOverview,
  WorkbenchWorkspaceOverview,
} from "../src/web/types.js";

const mockWorkspace: WorkbenchWorkspaceOverview = {
  workspace: { name: "demo-workspace" },
  projects: [
    { id: "alpha", path: "repos/alpha" },
    { id: "beta", path: "repos/beta" },
  ],
  diagnostics: [
    {
      source: "workspace",
      code: "WORKSPACE_PROBLEM",
      message: "Minor warning in config",
      reference: "workspace.json",
    },
  ],
};

const mockProjectOverview: WorkbenchProjectOverview = {
  project: { id: "alpha", path: "repos/alpha" },
  backlog: {
    mode: "active",
    counts: {
      todo: 3,
      in_progress: 1,
      done: 5,
      blocked: 0,
      cancelled: 0,
    },
    recent: [
      {
        id: "ALP-001",
        title: "Setup Auth",
        item_type: "task",
        parent_id: null,
        priority: "P1",
        status: "todo",
        depends_on: [],
        updated: "2026-09-04",
        revision: "a1b2c3d4",
      },
    ],
  },
  plans: [
    {
      id: "plan-core",
      title: "Core Infrastructure",
      status: "approved",
      item_count: 4,
      execution: {
        prerequisites: { evidence: [], diagnostics: [] },
        materialized: false,
        counts: {
          total: 0,
          todo: 0,
          in_progress: 0,
          done: 0,
          blocked: 0,
          cancelled: 0,
          unreadable: 0,
        },
        completion_percent: null,
        diagnostics: [],
      },
    },
  ],
  reports: [
    {
      id: "report-alpha-v1",
      title: "Alpha V1 Delivery",
      outcome: "completed",
      created_at: "2026-09-04T12:00:00Z",
    },
  ],
  docs: {
    documents: [],
    healthy: false,
    problems: [
      {
        path: "docs/PRODUCT_SPEC.md",
        issue: "document is missing a level-one Markdown heading",
      },
    ],
  },
  retrospectives: {
    counts: {
      inbox: 1,
      active: 2,
      archive: 0,
    },
    recent: [
      {
        id: "2026-09-04-retro-1",
        status: "inbox",
        created_at: "2026-09-04T10:00:00Z",
        path: "inbox/2026-09-04-retro-1.md",
        summary: "Retrospective preview",
      },
    ],
  },
  diagnostics: [
    {
      source: "backlog",
      code: "STALE_INDEX",
      message: "Index was rebuilt recently",
    },
  ],
};

test("Workbench Router parses and formats routes accurately", () => {
  // Parsing
  assert.deepEqual(parseRoute(""), { projectId: null, view: "overview" });
  assert.deepEqual(parseRoute("#"), { projectId: null, view: "overview" });
  assert.deepEqual(parseRoute("#/"), { projectId: null, view: "overview" });
  assert.deepEqual(parseRoute("#/projects/alpha"), {
    projectId: "alpha",
    view: "overview",
  });
  assert.deepEqual(parseRoute("#/projects/alpha/backlog"), {
    projectId: "alpha",
    view: "backlog",
  });
  assert.deepEqual(parseRoute("#/projects/alpha/plans"), {
    projectId: "alpha",
    view: "plans",
  });
  assert.deepEqual(parseRoute("#/projects/alpha/reports"), {
    projectId: "alpha",
    view: "reports",
  });
  assert.deepEqual(parseRoute("#/projects/alpha/docs"), {
    projectId: "alpha",
    view: "docs",
  });
  assert.deepEqual(parseRoute("#/projects/alpha/retrospectives"), {
    projectId: "alpha",
    view: "retrospectives",
  });

  // Unknown view falls back to overview
  assert.deepEqual(parseRoute("#/projects/alpha/invalid-view"), {
    projectId: "alpha",
    view: "overview",
  });

  // Query parameter tolerance
  assert.deepEqual(parseRoute("#/projects/alpha/backlog?filter=all"), {
    projectId: "alpha",
    view: "backlog",
  });

  // URL encoded project id
  assert.deepEqual(parseRoute("#/projects/my%20project/plans"), {
    projectId: "my project",
    view: "plans",
  });

  // Malformed URL encoded project id falls back gracefully without throwing
  assert.deepEqual(parseRoute("#/projects/%/plans"), {
    projectId: "%",
    view: "plans",
  });

  // Formatting
  assert.equal(formatRoute({ projectId: null, view: "overview" }), "#/");
  assert.equal(formatRoute({ projectId: "alpha", view: "overview" }), "#/projects/alpha");
  assert.equal(formatRoute({ projectId: "alpha", view: "backlog" }), "#/projects/alpha/backlog");
  assert.equal(
    formatRoute({ projectId: "my project", view: "docs" }),
    "#/projects/my%20project/docs",
  );
});

test("Workbench State machine manages workspace and project transitions", () => {
  let state = createInitialState();
  assert.equal(state.status, "loading");
  assert.equal(state.selectedProjectId, null);
  assert.equal(state.currentView, "overview");

  // Load workspace with a specific project in route
  state = setWorkspaceSuccess(state, mockWorkspace, {
    projectId: "alpha",
    view: "backlog",
  });
  assert.equal(state.status, "ready");
  assert.equal(state.selectedProjectId, "alpha");
  assert.equal(state.currentView, "backlog");
  assert.equal(state.workspace?.workspace.name, "demo-workspace");
  assert.equal(state.projectError, null);

  // Load non-existent project in route
  state = setWorkspaceSuccess(state, mockWorkspace, {
    projectId: "non-existent",
    view: "overview",
  });
  assert.equal(state.selectedProjectId, "non-existent");
  assert.notEqual(state.projectError, null);
  assert.match(state.projectError?.message ?? "", /was not found/);

  // Switch project
  state = selectProject(state, "beta");
  assert.equal(state.selectedProjectId, "beta");
  assert.equal(state.projectLoading, true);

  // Successful project overview load
  state = setProjectSuccess(state, mockProjectOverview);
  assert.equal(state.projectLoading, false);
  assert.equal(state.projectOverview?.project.id, "alpha");

  // Switch view
  state = selectView(state, "plans");
  assert.equal(state.currentView, "plans");

  // Refreshing flag
  state = setRefreshing(state, true);
  assert.equal(state.refreshing, true);
  state = setRefreshing(state, false);
  assert.equal(state.refreshing, false);

  // Error handling
  state = setWorkspaceError(state, {
    code: "SERVER_ERROR",
    message: "Failed to connect",
  });
  assert.equal(state.status, "error");
  assert.equal(state.error?.message, "Failed to connect");
});

test("Workbench ApiClient handles success, non-JSON errors, and network failures", async () => {
  // Successful fetch
  const mockFetchSuccess: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("/api/workspace")) {
      return new Response(JSON.stringify({ ok: true, data: mockWorkspace }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/api/projects/alpha")) {
      return new Response(JSON.stringify({ ok: true, data: mockProjectOverview }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(
      JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: "Not found" } }),
      {
        status: 404,
        headers: { "content-type": "application/json" },
      },
    );
  };

  const client = createApiClient({ fetchFn: mockFetchSuccess });
  const wsRes = await client.getWorkspaceOverview();
  assert.equal(wsRes.ok, true);
  if (wsRes.ok) {
    assert.equal(wsRes.data.workspace.name, "demo-workspace");
  }

  const projRes = await client.getProjectOverview("alpha");
  assert.equal(projRes.ok, true);
  if (projRes.ok) {
    assert.equal(projRes.data.project.id, "alpha");
  }

  // Non-JSON failure
  const mockFetchNonJson: typeof fetch = async () => {
    return new Response("<html><body>Internal Error</body></html>", {
      status: 500,
      headers: { "content-type": "text/html" },
    });
  };
  const badClient = createApiClient({ fetchFn: mockFetchNonJson });
  const badRes = await badClient.getWorkspaceOverview();
  assert.equal(badRes.ok, false);
  if (!badRes.ok) {
    assert.equal(badRes.error.code, "INVALID_RESPONSE");
  }

  // Network failure
  const mockFetchNetworkError: typeof fetch = async () => {
    throw new Error("Connection refused");
  };
  const netClient = createApiClient({ fetchFn: mockFetchNetworkError });
  const netRes = await netClient.getWorkspaceOverview();
  assert.equal(netRes.ok, false);
  if (!netRes.ok) {
    assert.equal(netRes.error.code, "NETWORK_ERROR");
    assert.match(netRes.error.message, /Connection refused/);
  }
});

test("Workbench HTML Rendering covers loading, error, empty, header, and domain views", () => {
  // 1. Loading state
  const loadingState: AppState = {
    ...createInitialState(),
    status: "loading",
    refreshing: false,
    error: null,
    workspace: null,
    selectedProjectId: null,
    currentView: "overview",
    projectOverview: null,
    projectLoading: false,
    projectError: null,
  };
  const loadingHtml = renderApp(loadingState);
  assert.match(loadingHtml, /role="status"/);
  assert.match(loadingHtml, /Connecting to local ProjectOps server/);
  assert.match(loadingHtml, /spinner/);

  // 2. Server Error state
  const errorState: AppState = {
    ...loadingState,
    status: "error",
    error: { message: "Server connection failed" },
  };
  const errorHtml = renderApp(errorState);
  assert.match(errorHtml, /role="alert"/);
  assert.match(errorHtml, /Server Connection Error/);
  assert.match(errorHtml, /Server connection failed/);
  assert.match(errorHtml, /id="btn-retry"/);

  // 3. Empty workspace state
  const emptyState: AppState = {
    ...loadingState,
    status: "ready",
    workspace: { workspace: { name: "fresh-workspace" }, projects: [], diagnostics: [] },
  };
  const emptyHtml = renderApp(emptyState);
  assert.match(emptyHtml, /Empty Workspace/);
  assert.match(emptyHtml, /fresh-workspace/);
  assert.match(emptyHtml, /pops project add/);

  // 4. Header & diagnostics
  const headerState: AppState = {
    ...loadingState,
    status: "ready",
    workspace: mockWorkspace,
    refreshing: true,
  };
  const headerHtml = renderHeader(headerState);
  assert.match(headerHtml, /demo-workspace/);
  assert.match(headerHtml, /Refreshing…/);
  assert.match(headerHtml, /id="btn-refresh"/);

  const diagHtml = renderDiagnostics(mockWorkspace.diagnostics, "Test Diagnostics");
  assert.match(diagHtml, /Minor warning in config/);
  assert.match(diagHtml, /workspace\.json/);

  // 5. Project Navigation & Tabs
  const navState: AppState = {
    ...loadingState,
    status: "ready",
    workspace: mockWorkspace,
    selectedProjectId: "alpha",
    currentView: "backlog",
    projectOverview: mockProjectOverview,
  };
  const navHtml = renderProjectNav(navState);
  assert.match(navHtml, /id="project-select"/);
  assert.match(navHtml, /value="alpha" selected/);
  assert.match(navHtml, /role="tablist"/);
  assert.match(navHtml, /href="#\/projects\/alpha\/backlog"/);
  assert.match(navHtml, /3 todo/); // Backlog badge

  // 6. Selected Project Overview view
  const readyState: AppState = {
    ...loadingState,
    status: "ready",
    workspace: mockWorkspace,
    selectedProjectId: "alpha",
    currentView: "overview",
    projectOverview: mockProjectOverview,
  };
  const overviewHtml = renderApp(readyState);
  assert.match(overviewHtml, /Backlog/);
  assert.match(overviewHtml, /ALP-001/);
  assert.match(overviewHtml, /Setup Auth/);
  assert.match(overviewHtml, /Core Infrastructure/);
  assert.match(overviewHtml, /Alpha V1 Delivery/);
  assert.match(overviewHtml, /Project Docs/);
  assert.match(overviewHtml, /Retrospectives/);

  // 7. Selected Project Backlog view
  const backlogState: AppState = {
    ...readyState,
    currentView: "backlog",
    backlog: { ...readyState.backlog, projectId: "alpha", items: [] },
  };
  const backlogHtml = renderApp(backlogState);
  assert.match(backlogHtml, /No backlog items found/);
  assert.match(backlogHtml, /选择一个任务/);

  // 8. Selected Project Docs view
  const docsState: AppState = {
    ...readyState,
    currentView: "docs",
    route: { projectId: "alpha", view: "docs", documentPath: "docs/PRODUCT_SPEC.md" },
    docs: {
      loading: false,
      error: null,
      listError: null,
      list: {
        documents: mockProjectOverview.docs.problems.map((d) => ({ ...d, standard: true })),
        diagnostics: [],
      },
      document: { path: "docs/PRODUCT_SPEC.md", body: "Readable even without a heading" },
    },
  };
  const docsHtml = renderApp(docsState);
  assert.match(docsHtml, /Readable even without a heading/);
  assert.match(docsHtml, /aria-label="章节目录"/);
  assert.match(docsHtml, /docs\/PRODUCT_SPEC\.md/);
  assert.match(docsHtml, /document is missing a level-one Markdown heading/);

  // 9. Selected Project Retrospectives view
  const retroState: AppState = {
    ...readyState,
    currentView: "retrospectives",
    readPages: {
      plans: [],
      reports: [],
      documents: [],
      diagnostics: [],
      retrospectives: [
        {
          schema: "retrospective/Retrospective@1",
          id: "2026-09-04-retro-1",
          status: "inbox",
          project: "alpha",
          task: null,
          created_at: "2026-09-04",
          trigger: "workflow-friction",
          harness: "test",
          model: null,
          body: "Evidence",
          path: "inbox/2026-09-04-retro-1.md",
          revision: "test",
        },
      ],
    },
  };
  const retroHtml = renderApp(retroState);
  assert.match(retroHtml, /2026-09-04-retro-1/);
  assert.match(retroHtml, /badge-inbox/);

  // 10. HTML escaping
  const evilString = '<script>alert("xss")</script>&"\'';
  const escaped = escapeHtml(evilString);
  assert.equal(escaped.includes("<script>"), false);
  assert.match(escaped, /&lt;script&gt;/);
});

test("Workbench App discards out-of-order project responses when route changes", async () => {
  type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };
  function defer<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  }

  const alphaDeferred = defer<any>();
  const betaDeferred = defer<any>();

  const fakeApiClient = {
    getWorkspaceOverview: async () => ({ ok: true as const, data: mockWorkspace }),
    getProjectOverview: async (projectId: string) => {
      if (projectId === "alpha") return alphaDeferred.promise;
      if (projectId === "beta") return betaDeferred.promise;
      return { ok: false as const, error: { message: "not found" } };
    },
  };

  let notifyRoute!: (route: { projectId: string | null; view: "overview" }) => void;
  let currentRoute = { projectId: "alpha", view: "overview" as const };
  const routerFactory = (
    onChange: (route: { projectId: string | null; view: "overview" }) => void,
  ) => {
    notifyRoute = onChange;
    return {
      getCurrentRoute: () => currentRoute,
      navigate: (route: any) => {
        currentRoute = route;
        onChange(route);
      },
      cleanup: () => {},
    };
  };

  let containerHtml = "";
  const fakeContainer: any = {
    set innerHTML(val: string) {
      containerHtml = val;
    },
    get innerHTML() {
      return containerHtml;
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  const app = createWorkbenchApp({
    container: fakeContainer,
    apiClient: fakeApiClient as any,
    router: routerFactory as any,
  });

  // Yield to allow initial workspace fetch and project "alpha" fetch to start
  await new Promise((r) => setImmediate(r));
  assert.equal(app.getState().selectedProjectId, "alpha");
  assert.equal(app.getState().projectLoading, true);

  // User navigates to "beta" before "alpha" resolves
  currentRoute = { projectId: "beta", view: "overview" };
  notifyRoute(currentRoute);

  assert.equal(app.getState().selectedProjectId, "beta");
  assert.equal(app.getState().projectLoading, true);

  // Beta resolves first (faster response)
  const betaOverview = {
    ...mockProjectOverview,
    project: { id: "beta", path: "repos/beta" },
  };
  betaDeferred.resolve({ ok: true, data: betaOverview });
  await new Promise((r) => setImmediate(r));

  assert.equal(app.getState().selectedProjectId, "beta");
  assert.equal(app.getState().projectOverview?.project.id, "beta");
  assert.equal(app.getState().projectLoading, false);

  // Now older alpha resolves (slower response)
  alphaDeferred.resolve({ ok: true, data: mockProjectOverview });
  await new Promise((r) => setImmediate(r));

  // State must NOT be overwritten by the stale alpha response!
  assert.equal(app.getState().selectedProjectId, "beta");
  assert.equal(app.getState().projectOverview?.project.id, "beta");
  assert.match(fakeContainer.innerHTML, /beta/);

  app.destroy();
});

test("Workbench App handles route change while initial workspace is loading without dropping workspace", async () => {
  function defer<T>() {
    let resolve!: (val: T) => void;
    const promise = new Promise<T>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  const workspaceDeferred = defer<any>();
  const betaDeferred = defer<any>();

  const fakeApiClient = {
    getWorkspaceOverview: async () => workspaceDeferred.promise,
    getProjectOverview: async (projectId: string) => {
      if (projectId === "beta") return betaDeferred.promise;
      return { ok: false as const, error: { message: "not found" } };
    },
  };

  let notifyRoute!: (route: { projectId: string | null; view: "overview" }) => void;
  let currentRoute: { projectId: string | null; view: "overview" } = {
    projectId: null,
    view: "overview",
  };
  const routerFactory = (
    onChange: (route: { projectId: string | null; view: "overview" }) => void,
  ) => {
    notifyRoute = onChange;
    return {
      getCurrentRoute: () => currentRoute,
      navigate: (route: any) => {
        currentRoute = route;
        onChange(route);
      },
      cleanup: () => {},
    };
  };

  let containerHtml = "";
  const fakeContainer: any = {
    set innerHTML(val: string) {
      containerHtml = val;
    },
    get innerHTML() {
      return containerHtml;
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  const app = createWorkbenchApp({
    container: fakeContainer,
    apiClient: fakeApiClient as any,
    router: routerFactory as any,
  });

  // User navigates to "beta" while workspace fetch is still pending
  currentRoute = { projectId: "beta", view: "overview" };
  notifyRoute(currentRoute);

  // Status should still be loading workspace
  assert.equal(app.getState().status, "loading");
  assert.equal(app.getState().selectedProjectId, "beta");

  // Now workspace resolves
  workspaceDeferred.resolve({ ok: true, data: mockWorkspace });
  await new Promise((r) => setImmediate(r));

  // Workspace must be loaded (status: ready, workspace populated) and beta loading
  assert.equal(app.getState().status, "ready");
  assert.notEqual(app.getState().workspace, null);
  assert.equal(app.getState().selectedProjectId, "beta");
  assert.equal(app.getState().projectLoading, true);

  // Beta resolves
  const betaOverview = {
    ...mockProjectOverview,
    project: { id: "beta", path: "repos/beta" },
  };
  betaDeferred.resolve({ ok: true, data: betaOverview });
  await new Promise((r) => setImmediate(r));

  assert.equal(app.getState().projectOverview?.project.id, "beta");
  assert.equal(app.getState().projectLoading, false);

  app.destroy();
});

test("Workbench App clears refreshing state when navigating to home", async () => {
  function defer<T>() {
    let resolve!: (val: T) => void;
    const promise = new Promise<T>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  const refreshDeferred = defer<any>();
  let fetchCount = 0;

  const fakeApiClient = {
    getWorkspaceOverview: async () => {
      fetchCount++;
      if (fetchCount === 1) {
        return { ok: true as const, data: mockWorkspace };
      }
      return refreshDeferred.promise;
    },
    getProjectOverview: async () => ({ ok: true as const, data: mockProjectOverview }),
  };

  let notifyRoute!: (route: { projectId: string | null; view: "overview" }) => void;
  let currentRoute: { projectId: string | null; view: "overview" } = {
    projectId: "alpha",
    view: "overview",
  };
  const routerFactory = (
    onChange: (route: { projectId: string | null; view: "overview" }) => void,
  ) => {
    notifyRoute = onChange;
    return {
      getCurrentRoute: () => currentRoute,
      navigate: (route: any) => {
        currentRoute = route;
        onChange(route);
      },
      cleanup: () => {},
    };
  };

  let containerHtml = "";
  let clickHandler!: (e: any) => void;
  const fakeContainer: any = {
    set innerHTML(val: string) {
      containerHtml = val;
    },
    get innerHTML() {
      return containerHtml;
    },
    addEventListener: (type: string, handler: any) => {
      if (type === "click") clickHandler = handler;
    },
    removeEventListener: () => {},
  };

  const app = createWorkbenchApp({
    container: fakeContainer,
    apiClient: fakeApiClient as any,
    router: routerFactory as any,
  });

  await new Promise((r) => setImmediate(r));
  assert.equal(app.getState().status, "ready");
  assert.equal(app.getState().selectedProjectId, "alpha");

  // Trigger refresh
  clickHandler({
    target: {
      closest: (sel: string) => (sel === "#btn-refresh" ? {} : null),
    },
    preventDefault: () => {},
  });
  assert.equal(app.getState().refreshing, true);

  // Navigate to home while refresh is in flight
  currentRoute = { projectId: null, view: "overview" };
  notifyRoute(currentRoute);

  // Refreshing must be cleared, selectedProjectId must be null
  assert.equal(app.getState().refreshing, false);
  assert.equal(app.getState().selectedProjectId, null);

  // When stale refresh resolves, it must not resurrect refreshing or mutate state
  refreshDeferred.resolve({ ok: true, data: mockWorkspace });
  await new Promise((r) => setImmediate(r));

  assert.equal(app.getState().refreshing, false);
  assert.equal(app.getState().selectedProjectId, null);

  app.destroy();
});
