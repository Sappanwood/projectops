import { renderModelSelector } from './modelSelector.js';
import { formatRoute } from "./router.js";
import { isReadPage, renderReadPages } from "./readPagesView.js";
import { renderDocs } from "./docsView.js";
import type {
  AppState,
  ViewType,
  RouteState,
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
        ${state.route.returnTo ? `<p><a class="btn btn-secondary" href="${escapeHtml(state.route.returnTo)}">${state.route.returnTo === formatRoute({projectId: state.selectedProjectId, view:"overview"}) || state.route.returnTo.endsWith("/overview") ? "返回 Overview" : "返回来源页面"}</a></p>` : ""}
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
        ${renderModelSelector(state.modelSelection)}
        <div class="header-status" aria-live="polite">${statusBadge}</div>
        <button
          id="btn-refresh"
          class="btn btn-secondary btn-refresh"
          type="button"
          aria-label="Refresh workspace and project data"
          ${state.refreshing || state.status === "loading" ? "disabled" : ""}
        >
          刷新
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
    if (state.currentView === "docs") return `<div id="panel-docs" role="tabpanel" aria-labelledby="tab-docs">${renderDocs(state.docs, state.route)}</div>`;
    let content = '<p role="status">Loading read-only view…</p>';
    if (state.readPagesError !== null) content = `<p role="alert">${escapeHtml(state.readPagesError.message)}</p><button id="read-pages-retry" class="btn btn-secondary">Retry</button>`;
    else if (state.readPages !== null) content = renderReadPages(state.currentView, state.readPages, state.retrospectiveFilters, { projectId: state.selectedProjectId, planId: state.selectedPlanId, reportId: state.selectedReportId, route:state.route });
    return `<div id="panel-${state.currentView}" role="tabpanel" aria-labelledby="tab-${state.currentView}">${content}</div>`;
  }
  if (state.projectOverview !== null) {
    return renderProjectView(state.currentView, state.projectOverview, state.backlog, state.selectedPlanId);
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
  planId: string | null = null,
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
      viewContent = `${planId ? `<p><a class="btn btn-secondary" href="${escapeHtml(formatRoute({ projectId: overview.project.id, view: "plans", planId }))}">返回原 Plan</a></p>` : ""}${renderBacklogPanel(backlog)}`;
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
  const rCounts = overview.retrospectives.counts;
  const projectId = overview.project.id;
  const backlogTotal = overview.backlog.mode === "active" ? bCounts.todo + bCounts.in_progress : Object.values(bCounts).reduce((sum, count) => sum + count, 0);
  return `<div class="overview-grid">
    <section class="overview-card" aria-labelledby="card-plans-title">
      <div class="card-header"><h3 id="card-plans-title">Plans (${overview.plans.length})</h3></div>
      ${overviewPreview(overview, "plans", Math.min(5, overview.plans.length), overview.plans.length)}
      <div class="card-body">${overview.plans.length === 0 && overview.diagnostics.some(d => d.source === "plans") ? "" : renderPlansList(overview.plans.slice(0, 5), projectId)}</div>
      <a href="${escapeHtml(overviewLink(projectId, "plans"))}" class="card-link">查看全部 Plans →</a>
    </section>
    <section class="overview-card" aria-labelledby="card-backlog-title">
      <div class="card-header"><h3 id="card-backlog-title">Backlog</h3></div>
      <div class="counts-row">
        <span class="badge badge-todo">${bCounts.todo} todo</span>
        <span class="badge badge-inprogress">${bCounts.in_progress} in progress</span>
        <span class="badge badge-blocked">${bCounts.blocked} blocked</span>
        <span class="badge badge-done">${bCounts.done} done</span>
      </div>
      ${overviewPreview(overview, "backlog", overview.backlog.recent.length, backlogTotal)}
      <div class="card-body"><h4>${overview.backlog.mode === "active" ? "进行中与待办" : "最近更新"}</h4>
        ${overview.backlog.mode === "recent" && !overview.diagnostics.some(d => d.source === "backlog") ? '<p class="muted">当前没有进行中或待办任务。</p>' : ""}
        ${overview.backlog.recent.length === 0 && overview.diagnostics.some(d => d.source === "backlog") ? "" : renderRecentBacklogList(overview.backlog.recent, projectId)}</div>
      <a href="${escapeHtml(overviewLink(projectId, "backlog"))}" class="card-link">查看全部 Backlog →</a>
    </section>
    <section class="overview-card" aria-labelledby="card-reports-title">
      <div class="card-header"><h3 id="card-reports-title">Reports (${overview.reports.length})</h3></div>
      ${overviewPreview(overview, "reports", Math.min(5, overview.reports.length), overview.reports.length)}
      <div class="card-body">${overview.reports.length === 0 && overview.diagnostics.some(d => d.source === "reports") ? "" : renderReportsList(overview.reports.slice(0, 5), projectId)}</div>
      <a href="${escapeHtml(overviewLink(projectId, "reports"))}" class="card-link">查看全部 Reports →</a>
    </section>
    <section class="overview-card" aria-labelledby="card-retro-title">
      <div class="card-header"><h3 id="card-retro-title">Retrospectives</h3></div>
      <div class="counts-row">
        <span class="badge badge-inbox">${rCounts.inbox} inbox</span>
        <span class="badge badge-active">${rCounts.active} active</span>
        <span class="badge badge-archive">${rCounts.archive} archive</span>
      </div>
      ${overviewPreview(overview, "retrospectives", overview.retrospectives.recent.length, Object.values(rCounts).reduce((sum, count) => sum + count, 0))}
      <div class="card-body">${overview.retrospectives.recent.length === 0 && overview.diagnostics.some(d => d.source === "retrospectives") ? "" : renderRecentRetrospectivesList(overview.retrospectives.recent, projectId)}</div>
      <a href="${escapeHtml(overviewLink(projectId, "retrospectives"))}" class="card-link">查看全部 Retrospectives →</a>
    </section>
    <section class="overview-card overview-docs" aria-labelledby="card-docs-title">
      <div class="card-header"><h3 id="card-docs-title">Project Docs</h3></div>
      <div class="card-body"><span class="badge ${overview.docs.healthy ? "badge-healthy" : "badge-problem"}">
        ${overview.docs.healthy ? "✓ 标准文档检查通过" : overview.docs.problems.length > 0 ? `⚠ ${overview.docs.problems.length} 个检查问题` : "⚠ 检查不可用"}
      </span></div>
      <p class="muted">检查范围：四份标准文档的文件类型与一级标题，不代表内容新鲜度或语义正确性。</p>
      <ul class="overview-document-list">${overview.docs.documents.map(document => `<li>
        ${document.readable ? `<a href="${escapeHtml(formatRoute({projectId, view:"docs", documentPath:document.path, returnTo:formatRoute({projectId,view:"overview"})}))}">${escapeHtml(document.path)}</a>` : `<span>${escapeHtml(document.path)}</span>`}
        <small class="${document.issue ? "document-issue" : "muted"}">${document.issue ? escapeHtml(document.issue) : "可阅读"}</small>
      </li>`).join("")}</ul>
      <a href="${escapeHtml(overviewLink(projectId, "docs"))}" class="card-link">查看全部 Docs →</a>
    </section>
  </div>`;
}

