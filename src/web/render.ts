import { isReadPage, renderReadPages } from "./readPagesView.js";
import type {
  AppState,
  ViewType,
  WorkbenchBacklogSummary,
  WorkbenchDiagnostic,
  WorkbenchProjectOverview,
} from "./types.js";
import { renderBacklogPanel } from "./backlogView.js";
import { emptyBacklogState, type BacklogViewState } from "./backlogController.js";

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function renderApp(state: AppState): string {
  return `
    <div class="workbench-app">
      ${renderHeader(state)}
      ${renderDiagnostics(state.workspace?.diagnostics ?? [], "Workspace Diagnostics")}
      ${renderProjectNav(state)}
      <main id="workbench-content" class="workbench-main" tabindex="-1">
        ${renderContent(state)}
      </main>
    </div>
  `;
}

export function renderHeader(state: AppState): string {
  const workspaceName = state.workspace?.workspace.name ?? "ProjectOps";
  let statusBadge = `<span class="status-indicator status-ready">Connected</span>`;
  if (state.refreshing) {
    statusBadge = `<span class="status-indicator status-refreshing" role="status">Refreshing…</span>`;
  } else if (state.status === "loading") {
    statusBadge = `<span class="status-indicator status-loading" role="status">Connecting…</span>`;
  } else if (state.status === "error") {
    statusBadge = `<span class="status-indicator status-error" role="status">Error</span>`;
  }

  return `
    <header class="workbench-header">
      <div class="header-brand">
        <a href="#/" class="brand-link">
          <span class="brand-title">ProjectOps</span>
        </a>
        <span class="brand-divider" aria-hidden="true">/</span>
        <span class="workspace-label">Workspace:</span>
        <span class="workspace-name">${escapeHtml(workspaceName)}</span>
      </div>
      <div class="header-controls">
        <div class="header-status" aria-live="polite">${statusBadge}</div>
        <button
          id="btn-refresh"
          class="btn btn-secondary btn-refresh"
          type="button"
          aria-label="Refresh workspace and project data"
          ${state.refreshing || state.status === "loading" ? "disabled" : ""}
        >
          🔄 Refresh
        </button>
      </div>
    </header>
  `;
}

export function renderDiagnostics(
  diagnostics: WorkbenchDiagnostic[],
  title: string,
): string {
  if (diagnostics.length === 0) return "";
  const items = diagnostics
    .map((diag) => {
      const ref = diag.reference
        ? ` <span class="diagnostic-ref">(${escapeHtml(diag.reference)})</span>`
        : "";
      return `
        <li class="diagnostic-item">
          <span class="diagnostic-source-badge">${escapeHtml(diag.source)}</span>
          <code class="diagnostic-code">${escapeHtml(diag.code)}</code>:
          <span class="diagnostic-message">${escapeHtml(diag.message)}</span>${ref}
        </li>
      `;
    })
    .join("\n");

  return `
    <section class="diagnostics-panel" aria-label="${escapeHtml(title)}">
      <div class="diagnostics-header">
        <span class="diagnostics-icon" aria-hidden="true">⚠️</span>
        <h3 class="diagnostics-title">${escapeHtml(title)} (${diagnostics.length})</h3>
      </div>
      <ul class="diagnostics-list">
        ${items}
      </ul>
    </section>
  `;
}

export function renderProjectNav(state: AppState): string {
  if (state.status === "loading" || state.status === "error") {
    return "";
  }

  const projects = state.workspace?.projects ?? [];
  const options = projects
    .map((p) => {
      const isSelected = p.id === state.selectedProjectId;
      return `<option value="${escapeHtml(p.id)}" ${isSelected ? "selected" : ""}>${escapeHtml(p.id)} (${escapeHtml(p.path)})</option>`;
    })
    .join("\n");

  const selectorHtml = `
    <div class="project-selector-wrapper">
      <label for="project-select" class="selector-label">Project:</label>
      <select
        id="project-select"
        class="form-select project-select"
        aria-label="Select active project"
      >
        <option value="" ${state.selectedProjectId === null ? "selected" : ""}>-- Select Project --</option>
        ${options}
      </select>
    </div>
  `;

  const tabsHtml = state.selectedProjectId !== null
    ? renderDomainTabs(state.selectedProjectId, state.currentView, state.projectOverview)
    : "";

  return `
    <nav class="project-nav" aria-label="Project and domain navigation">
      ${selectorHtml}
      ${tabsHtml}
    </nav>
  `;
}

