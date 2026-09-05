import { escapeHtml } from "./render.js";
import type { BacklogViewState } from "./backlogController.js";

export function renderBacklogPanel(state: BacklogViewState): string {
  if (state.loading) return '<p role="status">Loading backlog…</p>';
  if (state.error) return `<p role="alert">${escapeHtml(state.error.message)}</p><button id="backlog-refresh">Retry backlog</button>`;
  const groups = ["todo", "in_progress", "blocked", "done", "cancelled"].map((status) => {
    const items = state.items.filter((item) => item.status === status).sort((a, b) => a.id.localeCompare(b.id));
    if (items.length === 0) return "";
    return `<section><h3>${status} (${items.length})</h3><ul class="items-list">${items.map((item) =>
      `<li><button class="btn btn-secondary" data-backlog-item="${escapeHtml(item.id)}" ${state.saving ? "disabled" : ""}
        aria-pressed="${item.id === state.selectedItemId}">${escapeHtml(item.id)} — ${escapeHtml(item.title)} (${escapeHtml(item.priority)})</button></li>`).join("")}</ul></section>`;
  }).join("");
  const item = state.item;
  const blocked = item?.depends_on.filter((id) => state.items.find((entry) => entry.id === id)?.status !== "done") ?? [];
  let detail = state.detailLoading ? '<p role="status">Loading item…</p>' : "";
  if (state.detailError) {
    detail += `<p role="alert">${escapeHtml(state.detailError.code ?? "ERROR")}: ${escapeHtml(state.detailError.message)}</p>`;
  }
  if (state.selectedItemId !== null) detail += `<button id="backlog-item-refresh" ${state.saving ? "disabled" : ""}>Refresh item</button>`;
  if (item && !state.detailLoading) {
    detail += `<h3>${escapeHtml(item.id)} — ${escapeHtml(item.title)}</h3>
      <p>Priority: ${escapeHtml(item.priority)} · Status: ${escapeHtml(item.status)} · Revision: <code>${escapeHtml(item.revision)}</code></p>
      <p>Dependencies: ${item.depends_on.map(escapeHtml).join(", ") || "None"}</p>
      ${blocked.length ? `<p role="status">Unfinished or missing dependencies: ${blocked.map(escapeHtml).join(", ")}. Status updates remain explicit, as in the CLI.</p>` : ""}
      <h4>Markdown body</h4><pre class="backlog-body">${escapeHtml(item.body)}</pre>
      <div aria-label="Update item status">${["todo", "in_progress", "done"].map((status) =>
        `<button class="btn btn-primary" data-backlog-status="${status}" ${state.saving || state.detailError?.code === "REVISION_MISMATCH" ? "disabled" : ""}>${status}</button>`).join(" ")}</div>`;
  }
  if (state.saving) detail += '<p role="status">Saving…</p>';
  if (state.message) detail += `<p role="status">${escapeHtml(state.message)}</p>`;
  return `<div class="domain-page"><h2>Backlog (${state.items.length})</h2>
    <button id="backlog-refresh" ${state.saving ? "disabled" : ""}>Refresh backlog</button>
    <div class="backlog-layout"><div>${groups || '<p>No backlog items found.</p>'}</div>
    <section aria-label="Backlog item detail">${detail || '<p>Select an item to view its body and update status.</p>'}</section></div></div>`;
}
