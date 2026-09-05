import { formatRoute } from "./router.js";
import type { PlanNextSummary } from "../application/planNext.js";
import type { WorkbenchReadPages } from "../application/workbenchReadModel.js";
import { renderReadingBody } from "./markdown.js";
import type { WorkbenchPlan, PlanExecution } from "../application/planExecution.js";
import type { Report } from "../report/report.js";
import type { RetrospectiveRecord } from "../retrospective/retrospective.js";
import { escapeHtml as e, renderDiagnostics } from "./render.js";
import { documentLink } from "./docsView.js";
import type { RouteState } from "./types.js";

export type ReadPage = "plans" | "reports" | "docs" | "retrospectives";
export type RetrospectiveFilters = { project: string; status: string; task: string };
export function isReadPage(view: string): view is ReadPage {
  return ["plans", "reports", "docs", "retrospectives"].includes(view);
}

export function renderReadPages(view: ReadPage, data: WorkbenchReadPages, filters: RetrospectiveFilters, context?: { projectId: string; planId: string | null; reportId?: string | null; route?: RouteState }): string {
  const route: RouteState = context?.route ?? {projectId:context?.projectId ?? filters.project,view};
  const diagnostics = renderDiagnostics(data.diagnostics.filter((entry) => (entry.source === view || (view === "plans" && entry.source === "reports"))), `${view} diagnostics`);
  let content: string;
  switch (view) {
    case "plans":
      content = `<h2>Plans (${data.plans.length})</h2>${context?.planId && !data.plans.some(plan => plan.id === context.planId) ? '<p role="alert">Plan 不存在或无法读取。</p>' : ""}${data.plans.map(plan => renderPlan(plan, context?.projectId ?? filters.project)).join("") || empty("plans")}`;
      break;
    case "reports":
      content = `<h2>Delivery Reports (${data.reports.length})</h2>${context?.planId ? `<p><a class="btn btn-secondary" href="${e(formatRoute({ projectId: context.projectId, view: "plans", planId: context.planId }))}">返回原 Plan</a></p>` : ""}${context?.reportId && !data.reports.some(report => report.id === context.reportId) ? '<p role="alert">Report 不存在或无法读取。</p>' : ""}${data.reports.map(report => renderReport(report, route)).join("") || empty("delivery reports")}`;
      break;
    case "docs":
      content = `<h2>Project Docs</h2><p>Read-only docs check</p><ul class="items-list">${data.documents.map((document) => `<li class="item-row"><code>${e(document.path)}</code><span class="${document.issue === null ? "success-text" : "error-message"}">${e(document.issue ?? "Healthy")}</span></li>`).join("")}</ul>`;
      break;
    case "retrospectives": {
      const records = data.retrospectives.filter((record) =>
        (filters.project === "" || (filters.project === "null" ? record.project === null : record.project === filters.project)) &&
        (filters.task === "" || (filters.task === "null" ? record.task === null : record.task === filters.task)) &&
        (filters.status === "" || record.status === filters.status));
      const selected = route.retrospectiveId ? data.retrospectives.find(record => record.id === route.retrospectiveId) : undefined;
      const notice = route.retrospectiveId && !selected ? '<p role="alert">回顾不存在或无法读取。</p>' : selected && !records.includes(selected) ? `<p class="reading-notice">当前回顾不符合筛选条件，仍显示直达记录。</p>${renderRetrospective(selected,route,filters)}` : "";
      content = `<h2>Workflow Retrospectives (${records.length})</h2>${renderFilters(filters)}${notice}${["inbox", "active", "archive"].map((status) => {
        const group = records.filter((record) => record.status === status);
        return `<section aria-label="${status}"><h3>${status} (${group.length})</h3>${group.map(record => renderRetrospective(record,route,filters)).join("") || empty(`${status} retrospectives`)}</section>`;
      }).join("")}`;
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
function renderPlan(plan: WorkbenchPlan, projectId: string): string {
  const mapping = plan.materialization;
  const taskId = (key: string) => `${plan.id}--${key}`;
  const titleFor = (key: string) => plan.items.find((item) => item.key === key)?.title ?? key;
  return `<details class="plan-card" data-plan-id="${e(plan.id)}" data-reading-key="${e(plan.id)}"><summary class="plan-summary">
    <span class="plan-title">${e(plan.title)}</span><span class="plan-summary-meta"><span class="badge badge-${e(plan.status)}">${plan.status === "draft" ? "草案" : "已批准"}</span><span>${plan.items.length} 项任务</span></span></summary>
    <div class="plan-intro"><p class="eyebrow">计划目标</p>${plan.goal.length > 220 ? `<details class="goal-toggle" data-reading-key="goal-${e(plan.id)}"><summary><span class="show-source">展开完整目标</span><span class="show-reading">收起目标</span></summary></details>` : ""}<p class="plan-goal">${e(plan.goal)}</p></div>
    ${renderExecution(plan.execution, projectId, plan.id)}
    ${renderNextTasks(plan.next_tasks, projectId, plan.id)}
    ${renderDeliveryReports(plan, projectId)}
    <div class="plan-reading-layout"><nav class="plan-toc" aria-label="任务目录"><h3>任务目录</h3><ol>${plan.items.map((item, i) => `<li><button class="plan-toc-button" data-plan-target="${e(taskId(item.key))}" aria-controls="${e(taskId(item.key))}"><span class="task-number">${i + 1}</span><span>${e(item.title)}<small>${item.depends_on.length ? `依赖：${item.depends_on.map((key) => e(titleFor(key))).join("、")}` : "无前置依赖"}</small></span></button></li>`).join("")}</ol></nav>
    <div class="plan-items">${plan.items.length === 0 ? empty("items") : plan.items.map((item, i) => `<details class="plan-task" id="${e(taskId(item.key))}" data-reading-key="${e(taskId(item.key))}" ${i === 0 ? "open" : ""}>
      <summary><span class="task-number">${i + 1}</span><span class="task-heading">${e(item.title)}</span><span class="badge badge-priority">${e(item.priority)}</span></summary>
      <div class="plan-task-content"><div class="item-meta"><span>${item.item_type === "epic" ? "Epic" : "任务"}</span><code>${e(item.key)}</code>${item.parent ? `<span>所属：${e(titleFor(item.parent))}</span>` : ""}</div>
      <p class="dependency-line" aria-label="Dependencies">${item.depends_on.length ? `依赖：${item.depends_on.map((key) => e(titleFor(key))).join("、")}` : "无前置依赖"}</p>
      ${renderReadingBody(item.body, `body-${taskId(item.key)}`)}</div></details>`).join("")}</div></div>
    <details class="technical-details plan-records" data-reading-key="records-${e(plan.id)}"><summary>计划记录与技术信息</summary>
      <dl>${field("Plan ID", plan.id)}${field("Status", plan.status)}${plan.approval ? field("Approval", plan.approval.review_note) + field("Approved at", plan.approval.approved_at) : ""}${mapping ? field("Materialized at", mapping.materialized_at) : ""}</dl>
      ${mapping ? `<h4>Materialization mapping</h4><dl>${Object.entries(mapping.mapping).map(([key, id]) => field(key, id)).join("")}</dl>` : '<p class="muted">尚未生成 Backlog 条目。</p>'}
    </details></details>`;
}
function renderExecution(execution: PlanExecution, projectId: string, planId: string): string {
  if (!execution.materialized) return '<section class="plan-execution" aria-label="执行进度"><h3>执行进度</h3><p>未开始执行 · 尚未生成 Backlog 条目。</p></section>';
  const { counts } = execution;
  const labels = { todo: "待开始", in_progress: "进行中", done: "已完成", blocked: "受阻", cancelled: "已取消", unreadable: "无法读取" };
  return `<section class="plan-execution" aria-label="执行进度"><h3>执行进度</h3>
    ${counts.total === 0 ? '<p>无可执行任务</p>' : `<div class="execution-heading"><strong>${counts.done}/${counts.total} 已完成</strong><span>${execution.completion_percent}%</span></div>
    <progress aria-label="任务完成进度" value="${counts.done}" max="${counts.total}"></progress>
    <p class="execution-counts">待开始 ${counts.todo} · 进行中 ${counts.in_progress} · 已完成 ${counts.done} · 无法读取 ${counts.unreadable}${counts.blocked ? ` · 受阻 ${counts.blocked}` : ""}${counts.cancelled ? ` · 已取消 ${counts.cancelled}` : ""}</p>`}
    <ul class="execution-items">${execution.items.map((item) => `<li><span>${taskLink(projectId, planId, item.id, item.title)}${item.item_type === "epic" ? '<small> Epic · 不计入完成率</small>' : ""}</span><span class="badge badge-${e(item.status)}">${labels[item.status]}</span>${item.diagnostic ? `<p class="error-message">${e(item.diagnostic.message)}</p>` : ""}</li>`).join("")}</ul>
    </section>`;
}
function taskLink(projectId: string, planId: string, id: string, title: string): string {
  return `<a href="${e(formatRoute({ projectId, view: "backlog", itemId: id, planId }))}">${e(id)} — ${e(title)}</a>`;
}
function renderNextTasks(next: PlanNextSummary, projectId: string, planId: string): string {
  const groups = [["进行中任务", next.in_progress], ["可开始任务", next.ready], ["受阻任务", next.blocked]] as const;
  return `<section class="plan-next"><h3>下一步任务</h3><div class="plan-next-groups">${groups.map(([label, items]) => `<section aria-label="${label}"><h4>${label} (${items.length})</h4>${items.length === 0 ? '<p class="muted">暂无任务</p>' : `<ul>${items.map(item => `<li>${taskLink(projectId, planId, item.id, item.title)} <span class="badge badge-priority">${e(item.priority)}</span>${"reasons" in item ? `<ul class="dependency-reasons">${item.reasons.map(reason => `<li>依赖 ${e(reason.id)}：${e(reason.message)}</li>`).join("")}</ul>` : ""}</li>`).join("")}</ul>`}</section>`).join("")}</div>${next.diagnostics.map(d => `<p class="reading-notice">${e(d.id)}：${e(d.message)}</p>`).join("")}</section>`;
}
function renderDeliveryReports(plan: WorkbenchPlan, projectId: string): string {
  const reports = plan.delivery_reports;
  const completed = plan.execution.materialized && plan.execution.counts.total > 0 && plan.execution.counts.done === plan.execution.counts.total;
  return `<section class="plan-delivery" aria-label="交付报告"><h3>交付报告</h3>${reports.length === 0
    ? `<p>${completed ? "任务已完成，尚无交付报告。" : "尚无交付报告。"}</p>`
    : `<p class="muted">报告记录创建时的交付快照，当前任务进度以执行进度为准。</p><ul>${reports.map(report => `<li><a href="${e(formatRoute({ projectId, view: "reports", reportId: report.id, planId: plan.id }))}">${e(report.id)} — ${e(report.title)}</a><span class="badge">${e(report.outcome)}</span><time datetime="${e(report.created_at)}">${e(report.created_at)}</time></li>`).join("")}</ul>`}</section>`;
}
function referenceLink(reference: string, origin: RouteState, targetProject = origin.projectId): string | null {
  const from = formatRoute({...origin, returnTo:undefined});
  const plan = /^project-ops:plans\/(plan-[a-z0-9-]+)\.json$/.exec(reference);
  const item = /^project-ops:backlog\/items\/([A-Z]+-\d+)\.md$/.exec(reference);
  if (plan) return formatRoute({projectId:targetProject,view:"plans",planId:plan[1]!,returnTo:from});
  if (item) return formatRoute({projectId:targetProject,view:"backlog",itemId:item[1]!,returnTo:from});
  return documentLink(reference,{projectId:targetProject,view:"docs",documentPath:"README.md",returnTo:from});
}
function linked(reference: string, label: string, origin: RouteState, targetProject = origin.projectId): string {
  const href = referenceLink(reference,origin,targetProject);
  return href ? `<a href="${e(href)}">${e(label)}</a>` : `<span title="无法在工作台打开此引用">${e(label)}</span>`;
}
function renderReport(report: Report, route: RouteState): string {
  const origin = {...route,view:"reports" as const,reportId:report.id};
  return `<details class="artifact-detail" data-report-id="${e(report.id)}" data-reading-key="${e(report.id)}"><summary><span class="artifact-title">${e(report.title)}</span> <span class="badge">${e(report.outcome)}</span><small>${e(report.created_at)} · ${e(report.id)}</small><a class="artifact-open" href="${e(formatRoute(origin))}">打开报告</a></summary>
    <p class="reading-notice">报告记录创建时的交付快照，当前任务进度以 Backlog 为准。</p>
    <p>关联计划：${linked(report.plan, report.plan.replace("project-ops:plans/", "").replace(/\.json$/, ""), origin)}</p>
    ${renderReadingBody(report.body, `report-body-${report.id}`, {resolveLink:url => referenceLink(url,origin)})}
    <section class="evidence-section">${strings("Verification · 验证证据", report.verification)}${strings("Deviations · 偏离", report.deviations)}${strings("Workarounds · 处理方式", report.workarounds)}</section>
    <h4>Backlog references</h4>${report.backlog.length === 0 ? empty("backlog results") : `<ul>${report.backlog.map((item) => `<li>${linked(`project-ops:backlog/items/${item.id}.md`,item.id,origin)} <span class="badge">${e(item.status)}</span></li>`).join("")}</ul>`}
    <h4>Repo docs</h4><ul>${report.repo_docs.map(doc => `<li>${linked(doc,doc,origin)}</li>`).join("")}</ul>
    <details class="technical-details" data-reading-key="report-records-${e(report.id)}"><summary>报告记录与技术信息</summary>
    <dl>${field("Outcome", report.outcome)}${field("Project", report.project)}${field("Created at", report.created_at)}${field("Plan reference", report.plan)}</dl>
    ${report.backlog.map(item => `<dl>${field(item.id, item.uri)}${field("Revision", item.revision)}</dl>`).join("")}</details>
  </details>`;
}
function renderRetrospective(record: RetrospectiveRecord, route: RouteState, filters: RetrospectiveFilters): string {
  const origin = {...route,view:"retrospectives" as const,retrospectiveId:record.id,retrospectiveFilters:filters};
  const excerpt = record.body.split("\n").map(line => line.trim()).find(line => line && !/^#/.test(line)) ?? record.id;
  return `<details class="artifact-detail" data-retrospective-id="${e(record.id)}" data-reading-key="retro-${e(record.id)}"><summary><span class="artifact-title">${e(excerpt.slice(0, 120))}</span> <span class="badge badge-${record.status}">${record.status}</span><small>${e(record.created_at)} · ${e(record.project ?? "No project")} · ${e(record.id)}</small><a class="artifact-open" href="${e(formatRoute(origin))}">打开回顾</a></summary>
    ${renderReadingBody(record.body, `retro-body-${record.id}`)}
    ${record.project && record.task ? `<p>关联任务：<a href="${e(formatRoute({projectId:record.project,view:"backlog",itemId:record.task,returnTo:formatRoute({...origin,returnTo:undefined})}))}">${e(record.task)}</a></p>` : ""}
    ${record.next_action ? `<section class="evidence-section"><h4>下一步行动</h4>${renderReadingBody(record.next_action, `retro-next-${record.id}`)}</section>` : ""}
    ${record.resolution_note ? `<section class="evidence-section"><h4>结案说明</h4>${renderReadingBody(record.resolution_note, `retro-resolution-${record.id}`)}</section>` : ""}
    <h4>Backlog links</h4><ul>${(record.backlog ?? []).map(ref => `<li>${record.project ? linked(ref,ref,origin,record.project) : e(ref)}</li>`).join("")}</ul>
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