export function renderDomainTabs(
  projectId: string,
  currentView: ViewType,
  overview: WorkbenchProjectOverview | null,
): string {
  const tabs: Array<{ id: ViewType; label: string; badge?: string | undefined }> = [
    { id: "overview", label: "Overview" },
    {
      id: "backlog",
      label: "Backlog",
      badge: overview ? `${overview.backlog.counts.todo} todo` : undefined,
    },
    {
      id: "plans",
      label: "Plans",
      badge: overview ? `${overview.plans.length}` : undefined,
    },
    {
      id: "reports",
      label: "Reports",
      badge: overview ? `${overview.reports.length}` : undefined,
    },
    {
      id: "docs",
      label: "Docs",
      badge: overview ? (overview.docs.healthy ? "OK" : "Issues") : undefined,
    },
    {
      id: "retrospectives",
      label: "Retrospectives",
      badge: overview
        ? `${overview.retrospectives.counts.inbox + overview.retrospectives.counts.active}`
        : undefined,
    },
  ];

  const tabItems = tabs
    .map((tab) => {
      const isActive = tab.id === currentView;
      const href = `#/projects/${encodeURIComponent(projectId)}/${tab.id}`;
      const badgeHtml = tab.badge !== undefined
        ? `<span class="tab-badge ${tab.id === "docs" && overview?.docs.healthy === false ? "badge-problem" : ""}">${escapeHtml(tab.badge)}</span>`
        : "";

      return `
        <li role="presentation" class="tab-item">
          <a
            role="tab"
            class="tab-link ${isActive ? "active" : ""}"
            aria-selected="${isActive}"
            aria-controls="panel-${tab.id}"
            id="tab-${tab.id}"
            href="${href}"
          >
            <span class="tab-label">${escapeHtml(tab.label)}</span>
            ${badgeHtml}
          </a>
        </li>
      `;
    })
    .join("\n");

  return `
    <ul class="domain-tabs" role="tablist" aria-label="Project domains">
      ${tabItems}
    </ul>
  `;
}

export function renderContent(state: AppState): string {
  if (state.status === "loading") {
    return `
      <div class="state-container state-loading" role="status" aria-live="polite">
        <div class="spinner" aria-hidden="true"></div>
        <h2>Loading Workbench</h2>
        <p>Connecting to local ProjectOps server...</p>
      </div>
    `;
  }

  if (state.status === "error") {
    return `
      <div class="state-container state-error" role="alert">
        <div class="error-icon" aria-hidden="true">❌</div>
        <h2>Server Connection Error</h2>
        <p class="error-message">${escapeHtml(state.error?.message ?? "An unexpected error occurred.")}</p>
        <p class="error-hint">Ensure that the ProjectOps local server is running on the expected port.</p>
        <button id="btn-retry" class="btn btn-primary" type="button">Retry Connection</button>
      </div>
    `;
  }

  const projects = state.workspace?.projects ?? [];
  if (projects.length === 0) {
    return `
      <div class="state-container state-empty">
        <div class="empty-icon" aria-hidden="true">📂</div>
        <h2>Empty Workspace</h2>
        <p>Workspace <strong>${escapeHtml(state.workspace?.workspace.name ?? "")}</strong> has no registered projects.</p>
        <div class="command-guide">
          <p>Register your first project in this workspace using the CLI:</p>
          <pre><code>pops project add &lt;relative-or-absolute-path&gt;</code></pre>
        </div>
      </div>
    `;
  }

  if (state.selectedProjectId === null) {
    return renderWorkspaceLanding(state);
  }

  if (state.projectError !== null) {
    return `
      <div class="state-container state-error" role="alert">
        <div class="error-icon" aria-hidden="true">⚠️</div>
        <h2>Project Not Available</h2>
        <p class="error-message">${escapeHtml(state.projectError.message)}</p>
        <a href="#/" class="btn btn-secondary">Return to Workspace</a>
      </div>
    `;
  }

  if (state.projectLoading) {
    return `
      <div class="state-container state-loading" role="status" aria-live="polite">
        <div class="spinner" aria-hidden="true"></div>
        <h2>Loading Project</h2>
        <p>Fetching overview for project <strong>${escapeHtml(state.selectedProjectId)}</strong>...</p>
      </div>
    `;
  }

  if (state.projectOverview !== null && isReadPage(state.currentView)) {
    let content = '<p role="status">Loading read-only view…</p>';
    if (state.readPagesError !== null) content = `<p role="alert">${escapeHtml(state.readPagesError.message)}</p><button id="read-pages-retry" class="btn btn-secondary">Retry</button>`;
    else if (!state.readPagesLoading && state.readPages !== null) content = renderReadPages(state.currentView, state.readPages, state.retrospectiveFilters);
    return `<div id="panel-${state.currentView}" role="tabpanel" aria-labelledby="tab-${state.currentView}">${content}</div>`;
  }
  if (state.projectOverview !== null) {
    return renderProjectView(state.currentView, state.projectOverview, state.backlog);
  }

  return `
    <div class="state-container state-empty">
      <p>No project data available.</p>
    </div>
  `;
}