function overviewPreview(overview: WorkbenchProjectOverview, source: WorkbenchDiagnostic["source"], shown: number, total: number): string {
  const problems = overview.diagnostics.filter(d => d.source === source);
  return `<p class="overview-preview muted">展示 ${shown} / ${problems.length ? "已读取" : "共"} ${total} 条</p>${problems.length
    ? `<p class="reading-notice" role="status">部分数据无法读取，数量仅代表已读取记录。${problems.map(d => escapeHtml(d.message)).join(" ")}</p>` : ""}`;
}

function overviewLink(projectId: string, view: ViewType, id?: string): string {
  const route: RouteState = { projectId, view, returnTo: formatRoute({projectId, view:"overview"}) };
  if (view === "plans" && id) route.planId = id;
  if (view === "backlog" && id) route.itemId = id;
  if (view === "reports" && id) route.reportId = id;
  if (view === "retrospectives") {
    if (id) route.retrospectiveId = id;
    route.retrospectiveFilters = {project:projectId, status:"", task:""};
  }
  return formatRoute(route);
}

function overviewRow(title: string, id: string, metadata: string, href: string): string {
  return `<li class="item-row"><a class="item-title" href="${escapeHtml(href)}">${escapeHtml(title)}</a>
    <div class="overview-item-meta">${metadata}</div><span class="item-id"><code>${escapeHtml(id)}</code></span></li>`;
}

function overviewDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? escapeHtml(value)
    : `<time datetime="${escapeHtml(value)}" title="${escapeHtml(value)}">${escapeHtml(date.toLocaleString("zh-CN", {year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit"}))}</time>`;
}

function renderRecentBacklogList(items: WorkbenchBacklogSummary[], projectId: string): string {
  if (items.length === 0) return `<p class="empty-list-text">暂无任务。</p>`;
  return `<ul class="items-list">${items.map(item => overviewRow(item.title, item.id,
    `<span class="badge badge-${escapeHtml(item.status)}">${escapeHtml(item.status)}</span><span>${escapeHtml(item.priority)}</span>`, overviewLink(projectId, "backlog", item.id))).join("")}</ul>`;
}

function renderPlansList(plans: WorkbenchProjectOverview["plans"], projectId: string): string {
  if (plans.length === 0) return `<p class="empty-list-text">暂无计划。</p>`;
  return `<ul class="items-list">${plans.map(plan => overviewRow(plan.title, plan.id,
    `<span class="badge badge-${escapeHtml(plan.status)}">${escapeHtml(plan.status)}</span><span>${plan.item_count} 个计划条目</span>${overviewPlanProgress(plan.execution)}`, overviewLink(projectId, "plans", plan.id))).join("")}</ul>`;
}

function overviewPlanProgress(execution: WorkbenchProjectOverview["plans"][number]["execution"]): string {
  const progress = !execution.materialized ? "未开始执行" : execution.counts.total === 0 ? "无可执行任务"
    : `任务完成 ${execution.counts.done} / ${execution.counts.total} · ${execution.completion_percent}%`;
  return `<span class="overview-progress">${progress}</span>${execution.diagnostics.map(d => `<span class="reading-notice">${escapeHtml(d.message)}</span>`).join("")}`;
}

function renderReportsList(reports: WorkbenchProjectOverview["reports"], projectId: string): string {
  if (reports.length === 0) return `<p class="empty-list-text">暂无交付报告。</p>`;
  return `<ul class="items-list">${reports.map(report => overviewRow(report.title, report.id,
    `<span class="badge badge-${escapeHtml(report.outcome)}">${escapeHtml(report.outcome)}</span>${overviewDate(report.created_at)}`, overviewLink(projectId, "reports", report.id))).join("")}</ul>`;
}

function renderRecentRetrospectivesList(recent: WorkbenchProjectOverview["retrospectives"]["recent"], projectId: string): string {
  if (recent.length === 0) return `<p class="empty-list-text">当前项目暂无回顾。</p>`;
  return `<ul class="items-list">${recent.map(record => overviewRow(record.summary, record.id,
    `<span class="badge badge-${escapeHtml(record.status)}">${escapeHtml(record.status)}</span>${overviewDate(record.created_at)}`, overviewLink(projectId, "retrospectives", record.id))).join("")}</ul>`;
}
