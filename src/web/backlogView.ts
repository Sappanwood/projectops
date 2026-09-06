import { escapeHtml as e } from "./render.js";
import { renderReadingBody } from "./markdown.js";
import type { BacklogViewState } from "./backlogController.js";

const labels: Record<string, string> = {
  todo: "待办",
  in_progress: "进行中",
  blocked: "受阻",
  done: "已完成",
  cancelled: "已取消",
};

export function renderBacklogPanel(state: BacklogViewState): string {
  if (state.loading) return '<p role="status">Loading backlog…</p>';
  if (state.error)
    return `<p role="alert">${e(state.error.message)}</p><button class="btn btn-secondary" id="backlog-refresh">Retry backlog</button>`;
  const groups = ["todo", "in_progress", "blocked", "done", "cancelled"]
    .map((status) => {
      const items = state.items
        .filter((item) => item.status === status)
        .sort((a, b) => a.id.localeCompare(b.id));
      if (items.length === 0) return "";
      const group = `<ul class="items-list">${items
        .map(
          (item) =>
            `<li><button class="backlog-select" data-backlog-item="${e(item.id)}" ${state.saving ? "disabled" : ""}
        aria-label="${e(item.id)} — ${e(item.title)} (${e(item.priority)})" aria-pressed="${item.id === state.selectedItemId}">
        <span class="backlog-select-title">${e(item.title)}</span><span class="item-meta"><code>${e(item.id)}</code><span class="badge badge-priority">${e(item.priority)}</span><span class="badge badge-${e(status)}">${labels[status]}</span></span></button></li>`,
        )
        .join("")}</ul>`;
      const heading = `${labels[status]} <span class="group-count">${items.length}</span>`;
      return status === "done"
        ? `<details class="backlog-group" data-reading-key="backlog-group-done"${state.selectedItemId !== null && items.some((item) => item.id === state.selectedItemId) ? " open" : ""}><summary>${heading}</summary>${group}</details>`
        : `<section class="backlog-group"><h3>${heading}</h3>${group}</section>`;
    })
    .join("");
  const item = state.item;
  const blocked =
    item?.depends_on.filter(
      (id) => state.items.find((entry) => entry.id === id)?.status !== "done",
    ) ?? [];
  let detail = state.detailLoading ? '<p role="status">Loading item…</p>' : "";
  if (state.detailError)
    detail += `<p class="reading-notice" role="alert">${e(state.detailError.code ?? "ERROR")}: ${e(state.detailError.message)}</p>`;
  if (item && !state.detailLoading) {
    detail += `<header class="reading-header"><div class="item-meta"><code>${e(item.id)}</code><span class="badge badge-priority">${e(item.priority)}</span><span class="badge badge-${e(item.status)}" aria-label="Status: ${e(item.status)}">${labels[item.status] ?? e(item.status)}</span></div>
      <h3>${e(item.title)}</h3>
      <div class="reading-actions"><div class="status-actions" aria-label="Update item status"><span class="muted">状态</span>${[
        "todo",
        "in_progress",
        "done",
      ]
        .map(
          (status) =>
            `<button class="btn ${item.status === status ? "btn-primary" : "btn-secondary"}" aria-label="${status}" aria-pressed="${item.status === status}" data-backlog-status="${status}" ${state.saving || state.detailError?.code === "REVISION_MISMATCH" ? "disabled" : ""}>${labels[status]}</button>`,
        )
        .join(" ")}</div>
      <button class="btn btn-secondary" id="backlog-item-refresh" aria-label="Refresh item" ${state.saving ? "disabled" : ""}>刷新条目</button></div>
      ${item.depends_on.length ? `<p class="dependency-line">依赖：${item.depends_on.map(e).join(", ")}</p>` : ""}
      ${blocked.length ? `<p class="reading-notice" role="status">尚未完成或缺失的依赖：${blocked.map(e).join(", ")}。请根据实际情况调整状态。</p>` : ""}</header>
      ${renderReadingBody(item.body, `backlog-${item.id}`)}
      <details class="technical-details" data-reading-key="backlog-meta-${e(item.id)}"><summary>技术信息</summary><dl><dt>Revision</dt><dd><code>${e(item.revision)}</code></dd><dt>Status</dt><dd>Status: ${e(item.status)}</dd><dt>Dependencies</dt><dd>${item.depends_on.map(e).join(", ") || "None"}</dd></dl></details>`;
  } else if (state.selectedItemId !== null)
    detail += `<button class="btn btn-secondary" id="backlog-item-refresh" ${state.saving ? "disabled" : ""}>Refresh item</button>`;
  if (state.saving) detail += '<p role="status">Saving…</p>';
  if (state.message) detail += `<p class="reading-notice" role="status">${e(state.message)}</p>`;
  return `<div class="domain-page"><header class="domain-page-header"><div><h2>Backlog <span class="group-count">${state.items.length}</span></h2><p class="muted">选择任务，阅读要求并推进状态。</p></div>
    <button class="btn btn-secondary" id="backlog-refresh" aria-label="Refresh backlog" ${state.saving ? "disabled" : ""}>刷新列表</button></header>
    <div class="backlog-layout"><aside class="backlog-sidebar" aria-label="任务列表">${groups || "<p>No backlog items found.</p>"}</aside>
    <section class="reading-panel" aria-label="Backlog item detail">${detail || '<div class="reading-empty"><h3>选择一个任务</h3><p>从左侧列表查看目标、验收标准和任务详情。</p></div>'}</section></div></div>`;
}
