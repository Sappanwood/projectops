import type { WorkbenchReadPages } from "../application/workbenchReadModel.js";
import type { Report } from "../report/report.js";
import type { RetrospectiveRecord } from "../retrospective/retrospective.js";
import { documentLink } from "./docsView.js";
import { renderReadingBody } from "./markdown.js";
import { renderPlans } from "./planView.js";
import { escapeHtml as e, renderDiagnostics } from "./render.js";
import { formatRoute } from "./router.js";
import type { RouteState } from "./types.js";

export type ReadPage = "plans" | "reports" | "docs" | "retrospectives";
export type RetrospectiveFilters = { project: string; status: string; task: string };
export function isReadPage(view: string): view is ReadPage {
  return ["plans", "reports", "docs", "retrospectives"].includes(view);
}

export function renderReadPages(
  view: ReadPage,
  data: WorkbenchReadPages,
  filters: RetrospectiveFilters,
  context?: {
    projectId: string;
    planId: string | null;
    reportId?: string | null;
    route?: RouteState;
  },
): string {
  const route: RouteState = context?.route ?? {
    projectId: context?.projectId ?? filters.project,
    ...(context?.planId ? { planId: context.planId } : {}),
    ...(context?.reportId ? { reportId: context.reportId } : {}),
    view,
  };
  const diagnostics = renderDiagnostics(
    data.diagnostics.filter(
      (entry) => entry.source === view || (view === "plans" && entry.source === "reports"),
    ),
    `${view} diagnostics`,
  );
  let content: string;
  switch (view) {
    case "plans":
      content = renderPlans(data.plans, route);
      break;
    case "reports":
      content = `<h2>Delivery Reports (${data.reports.length})</h2>${context?.planId && !route.returnTo ? `<p><a class="btn btn-secondary" href="${e(formatRoute({ projectId: context.projectId, view: "plans", planId: context.planId }))}">返回原 Plan</a></p>` : ""}${context?.reportId && !data.reports.some((report) => report.id === context.reportId) ? '<p role="alert">Report 不存在或无法读取。</p>' : ""}${data.reports.map((report) => renderReport(report, route)).join("") || empty("delivery reports")}`;
      break;
    case "docs":
      content = `<h2>Project Docs</h2><p>Read-only docs check</p><ul class="items-list">${data.documents.map((document) => `<li class="item-row"><code>${e(document.path)}</code><span class="${document.issue === null ? "success-text" : "error-message"}">${e(document.issue ?? "Healthy")}</span></li>`).join("")}</ul>`;
      break;
    case "retrospectives": {
      const records = data.retrospectives.filter(
        (record) =>
          (filters.project === "" ||
            (filters.project === "null"
              ? record.project === null
              : record.project === filters.project)) &&
          (filters.task === "" ||
            (filters.task === "null" ? record.task === null : record.task === filters.task)) &&
          (filters.status === "" || record.status === filters.status),
      );
      const selected = route.retrospectiveId
        ? data.retrospectives.find((record) => record.id === route.retrospectiveId)
        : undefined;
      const notice =
        route.retrospectiveId && !selected
          ? '<p role="alert">回顾不存在或无法读取。</p>'
          : selected && !records.includes(selected)
            ? `<p class="reading-notice">当前回顾不符合筛选条件，仍显示直达记录。</p>${renderRetrospective(selected, route, filters)}`
            : "";
      content = `<h2>Workflow Retrospectives (${records.length})</h2>${renderFilters(filters)}${notice}${[
        "inbox",
        "active",
        "archive",
      ]
        .map((status) => {
          const group = records.filter((record) => record.status === status);
          return `<section aria-label="${status}"><h3>${status} (${group.length})</h3>${group.map((record) => renderRetrospective(record, route, filters)).join("") || empty(`${status} retrospectives`)}</section>`;
        })
        .join("")}`;
      break;
    }
  }
  return `<div class="domain-page">${diagnostics}${content}</div>`;
}

