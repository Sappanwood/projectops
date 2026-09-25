import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { ReportsPage, RetrospectivesPage } from "./artifactView.js";
import { BacklogPage } from "./backlogView.js";
import { DocumentLibrary } from "./documentView.js";
import { renderModelSelector } from "./modelSelector.js";
import { OverviewPage, WorkspaceLanding } from "./overviewView.js";
import { PlansPage } from "./planView.js";
import { RenderedHtml } from "./readingView.js";
import { renderDiagnostics } from "./render.js";
import { formatRoute } from "./router.js";
import type { AppState, ViewType } from "./types.js";

export function WorkbenchHeader({ state }: { state: AppState }) {
  const status = state.refreshing ? "refreshing" : state.status;
  const text = state.refreshing
    ? "Refreshing…"
    : state.status === "loading"
      ? "Connecting…"
      : state.status === "error"
        ? "Error"
        : "Connected";
  return (
    <header className="workbench-header">
      <div className="header-brand">
        <a href="#/" className="brand-link">
          <span className="brand-title">ProjectOps</span>
        </a>
        <span className="brand-divider" aria-hidden="true">
          /
        </span>
        <span className="workspace-label">Workspace:</span>
        <span className="workspace-name">{state.workspace?.workspace.name ?? "ProjectOps"}</span>
      </div>
      <div className="header-controls">
        <RenderedHtml html={renderModelSelector(state.modelSelection)} />
        <div className="header-status" aria-live="polite">
          <span
            className={`status-indicator status-${status}`}
            role={status === "ready" ? undefined : "status"}
          >
            {text}
          </span>
        </div>
        <button
          id="btn-refresh"
          className="btn btn-secondary btn-refresh"
          type="button"
          aria-label="Refresh workspace and project data"
          disabled={state.refreshing || state.status === "loading"}
        >
          刷新
        </button>
      </div>
    </header>
  );
}

