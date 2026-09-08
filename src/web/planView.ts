import type { PlanExecution, WorkbenchPlan } from "../application/planExecution.js";
import type { PlanNextSummary } from "../application/planNext.js";
import { renderReadingBody } from "./markdown.js";
import { mappingTarget } from "./planIdentityView.js";
import { escapeHtml as e } from "./render.js";
import { formatRoute } from "./router.js";
import type { RouteState } from "./types.js";

function field(label: string, value: string | null | undefined): string {
  return `<dt>${e(label)}</dt><dd>${e(value ?? "Not recorded")}</dd>`;
}
function empty(kind: string): string {
  return `<p class="empty-list-text">No ${kind} found.</p>`;
}
export function renderPlans(plans: WorkbenchPlan[], route: RouteState): string {
  const projectId = route.projectId!;
  if (route.planId) {
    const plan = plans.find((entry) => entry.id === route.planId);
    return `<a class="btn btn-secondary plan-back" href="${e(formatRoute({ projectId, view: "plans" }))}">返回 Plans</a>${plan ? renderPlan(plan, projectId, route) : `<p role="alert">Plan 不存在或无法读取。</p><section data-plan-id="${e(route.planId)}"><div data-foundation-plan="${e(route.planId)}"></div></section>`}`;
  }
  return `<h2>Plans (${plans.length})</h2>${["draft", "approved", "done"]
    .map((status) => {
      const group = plans
        .filter((plan) => plan.status === status)
        .toSorted((a, b) => a.id.localeCompare(b.id));
      return `<section class="plan-list-group"><h3>${status === "draft" ? "待审阅" : status === "approved" ? "已批准" : "已完成"} (${group.length})</h3>${group.map((plan) => `<a class="plan-list-row" href="${e(formatRoute({ projectId, view: "plans", planId: plan.id }))}"><strong>${e(plan.title)}</strong><span>${plan.items.filter((item) => item.item_type === "task").length} 项任务</span></a>`).join("") || '<p class="muted">暂无计划</p>'}</section>`;
    })
    .join("")}`;
}
function renderPlan(plan: WorkbenchPlan, projectId: string, route: RouteState): string {
  const executionTab = route.planTab === "execution";
  const mapping = plan.materialization;
  const externalRefs = [
    ...new Set(plan.items.flatMap((item) => item.depends_on.filter((ref) => ref.includes(":")))),
  ];
  const dependency = (ref: string) => {
    if (!ref.includes(":")) return `Plan 内任务：${e(titleFor(ref))} (${e(ref)})`;
    const [target, id] = ref.split(":");
    return `既有任务：<a href="${e(formatRoute({ projectId: target!, view: "backlog", itemId: id!, returnTo: formatRoute({ projectId, view: "plans", planId: plan.id }) }))}">${e(ref)}</a>`;
  };
  const taskId = (key: string) => `${plan.id}--${key}`;
  const titleFor = (key: string) => plan.items.find((item) => item.key === key)?.title ?? key;
  return `<article class="plan-card" data-plan-id="${e(plan.id)}">
    <header class="plan-summary"><h2 class="plan-title" tabindex="-1">${e(plan.title)}</h2><span class="plan-summary-meta"><span class="badge badge-${e(plan.status)}">${plan.status === "draft" ? "草案" : plan.status === "done" ? "已完成" : "已批准"}</span><span>${plan.items.filter((item) => item.item_type === "task").length} 项任务 · ${new Set(plan.items.map((item) => item.project ?? projectId)).size} 个项目</span></span></header>
    <nav class="plan-section-nav" role="tablist" aria-label="计划视图">${[
      ["review", "审阅计划"],
      ["execution", "执行与结果"],
    ]
      .map(
        ([tab, label]) =>
          `<a class="btn btn-secondary" role="tab" id="${e(plan.id)}--tab-${tab}" aria-controls="${e(plan.id)}--panel-${tab}" aria-selected="${executionTab === (tab === "execution")}" tabindex="${executionTab === (tab === "execution") ? 0 : -1}" href="${e(formatRoute({ ...route, planTab: tab === "execution" ? "execution" : undefined }))}">${label}</a>`,
      )
      .join("")}</nav>
    <div class="plan-run-notices" aria-live="polite"><div data-plan-run-notice></div><div data-parallel-notice></div></div>
    ${mapping?.state === "partial" ? `<p class="reading-notice" role="status">部分物化：已创建 ${Object.keys(mapping.mapping).length}/${plan.items.length} 项。核对已创建任务后，通过 CLI <code>pops plan materialize ${e(projectId)} ${e(plan.id)}</code> 补齐；恢复前不可修订、完成或自动运行。</p>` : ""}
    <section role="tabpanel" id="${e(plan.id)}--panel-review" aria-labelledby="${e(plan.id)}--tab-review" ${executionTab ? "hidden" : ""}>
    <div class="plan-review-tools"><button class="btn btn-secondary" data-plan-copy="">复制计划引用</button><div data-foundation-plan="${e(plan.id)}"></div></div><div data-plan-copy-result></div><p data-plan-reading-notice role="status"></p>
    <div class="plan-intro" id="${e(plan.id)}--section-goal"><h3>计划目标</h3><p class="plan-goal">${e(plan.goal)}</p></div>
    ${externalRefs.length ? `<section aria-label="既有任务依赖"><h3>既有任务依赖 (${externalRefs.length})</h3><p class="form-help">仅 Plan 内任务计入完成率，既有依赖不生成或复制任务。</p>${externalRefs.length ? `<ul>${externalRefs.map((ref) => `<li>${dependency(ref)}</li>`).join("")}</ul>` : "<p>无既有任务依赖</p>"}</section>` : ""}
    <div class="plan-reading-actions"><button class="btn btn-secondary" data-plan-expand="true">全部展开</button><button class="btn btn-secondary" data-plan-expand="false">全部折叠</button></div>
    <div class="plan-reading-layout" id="${e(plan.id)}--section-tasks"><nav class="plan-toc" aria-label="任务目录"><button class="btn btn-secondary plan-toc-toggle" aria-expanded="false">任务目录</button><h3>任务目录</h3><ol>${plan.items.map((item, i) => `<li><button class="plan-toc-button" data-plan-target="${e(taskId(item.key))}" aria-controls="${e(taskId(item.key))}"><span class="task-number">${i + 1}</span><span>${e(item.title)}<small>${item.depends_on.length ? `依赖：${item.depends_on.map((key) => e(titleFor(key))).join("、")}` : "无前置依赖"}</small></span></button></li>`).join("")}</ol></nav>
    <div class="plan-items">${
      plan.items.length === 0
        ? empty("items")
        : plan.items
            .map(
              (
                item,
                i,
              ) => `<details class="plan-task" id="${e(taskId(item.key))}" data-reading-key="${e(taskId(item.key))}" open>
      <summary><span class="task-number">${i + 1}</span><span class="task-heading">${e(item.title)}</span><span class="badge badge-priority">${e(item.priority)}</span></summary>
      <div class="plan-task-content"><button class="btn btn-secondary" data-plan-copy="${e(item.key)}">复制任务上下文</button><div class="item-meta"><span>${item.item_type === "epic" ? "Epic" : "任务"}</span><code>${e(item.key)}</code><span>目标项目：${e(item.project ?? projectId)}${item.project ? "" : "（默认 Plan 所属项目）"}</span>${item.parent ? `<span>所属：${e(titleFor(item.parent))}</span>` : ""}</div>
      <p class="dependency-line" aria-label="Dependencies">${item.depends_on.length ? item.depends_on.map(dependency).join("、") : "无前置依赖"}</p><p>Plan 内下游：${
        plan.items
          .filter((entry) => entry.depends_on.includes(item.key))
          .map((entry) => e(entry.title))
          .join("、") || "无"
      }</p>${mapping?.mapping[item.key] ? `<section data-plan-relations="${e(item.key)}" aria-label="${e(item.title)}的依赖关系"></section>` : ""}
      ${renderReadingBody(item.body, `body-${taskId(item.key)}`)}</div></details>`,
            )
            .join("")
    }</div></div>
    <details class="technical-details plan-records" data-reading-key="records-${e(plan.id)}"><summary>审批记录</summary><dl>${field("Plan ID", plan.id)}${plan.approval ? field("Approval", plan.approval.review_note) + field("Approved at", plan.approval.approved_at) : "<dd>尚未批准</dd>"}</dl></details>
    </section>
    <section role="tabpanel" id="${e(plan.id)}--panel-execution" aria-labelledby="${e(plan.id)}--tab-execution" ${executionTab ? "" : "hidden"}>
    ${renderExecution(plan.execution, projectId, plan.id, mapping?.mapping)}
    <section class="plan-workspace" id="${e(plan.id)}--section-work" aria-label="执行工作区"><header><h3>执行工作区</h3><p class="form-help">选择运行方式，查看当前执行与需要处理的任务。串行与并行记录分别保留。</p></header><div data-plan-run-host></div></section>
    ${renderNextTasks(plan.next_tasks, projectId, plan.id)}
    ${renderDeliveryReports(plan, projectId)}
    <div data-plan-completion="${e(plan.id)}"></div>
    <details class="technical-details plan-records" data-reading-key="mapping-${e(plan.id)}"><summary>计划记录与技术信息</summary><dl>${field("Plan ID", plan.id)}${field("Status", plan.status)}${mapping ? field("Materialized at", mapping.materialized_at) : ""}</dl>${
      mapping
        ? `<h4>Materialization mapping</h4><dl>${Object.entries(mapping.mapping)
            .map(([key, value]) => {
              const target = mappingTarget(projectId, value);
              return `<dt>${e(key)}</dt><dd>${taskLink(projectId, plan.id, target.id, titleFor(key), target.project)}</dd>`;
            })
            .join("")}</dl>`
        : '<p class="muted">尚未生成 Backlog 条目。</p>'
    }</details>
    </section></article>`;
}
function renderExecution(
  execution: PlanExecution,
  projectId: string,
  planId: string,
  mapping?: Record<string, string>,
): string {
  if (!execution.materialized && !mapping)
    return `<section class="plan-execution" id="${e(planId)}--section-progress" aria-label="执行进度"><h3>执行进度</h3><p>未开始执行 · 尚未生成 Backlog 条目。</p></section>`;
  const { counts } = execution;
  const labels = {
    todo: "待开始",
    in_progress: "进行中",
    done: "已完成",
    blocked: "受阻",
    cancelled: "已取消",
    unreadable: "无法读取",
  };
  return `<section class="plan-execution" id="${e(planId)}--section-progress" aria-label="执行进度"><h3>执行进度</h3>
    ${
      counts.total === 0
        ? "<p>无可执行任务</p>"
        : `<div class="execution-heading"><strong>${counts.done}/${counts.total} 已完成</strong><span>${execution.completion_percent === null ? "物化未完成" : `${execution.completion_percent}%`}</span></div>
    <progress aria-label="任务完成进度" value="${counts.done}" max="${counts.total}"></progress>
    <p class="execution-counts">待开始 ${counts.todo} · 进行中 ${counts.in_progress} · 已完成 ${counts.done} · 无法读取 ${counts.unreadable}${counts.blocked ? ` · 受阻 ${counts.blocked}` : ""}${counts.cancelled ? ` · 已取消 ${counts.cancelled}` : ""}</p>`
    }
    <ul class="execution-items">${execution.items.map((item) => `<li><span>${mapping && !mapping[item.key] ? `${e(item.project ?? projectId)} · ${e(item.title)}（尚未创建）` : taskLink(projectId, planId, item.id, item.title, item.project)}${item.item_type === "epic" ? "<small> Epic · 不计入完成率</small>" : ""}</span><span class="badge badge-${e(item.status)}">${labels[item.status]}</span>${item.diagnostic ? `<p class="error-message">${e(item.diagnostic.message)}</p>` : ""}</li>`).join("")}</ul>
    </section>`;
}
function taskLink(
  owner: string,
  planId: string,
  id: string,
  title: string,
  projectId = owner,
): string {
  return `<a href="${e(formatRoute({ projectId, view: "backlog", itemId: id, ...(projectId === owner ? { planId } : {}), returnTo: formatRoute({ projectId: owner, view: "plans", planId, planTab: "execution" }) }))}">${e(`${projectId}:${id}`)} — ${e(title)}</a>`;
}
function renderNextTasks(next: PlanNextSummary, projectId: string, planId: string): string {
  const groups = [
    ["进行中任务", next.in_progress],
    ["可开始任务", next.ready],
    ["受阻任务", next.blocked],
  ] as const;
  return `<section class="plan-next"><h3>下一步任务</h3><div class="plan-next-groups">${groups.map(([label, items]) => `<section aria-label="${label}"><h4>${label} (${items.length})</h4>${items.length === 0 ? '<p class="muted">暂无任务</p>' : `<ul>${items.map((item) => `<li>${taskLink(projectId, planId, item.id, item.title, item.project)} <span class="badge badge-priority">${e(item.priority)}</span>${"reasons" in item ? `<ul class="dependency-reasons">${item.reasons.map((reason) => `<li>依赖 ${e(reason.id)}：${e(reason.message)}</li>`).join("")}</ul>` : ""}</li>`).join("")}</ul>`}</section>`).join("")}</div>${next.diagnostics.map((d) => `<p class="reading-notice">${e(d.id)}：${e(d.message)}</p>`).join("")}</section>`;
}
function renderDeliveryReports(plan: WorkbenchPlan, projectId: string): string {
  const reports = plan.delivery_reports;
  const completed =
    plan.execution.materialized &&
    plan.execution.counts.total > 0 &&
    plan.execution.counts.done === plan.execution.counts.total;
  return `<section class="plan-delivery" aria-label="交付报告"><h3>交付报告</h3>${
    reports.length === 0
      ? `<p>${completed ? "任务已完成，尚无交付报告。" : "尚无交付报告。"}</p>`
      : `<p class="muted">报告记录创建时的交付快照，当前任务进度以执行进度为准。</p><ul>${reports.map((report) => `<li><a href="${e(formatRoute({ projectId, view: "reports", reportId: report.id, planId: plan.id, returnTo: formatRoute({ projectId, view: "plans", planId: plan.id, planTab: "execution" }) }))}">${e(report.id)} — ${e(report.title)}</a><span class="badge">${e(report.outcome)}</span><time datetime="${e(report.created_at)}">${e(report.created_at)}</time></li>`).join("")}</ul>`
  }</section>`;
}