function field(label: string, value: string | null | undefined): string {
  return `<dt>${e(label)}</dt><dd>${e(value ?? "Not recorded")}</dd>`;
}
function empty(kind: string): string {
  return `<p class="empty-list-text">No ${kind} found.</p>`;
}
function strings(title: string, values: string[]): string {
  return `<h4>${e(title)}</h4>${values.length === 0 ? "<p>None recorded.</p>" : `<ul>${values.map((value) => `<li>${e(value)}</li>`).join("")}</ul>`}`;
}
function referenceLink(
  reference: string,
  origin: RouteState,
  targetProject = origin.projectId,
): string | null {
  const from = formatRoute({ ...origin, returnTo: undefined });
  const plan = /^project-ops:plans\/(plan-[a-z0-9-]+)\.json$/.exec(reference);
  const item = /^project-ops:backlog\/items\/([A-Z]+-\d+)\.md$/.exec(reference);
  if (plan)
    return formatRoute({
      projectId: targetProject,
      view: "plans",
      planId: plan[1]!,
      returnTo: from,
    });
  if (item)
    return formatRoute({
      projectId: targetProject,
      view: "backlog",
      itemId: item[1]!,
      returnTo: from,
    });
  return documentLink(reference, {
    projectId: targetProject,
    view: "docs",
    documentPath: "README.md",
    returnTo: from,
  });
}
function linked(
  reference: string,
  label: string,
  origin: RouteState,
  targetProject = origin.projectId,
): string {
  const href = referenceLink(reference, origin, targetProject);
  return href
    ? `<a href="${e(href)}">${e(label)}</a>`
    : `<span title="无法在工作台打开此引用">${e(label)}</span>`;
}
function renderReport(report: Report, route: RouteState): string {
  const origin = { ...route, view: "reports" as const, reportId: report.id };
  return `<details class="artifact-detail" data-report-id="${e(report.id)}" data-reading-key="${e(report.id)}"><summary><span class="artifact-title">${e(report.title)}</span> <span class="badge">${e(report.outcome)}</span><small>${e(report.created_at)} · ${e(report.id)}</small><a class="artifact-open" href="${e(formatRoute(origin))}">打开报告</a></summary>
    <p class="reading-notice">报告记录创建时的交付快照，当前任务进度以 Backlog 为准。</p>
    <p>关联计划：${linked(report.plan, report.plan.replace("project-ops:plans/", "").replace(/\.json$/, ""), origin)}</p>
    ${renderReadingBody(report.body, `report-body-${report.id}`, { resolveLink: (url) => referenceLink(url, origin) })}
    <section class="evidence-section">${strings("Verification · 验证证据", report.verification)}${strings("Deviations · 偏离", report.deviations)}${strings("Workarounds · 处理方式", report.workarounds)}</section>
    <h4>Backlog references</h4>${report.backlog.length === 0 ? empty("backlog results") : `<ul>${report.backlog.map((item) => `<li>${linked(`project-ops:backlog/items/${item.id}.md`, `${item.project ?? report.project}:${item.id}`, origin, item.project ?? report.project)} <span class="badge">${e(item.status)}</span></li>`).join("")}</ul>`}
    <h4>Repo docs</h4><ul>${report.repo_docs.map((doc) => `<li>${linked(doc, doc, origin)}</li>`).join("")}</ul>
    <details class="technical-details" data-reading-key="report-records-${e(report.id)}"><summary>报告记录与技术信息</summary>
    <dl>${field("Outcome", report.outcome)}${field("Project", report.project)}${field("Created at", report.created_at)}${field("Plan reference", report.plan)}</dl>
    ${report.backlog.map((item) => `<dl>${field(item.id, item.uri)}${field("Revision", item.revision)}</dl>`).join("")}</details>
  </details>`;
}
function renderRetrospective(
  record: RetrospectiveRecord,
  route: RouteState,
  filters: RetrospectiveFilters,
): string {
  const origin = {
    ...route,
    view: "retrospectives" as const,
    retrospectiveId: record.id,
    retrospectiveFilters: filters,
  };
  const excerpt =
    record.body
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line && !/^#/.test(line)) ?? record.id;
  return `<details class="artifact-detail" data-retrospective-id="${e(record.id)}" data-reading-key="retro-${e(record.id)}"><summary><span class="artifact-title">${e(excerpt.slice(0, 120))}</span> <span class="badge badge-${record.status}">${record.status}</span><small>${e(record.created_at)} · ${e(record.project ?? "No project")} · ${e(record.id)}</small><a class="artifact-open" href="${e(formatRoute(origin))}">打开回顾</a></summary>
    ${renderReadingBody(record.body, `retro-body-${record.id}`)}
    ${record.project && record.task ? `<p>关联任务：<a href="${e(formatRoute({ projectId: record.project, view: "backlog", itemId: record.task, returnTo: formatRoute({ ...origin, returnTo: undefined }) }))}">${e(record.task)}</a></p>` : ""}
    ${record.next_action ? `<section class="evidence-section"><h4>下一步行动</h4>${renderReadingBody(record.next_action, `retro-next-${record.id}`)}</section>` : ""}
    ${record.resolution_note ? `<section class="evidence-section"><h4>结案说明</h4>${renderReadingBody(record.resolution_note, `retro-resolution-${record.id}`)}</section>` : ""}
    <h4>Backlog links</h4><ul>${(record.backlog ?? []).map((ref) => `<li>${record.project ? linked(ref, ref, origin, record.project) : e(ref)}</li>`).join("")}</ul>
    <details class="technical-details" data-reading-key="retro-records-${e(record.id)}"><summary>回顾记录与技术信息</summary>
    <dl>${field("Status", record.status)}${field("Project", record.project)}${field("Task", record.task)}${field("Created at", record.created_at)}${field("Trigger", record.trigger)}${field("Harness", record.harness)}${field("Model", record.model)}${field("Path", record.path)}${field("Revision", record.revision)}
    ${field("Disposition", record.disposition)}${field("Owner scope", record.owner_scope)}${field("Action disposition", record.action_disposition)}${field("Actioned at", record.actioned_at)}${field("Canonical", record.canonical)}</dl>
    ${strings("Categories", record.categories ?? [])}${strings("Related info", record.related_info ?? [])}</details>
  </details>`;
}
function renderFilters(filters: RetrospectiveFilters): string {
  return `<form id="retrospective-filters" class="read-filters">
    <label for="retro-status">Status</label><select id="retro-status" name="status" class="form-select">${["", "inbox", "active", "archive"].map((status) => `<option value="${status}" ${filters.status === status ? "selected" : ""}>${status || "All statuses"}</option>`).join("")}</select>
    <label for="retro-project">Project</label><input id="retro-project" name="project" value="${e(filters.project)}" placeholder="All projects" class="form-input">
    <label for="retro-task">Task</label><input id="retro-task" name="task" value="${e(filters.task)}" placeholder="All tasks" class="form-input">
    <button type="submit" class="btn btn-secondary">Apply filters</button><p>Exact project/task match; leave blank for all, use null for unrecorded provenance.</p>
  </form>`;
}