function renderWorkspaceLanding(state: AppState): string {
  const projects = state.workspace?.projects ?? [];
  const cards = projects
    .map((p) => {
      const targetUrl = `#/projects/${encodeURIComponent(p.id)}/overview`;
      return `
        <a href="${targetUrl}" class="project-card" data-project-id="${escapeHtml(p.id)}">
          <div class="project-card-header">
            <h3 class="project-card-title">${escapeHtml(p.id)}</h3>
            <span class="project-card-arrow" aria-hidden="true">→</span>
          </div>
          <p class="project-card-path">Path: <code>${escapeHtml(p.path)}</code></p>
        </a>
      `;
    })
    .join("\n");

  return `
    <div class="workspace-landing">
      <div class="landing-header">
        <h2>Workspace Projects</h2>
        <p>Select a project to explore its Backlog, Plans, Reports, Docs, and Retrospectives.</p>
      </div>
      <div class="project-grid">
        ${cards}
      </div>
    </div>
  `;
}

export function renderProjectView(
  view: ViewType,
  overview: WorkbenchProjectOverview,
  backlog: BacklogViewState = emptyBacklogState(),
): string {
  const diagnosticsHtml = renderDiagnostics(
    overview.diagnostics,
    `Project Diagnostics for ${overview.project.id}`,
  );

  let viewContent = "";
  switch (view) {
    case "overview":
      viewContent = renderOverviewTab(overview);
      break;
    case "backlog":
      viewContent = renderBacklogPanel(backlog);
      break;
    case "plans":
    case "reports":
    case "docs":
    case "retrospectives":
      viewContent = '<p role="status">Loading read-only view…</p>';
      break;
  }

  return `
    <div class="project-view-container" id="panel-${view}" role="tabpanel" aria-labelledby="tab-${view}">
      ${diagnosticsHtml}
      ${viewContent}
    </div>
  `;
}

function renderOverviewTab(overview: WorkbenchProjectOverview): string {
  const bCounts = overview.backlog.counts;

  return `
    <div class="overview-grid">
      <!-- Backlog Card -->
      <section class="overview-card" aria-labelledby="card-backlog-title">
        <div class="card-header">
          <h3 id="card-backlog-title">Backlog</h3>
          <a href="#/projects/${encodeURIComponent(overview.project.id)}/backlog" class="card-link">Backlog →</a>
        </div>
        <div class="counts-row">
          <span class="badge badge-todo">${bCounts.todo} todo</span>
          <span class="badge badge-inprogress">${bCounts.in_progress} in progress</span>
          <span class="badge badge-blocked">${bCounts.blocked} blocked</span>
          <span class="badge badge-done">${bCounts.done} done</span>
        </div>
        <div class="card-body">
          <h4>Recent Items</h4>
          ${renderRecentBacklogList(overview.backlog.recent)}
        </div>
      </section>

      <!-- Plans Card -->
      <section class="overview-card" aria-labelledby="card-plans-title">
        <div class="card-header">
          <h3 id="card-plans-title">Plans (${overview.plans.length})</h3>
          <a href="#/projects/${encodeURIComponent(overview.project.id)}/plans" class="card-link">Plans →</a>
        </div>
        <div class="card-body">
          ${renderPlansList(overview.plans.slice(0, 5))}
        </div>
      </section>

      <!-- Reports Card -->
      <section class="overview-card" aria-labelledby="card-reports-title">
        <div class="card-header">
          <h3 id="card-reports-title">Reports (${overview.reports.length})</h3>
          <a href="#/projects/${encodeURIComponent(overview.project.id)}/reports" class="card-link">Reports →</a>
        </div>
        <div class="card-body">
          ${renderReportsList(overview.reports.slice(0, 5))}
        </div>
      </section>

      <!-- Docs Card -->
      <section class="overview-card" aria-labelledby="card-docs-title">
        <div class="card-header">
          <h3 id="card-docs-title">Project Docs</h3>
          <a href="#/projects/${encodeURIComponent(overview.project.id)}/docs" class="card-link">Docs →</a>
        </div>
        <div class="card-body">
          <div class="docs-status-row">
            Status: <span class="badge ${overview.docs.healthy ? "badge-healthy" : "badge-problem"}">
              ${overview.docs.healthy ? "✓ All standard docs present" : (overview.docs.problems.length > 0 ? `⚠️ ${overview.docs.problems.length} problems detected` : "⚠️ Inspection unavailable")}
            </span>
          </div>
        </div>
      </section>

      <!-- Retrospectives Card -->
      <section class="overview-card" aria-labelledby="card-retro-title">
        <div class="card-header">
          <h3 id="card-retro-title">Retrospectives</h3>
          <a href="#/projects/${encodeURIComponent(overview.project.id)}/retrospectives" class="card-link">Retrospectives →</a>
        </div>
        <div class="counts-row">
          <span class="badge badge-inbox">${overview.retrospectives.counts.inbox} inbox</span>
          <span class="badge badge-active">${overview.retrospectives.counts.active} active</span>
          <span class="badge badge-archive">${overview.retrospectives.counts.archive} archive</span>
        </div>
        <div class="card-body">
          ${renderRecentRetrospectivesList(overview.retrospectives.recent)}
        </div>
      </section>
    </div>
  `;
}

