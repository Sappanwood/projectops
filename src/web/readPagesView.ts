import type { WorkbenchReadPages } from "../application/workbenchReadModel.js";
import type { Plan } from "../plan/plan.js";
import type { Report } from "../report/report.js";
import type { RetrospectiveRecord } from "../retrospective/retrospective.js";
import { escapeHtml as e, renderDiagnostics } from "./render.js";

export type ReadPage = "plans" | "reports" | "docs" | "retrospectives";
export type RetrospectiveFilters = { project: string; status: string; task: string };
export function isReadPage(view: string): view is ReadPage {
  return ["plans", "reports", "docs", "retrospectives"].includes(view);
}

export function renderReadPages(view: ReadPage, data: WorkbenchReadPages, filters: RetrospectiveFilters): string {
  const diagnostics = renderDiagnostics(data.diagnostics.filter((entry) => entry.source === view), `${view} diagnostics`);
  let content: string;
  switch (view) {
    case "plans":
      content = `<h2>Plans (${data.plans.length})</h2>${data.plans.map(renderPlan).join("") || empty("plans")}`;
      break;
    case "reports":
      content = `<h2>Delivery Reports (${data.reports.length})</h2>${data.reports.map(renderReport).join("") || empty("delivery reports")}`;
      break;
    case "docs":
      content = `<h2>Project Docs</h2><p>Read-only docs check</p><ul class="items-list">${data.documents.map((document) => `<li class="item-row"><code>${e(document.path)}</code><span class="${document.issue === null ? "success-text" : "error-message"}">${e(document.issue ?? "Healthy")}</span></li>`).join("")}</ul>`;
      break;
    case "retrospectives": {
      const records = data.retrospectives.filter((record) =>
        (filters.project === "" || (filters.project === "null" ? record.project === null : record.project === filters.project)) &&
        (filters.task === "" || (filters.task === "null" ? record.task === null : record.task === filters.task)) &&
        (filters.status === "" || record.status === filters.status));
      content = `<h2>Workflow Retrospectives (${records.length})</h2>${renderFilters(filters)}${["inbox", "active", "archive"].map((status) => {
        const group = records.filter((record) => record.status === status);
        return `<section aria-label="${status}"><h3>${status} (${group.length})</h3>${group.map(renderRetrospective).join("") || empty(`${status} retrospectives`)}</section>`;
      }).join("")}`;
      break;
    }
  }
  return `<div class="domain-page">${diagnostics}${content}</div>`;
}

function field(label: string, value: string | null | undefined): string {
  return `<dt>${e(label)}</dt><dd>${e(value ?? "Not recorded")}</dd>`;
}
function source(body: string): string {
  return `<pre class="artifact-body"><code>${e(body)}</code></pre>`;
}
function empty(kind: string): string {
  return `<p class="empty-list-text">No ${kind} found.</p>`;
}
function strings(title: string, values: string[]): string {
  return `<h4>${e(title)}</h4>${values.length === 0 ? "<p>None recorded.</p>" : `<ul>${values.map((value) => `<li>${e(value)}</li>`).join("")}</ul>`}`;
}
function renderPlan(plan: Plan): string {
  const mapping = plan.materialization;
  return `<details class="artifact-detail"><summary><code>${e(plan.id)}</code> ${e(plan.title)} <span class="badge">${e(plan.status)}</span></summary>
    <dl>${field("Goal", plan.goal)}${field("Status", plan.status)}${field("Approval", plan.approval?.review_note)}${field("Approved at", plan.approval?.approved_at)}${field("Materialized at", mapping?.materialized_at)}</dl>
    <h4>Materialization mapping</h4>${mapping ? `<dl>${Object.entries(mapping.mapping).map(([key, id]) => field(key, id)).join("")}</dl>` : "<p>Not materialized.</p>"}
    <h4>Items and dependencies</h4>${plan.items.length === 0 ? empty("items") : plan.items.map((item) => `<section><h5>${e(item.key)} — ${e(item.title)}</h5><dl>${field("Type", item.item_type)}${field("Priority", item.priority)}${field("Parent", item.parent)}${field("Dependencies", item.depends_on.join(", ") || "None")}</dl>${source(item.body)}</section>`).join("")}
  </details>`;
}
function renderReport(report: Report): string {
  return `<details class="artifact-detail"><summary><code>${e(report.id)}</code> ${e(report.title)} <span class="badge">${e(report.outcome)}</span></summary>
    <dl>${field("Outcome", report.outcome)}${field("Project", report.project)}${field("Created at", report.created_at)}${field("Plan reference", report.plan)}</dl>
    <h4>Backlog references</h4>${report.backlog.length === 0 ? empty("backlog results") : `<ul>${report.backlog.map((item) => `<li><code>${e(item.id)}</code> ${e(item.status)} ${e(item.uri ?? "")} ${e(item.revision ?? "")}</li>`).join("")}</ul>`}
    ${strings("Verification", report.verification)}${strings("Deviations", report.deviations)}${strings("Workarounds", report.workarounds)}${strings("Repo docs", report.repo_docs)}
    <h4>Body</h4>${source(report.body)}
  </details>`;
}
function renderRetrospective(record: RetrospectiveRecord): string {
  return `<details class="artifact-detail"><summary><code>${e(record.id)}</code> <span class="badge badge-${record.status}">${record.status}</span> ${e(record.project ?? "No project")} ${e(record.task ?? "No task")}</summary>
    <dl>${field("Status", record.status)}${field("Project", record.project)}${field("Task", record.task)}${field("Created at", record.created_at)}${field("Trigger", record.trigger)}${field("Harness", record.harness)}${field("Model", record.model)}${field("Path", record.path)}${field("Revision", record.revision)}
    ${field("Disposition", record.disposition)}${field("Owner scope", record.owner_scope)}${field("Next action", record.next_action)}${field("Action disposition", record.action_disposition)}${field("Actioned at", record.actioned_at)}${field("Resolution", record.resolution_note)}${field("Canonical", record.canonical)}</dl>
    ${strings("Categories", record.categories ?? [])}${strings("Related info", record.related_info ?? [])}${strings("Backlog links", record.backlog ?? [])}<h4>Body</h4>${source(record.body)}
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