export function ProjectNavigation({ state }: { state: AppState }) {
  if (state.status !== "ready" || !state.workspace?.projects.length) return null;
  const overview = state.projectOverview;
  const tabs: Array<{ id: ViewType; label: string; badge?: string | undefined }> = [
    { id: "overview", label: "Overview" },
    {
      id: "backlog",
      label: "Backlog",
      badge: overview ? `${overview.backlog.counts.todo} todo` : undefined,
    },
    { id: "plans", label: "Plans", badge: overview ? `${overview.plans.length}` : undefined },
    { id: "reports", label: "Reports", badge: overview ? `${overview.reports.length}` : undefined },
    {
      id: "docs",
      label: "Docs",
      badge: overview ? (overview.docs.healthy ? "OK" : "Issues") : undefined,
    },
    { id: "research", label: "Research" },
    {
      id: "retrospectives",
      label: "Retrospectives",
      badge: overview
        ? `${overview.retrospectives.counts.inbox + overview.retrospectives.counts.active}`
        : undefined,
    },
  ];
  return (
    <div className="project-nav">
      <nav className="project-switcher" aria-label="项目切换">
        <span className="selector-label">项目</span>
        <div className="project-links">
          {state.workspace.projects
            .toSorted((a, b) => a.id.localeCompare(b.id))
            .map((project) => (
              <a
                key={project.id}
                className={`tab-link project-link${project.id === state.selectedProjectId ? " active" : ""}`}
                href={formatRoute({ projectId: project.id, view: state.currentView })}
                aria-current={project.id === state.selectedProjectId ? "true" : undefined}
              >
                {project.id}
              </a>
            ))}
        </div>
      </nav>
      {state.selectedProjectId !== null && (
        <ul className="domain-tabs" role="tablist" aria-label="Project domains">
          {tabs.map((tab) => (
            <li key={tab.id} role="presentation" className="tab-item">
              <a
                role="tab"
                className={`tab-link ${tab.id === state.currentView ? "active" : ""}`}
                aria-selected={tab.id === state.currentView}
                aria-controls={`panel-${tab.id}`}
                id={`tab-${tab.id}`}
                href={`#/projects/${encodeURIComponent(state.selectedProjectId!)}/${tab.id}`}
              >
                <span className="tab-label">{tab.label}</span>
                {tab.badge !== undefined && (
                  <span
                    className={`tab-badge ${tab.id === "docs" && overview?.docs.healthy === false ? "badge-problem" : ""}`}
                  >
                    {tab.badge}
                  </span>
                )}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReadPage({ state }: { state: AppState }) {
  const view = state.currentView;
  const data = state.readPages;
  return (
    <>
      <div className="plan-load-status" aria-live="polite">
        {state.readPagesLoading && (
          <p role="status">{data ? "正在刷新，暂显示上次读取内容。" : "Loading read-only view…"}</p>
        )}
        {state.readPagesError && (
          <>
            <p role="alert">
              {state.readPagesError.message}
              {data ? " 当前显示上次读取内容，刷新未成功。" : ""}
            </p>
            <button id="read-pages-retry" className="btn btn-secondary">
              Retry
            </button>
          </>
        )}
      </div>
      <RenderedHtml
        html={renderDiagnostics(
          data?.diagnostics.filter(
            (d) => d.source === view || (view === "plans" && d.source === "reports"),
          ) ?? [],
          `${view} diagnostics`,
        )}
      />
      {data &&
        (view === "plans" ? (
          <PlansPage plans={data.plans} route={state.route} />
        ) : view === "reports" ? (
          <ReportsPage reports={data.reports} route={state.route} />
        ) : (
          <RetrospectivesPage
            records={data.retrospectives}
            filters={state.retrospectiveFilters}
            route={state.route}
          />
        ))}
    </>
  );
}

export function WorkbenchContent({ state }: { state: AppState }) {
  if (state.status === "loading")
    return (
      <div className="state-container state-loading" role="status" aria-live="polite">
        <div className="spinner" aria-hidden="true" />
        <h2>Loading Workbench</h2>
        <p>Connecting to local ProjectOps server...</p>
      </div>
    );
  if (state.status === "error")
    return (
      <div className="state-container state-error" role="alert">
        <h2>Server Connection Error</h2>
        <p className="error-message">{state.error?.message ?? "An unexpected error occurred."}</p>
        <p className="error-hint">
          Ensure that the ProjectOps local server is running on the expected port.
        </p>
        <button id="btn-retry" className="btn btn-primary" type="button">
          Retry Connection
        </button>
      </div>
    );
  if (!state.workspace?.projects.length)
    return (
      <div className="state-container state-empty">
        <h2>Empty Workspace</h2>
        <p>
          Workspace <strong>{state.workspace?.workspace.name ?? ""}</strong> has no registered
          projects.
        </p>
        <div className="command-guide">
          <p>Register your first project in this workspace using the CLI:</p>
          <pre>
            <code>pops project add &lt;relative-or-absolute-path&gt;</code>
          </pre>
        </div>
      </div>
    );
  if (state.selectedProjectId === null) return <WorkspaceLanding state={state} />;
  if (state.projectError)
    return (
      <div className="state-container state-error" role="alert">
        <h2>Project Not Available</h2>
        <p className="error-message">{state.projectError.message}</p>
        <a href="#/" className="btn btn-secondary">
          Return to Workspace
        </a>
      </div>
    );
  if (state.projectLoading)
    return (
      <div className="state-container state-loading" role="status" aria-live="polite">
        <div className="spinner" aria-hidden="true" />
        <h2>Loading Project</h2>
        <p>
          Fetching overview for project <strong>{state.selectedProjectId}</strong>...
        </p>
      </div>
    );
  if (!state.projectOverview)
    return (
      <div className="state-container state-empty">
        <p>No project data available.</p>
      </div>
    );
  const view = state.currentView;
  return (
    <div
      id={`panel-${view}`}
      role="tabpanel"
      aria-labelledby={`tab-${view}`}
      key={`${state.selectedProjectId}/${view}`}
    >
      {(view === "overview" || view === "backlog") && (
        <RenderedHtml
          html={renderDiagnostics(
            state.projectOverview.diagnostics,
            `Project Diagnostics for ${state.selectedProjectId}`,
          )}
        />
      )}
      {view === "overview" ? (
        <OverviewPage overview={state.projectOverview} />
      ) : view === "backlog" ? (
        <>
          {state.selectedPlanId && !state.route.returnTo && (
            <p>
              <a
                className="btn btn-secondary"
                href={formatRoute({
                  projectId: state.selectedProjectId,
                  view: "plans",
                  planId: state.selectedPlanId,
                })}
              >
                返回原 Plan
              </a>
            </p>
          )}
          <BacklogPage state={state.backlog} />
        </>
      ) : view === "docs" || view === "research" ? (
        <DocumentLibrary
          state={
            view === "docs"
              ? state.docs
              : (state.research ?? { ...state.docs, list: null, document: null })
          }
          route={state.route}
          library={view}
        />
      ) : (
        <ReadPage state={state} />
      )}
    </div>
  );
}

export function Workbench({ state }: { state: AppState }) {
  return (
    <div className="workbench-app review-workbench">
      <div className="review-app-header">
        <WorkbenchHeader state={state} />
      </div>
      <div className="review-app-layout">
        <aside className="review-app-sidebar">
          <a className="review-sidebar-brand" href="#/">
            <span aria-hidden="true">P</span> ProjectOps
          </a>
          <p className="plan-eyebrow">WORKSPACE</p>
          <ProjectNavigation state={state} />
          <p className="review-sidebar-foot">提案 · 审阅 · 交付</p>
        </aside>
        <main id="workbench-content" className="workbench-main" tabIndex={-1}>
          <RenderedHtml
            html={renderDiagnostics(state.workspace?.diagnostics ?? [], "Workspace Diagnostics")}
          />
          {state.route.returnTo && (
            <p>
              <a className="btn btn-secondary" href={state.route.returnTo}>
                {state.route.returnTo ===
                  formatRoute({ projectId: state.selectedProjectId, view: "overview" }) ||
                state.route.returnTo.endsWith("/overview")
                  ? "返回 Overview"
                  : /\/plans\/[^/?]+(?:\?|$)/.test(state.route.returnTo)
                    ? "返回原 Plan"
                    : "返回来源页面"}
              </a>
            </p>
          )}
          <WorkbenchContent state={state} />
        </main>
      </div>
    </div>
  );
}

export function createWorkbenchRenderer(container: HTMLElement) {
  let root: Root | null = null;
  return {
    render(state: AppState) {
      root ??= createRoot(container);
      // Controllers populate only their empty hosts after React commits the page.
      flushSync(() => root!.render(<Workbench state={state} />));
    },
    destroy() {
      root?.unmount();
      root = null;
    },
  };
}