function renderRecentBacklogList(items: WorkbenchBacklogSummary[]): string {
  if (items.length === 0) {
    return `<p class="empty-list-text">No backlog items found.</p>`;
  }
  const rows = items
    .map(
      (item) => `
    <li class="item-row">
      <span class="item-id"><code>${escapeHtml(item.id)}</code></span>
      <span class="item-title">${escapeHtml(item.title)}</span>
      <span class="badge badge-${escapeHtml(item.status)}">${escapeHtml(item.status)}</span>
      <span class="item-priority">${escapeHtml(item.priority)}</span>
    </li>
  `,
    )
    .join("\n");
  return `<ul class="items-list">${rows}</ul>`;
}

function renderPlansList(
  plans: Array<{ id: string; title: string; status: string; item_count: number }>,
): string {
  if (plans.length === 0) {
    return `<p class="empty-list-text">No plans found.</p>`;
  }
  const rows = plans
    .map(
      (p) => `
    <li class="item-row">
      <span class="item-id"><code>${escapeHtml(p.id)}</code></span>
      <span class="item-title">${escapeHtml(p.title)}</span>
      <span class="badge badge-${escapeHtml(p.status)}">${escapeHtml(p.status)}</span>
      <span class="item-count">${p.item_count} items</span>
    </li>
  `,
    )
    .join("\n");
  return `<ul class="items-list">${rows}</ul>`;
}

function renderReportsList(
  reports: Array<{ id: string; title: string; outcome: string; created_at: string }>,
): string {
  if (reports.length === 0) {
    return `<p class="empty-list-text">No delivery reports found.</p>`;
  }
  const rows = reports
    .map(
      (r) => `
    <li class="item-row">
      <span class="item-id"><code>${escapeHtml(r.id)}</code></span>
      <span class="item-title">${escapeHtml(r.title)}</span>
      <span class="badge badge-${escapeHtml(r.outcome)}">${escapeHtml(r.outcome)}</span>
      <span class="item-date">${escapeHtml(r.created_at)}</span>
    </li>
  `,
    )
    .join("\n");
  return `<ul class="items-list">${rows}</ul>`;
}

function renderRecentRetrospectivesList(
  recent: Array<{ id: string; status: string; created_at: string; path: string }>,
): string {
  if (recent.length === 0) {
    return `<p class="empty-list-text">No retrospectives recorded for this project.</p>`;
  }
  const rows = recent
    .map(
      (record) => `
    <li class="item-row">
      <span class="item-id"><code>${escapeHtml(record.id)}</code></span>
      <span class="badge badge-${escapeHtml(record.status)}">${escapeHtml(record.status)}</span>
      <span class="item-date">${escapeHtml(record.created_at)}</span>
      <span class="item-path"><code>${escapeHtml(record.path)}</code></span>
    </li>
  `,
    )
    .join("\n");
  return `<ul class="items-list">${rows}</ul>`;
}
