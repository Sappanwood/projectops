import type { BacklogItem } from "../backlog/item.js";
import type { BacklogItemSummary } from "../application/backlogApi.js";
import type { ApiClient } from "./apiClient.js";
import type { AppState, RouteState } from "./types.js";
import { escapeHtml as e } from "./render.js";
import { formatRoute } from "./router.js";

type Relation = { reference: { project: string; item: string }; item: BacklogItem };
export type DependencyRelations = {
  dependencies: (Relation & { satisfied: boolean; reasons: { message: string }[] })[];
  dependents: Relation[];
  complete: boolean;
  diagnostics: { reference: string; code: string; message: string }[];
};
export function renderDependencyRelations(data: DependencyRelations, origin: RouteState): string {
  const link = ({ reference, item }: Relation) =>
    `<a href="${e(formatRoute({ projectId: reference.project, view: "backlog", itemId: reference.item, returnTo: formatRoute({ ...origin, returnTo: undefined }) }))}">${e(item.title)} · ${e(reference.project)}:${e(reference.item)}</a> <span class="badge badge-${e(item.status)}">${e(item.status)}</span>`;
  return `<div data-direct-dependencies><h4>直接前置 (${data.dependencies.length})</h4>${data.dependencies.length ? `<ul>${data.dependencies.map((row) => `<li>${link(row)} <strong>${row.satisfied ? "已满足" : "尚未满足"}</strong>${row.reasons.map((reason) => `<p class="muted">${e(reason.message)}</p>`).join("")}</li>`).join("")}</ul>` : "<p>无直接前置</p>"}</div><div data-dependent-tasks><h4>谁依赖此任务 (${data.dependents.length})</h4>${data.dependents.length ? `<ul>${data.dependents.map((row) => `<li>${link(row)}</li>`).join("")}</ul>` : "<p>未发现直接下游</p>"}</div>${!data.complete ? '<p role="status" class="reading-notice">依赖读取不完整，不能据此认定无阻塞或无下游。</p>' : ""}${data.diagnostics.map((d) => `<p role="alert">${e(d.reference)} · ${e(d.code)}：${e(d.message)}</p>`).join("")}`;
}

type Entry = {
  item: BacklogItem;
  relations: DependencyRelations | null;
  loading: boolean;
  error: string;
  draft: string[] | null;
  revision: string;
  project: string;
  candidates: BacklogItemSummary[];
  candidate: string;
  choosing: boolean;
  busy: boolean;
  message: string;
};
const button = (action: string, text: string, disabled = false) =>
  `<button type="button" class="btn btn-secondary" data-dependency-action="${action}" ${disabled ? "disabled" : ""}>${e(text)}</button>`;

export function createDependencyUi(
  container: HTMLElement,
  api: ApiClient,
  getState: () => AppState,
  updated: () => Promise<void>,
) {
  const entries = new Map<string, Entry>();
  let destroyed = false;
  const current = () => {
    const state = getState();
    const item =
      state.currentView === "backlog" && !state.backlog.detailLoading ? state.backlog.item : null;
    return item && state.selectedProjectId
      ? { item, key: `${state.selectedProjectId}:${item.id}`, project: state.selectedProjectId }
      : null;
  };
  const path = (project: string, id: string) =>
    `/api/projects/${encodeURIComponent(project)}/backlog/${encodeURIComponent(id)}`;
  async function relations(entry: Entry, project: string) {
    entry.loading = true;
    entry.error = "";
    render();
    const result = await api.request!<DependencyRelations>(
      `${path(project, entry.item.id)}/dependencies`,
    );
    if (destroyed) return;
    entry.loading = false;
    if (result.ok) entry.relations = result.data;
    else entry.error = `${result.error.code}: ${result.error.message}`;
    render();
  }
  async function candidates(entry: Entry) {
    const project = entry.project;
    entry.choosing = true;
    entry.candidates = [];
    entry.candidate = "";
    render();
    const result = await api.listBacklog(project);
    if (destroyed || entry.project !== project) return;
    entry.choosing = false;
    if (result.ok)
      entry.candidates = result.data.items.filter(
        (item) =>
          item.item_type === "task" &&
          !(project === entry.item.project && item.id === entry.item.id),
      );
    else entry.message = `${result.error.code}: ${result.error.message}`;
    render();
  }
  function render() {
    if (destroyed || !api.request || !container.querySelector) return;
    const selected = current();
    if (!selected) return;
    const panel = container.querySelector('[aria-label="Backlog item detail"]');
    if (!panel) return;
    let entry = entries.get(selected.key);
    if (!entry) {
      entry = {
        item: selected.item,
        relations: null,
        loading: false,
        error: "",
        draft: null,
        revision: selected.item.revision,
        project: selected.project,
        candidates: [],
        candidate: "",
        choosing: false,
        busy: false,
        message: "",
      };
      entries.set(selected.key, entry);
      void relations(entry, selected.project);
      return;
    }
    if (entry.item !== selected.item) {
      entry.item = selected.item;
      void relations(entry, selected.project);
      return;
    }
    let slot = panel.querySelector<HTMLElement>("[data-dependency-panel]");
    if (!slot) {
      slot = container.ownerDocument.createElement("section");
      slot.dataset.dependencyPanel = "";
      panel.querySelector(".reading-header")?.after(slot);
    }
    const active = container.ownerDocument.activeElement as HTMLElement | null;
    const focusAttribute =
      active && slot.contains(active)
        ? ["data-dependency-project", "data-dependency-candidate", "data-dependency-action"].find(
            (name) => active.hasAttribute(name),
          )
        : undefined;
    const focusValue = focusAttribute ? active!.getAttribute(focusAttribute) : null;
    const editor =
      entry.draft === null
        ? button("edit", "编辑依赖")
        : `<h4>依赖草稿</h4><ul data-dependency-draft>${entry.draft.map((ref, index) => `<li><code>${e(ref)}</code> ${button(`remove:${index}`, `移除 ${ref}`, entry.busy)}</li>`).join("")}</ul><div class="dependency-picker"><label>依赖项目<select class="form-select" data-dependency-project ${entry.busy ? "disabled" : ""}>${getState()
            .workspace?.projects.map(
              (project) =>
                `<option value="${e(project.id)}" ${project.id === entry.project ? "selected" : ""}>${e(project.id)}</option>`,
            )
            .join(
              "",
            )}</select></label><label>依赖任务<select class="form-select" data-dependency-candidate ${entry.busy || entry.choosing ? "disabled" : ""}><option value="">${entry.choosing ? "读取任务…" : "选择任务"}</option>${entry.candidates.map((item) => `<option value="${e(item.id)}" ${entry.candidate === item.id ? "selected" : ""}>${e(item.title)} · ${e(entry.project)}:${e(item.id)} · ${e(item.status)}</option>`).join("")}</select></label>${button("add", "添加依赖", entry.busy || !entry.candidate)}</div>${entry.candidate ? `<p class="form-help">已选择：${e(entry.candidates.find((item) => item.id === entry.candidate)?.title ?? "")} · ${e(entry.project)}:${e(entry.candidate)} · ${e(entry.candidates.find((item) => item.id === entry.candidate)?.status ?? "")}</p>` : ""}${!entry.choosing && !entry.candidates.length ? '<p class="muted">此项目无可选任务。</p>' : ""}<p class="form-help">草稿基于 revision <code>${e(entry.revision)}</code>。添加或移除后保存。</p>${button("save", "保存依赖", entry.busy)} ${button("reload", "重读版本并保留依赖草稿", entry.busy)} ${button("close", "收起依赖编辑", entry.busy)}`;
    slot.innerHTML = `<h3>任务依赖</h3>${button("refresh", "刷新依赖关系", entry.loading)}${entry.loading ? '<p role="status">读取依赖关系…</p>' : ""}${entry.error ? `<p role="alert">${e(entry.error)}</p>` : ""}${entry.relations ? renderDependencyRelations(entry.relations, getState().route) : ""}${editor}${entry.busy ? '<p role="status">保存中…</p>' : ""}${entry.message ? `<p class="reading-notice" role="status">${e(entry.message)}</p>` : ""}`;
    if (focusAttribute) {
      const next = Array.from(slot.querySelectorAll<HTMLElement>(`[${focusAttribute}]`)).find(
        (element) => element.getAttribute(focusAttribute) === focusValue,
      );
      next?.focus({ preventScroll: true });
    }
  }
  async function action(target: HTMLElement) {
    const selected = current();
    if (!selected || !api.request) return;
    const entry = entries.get(selected.key);
    if (!entry || entry.busy) return;
    const action = target.dataset.dependencyAction!;
    if (action === "refresh") return relations(entry, selected.project);
    if (action === "edit") {
      if (entry.draft === null) {
        entry.draft = [...selected.item.depends_on];
        entry.revision = selected.item.revision;
      }
      return candidates(entry);
    }
    if (action === "close") {
      entry.draft = null;
      entry.message = "";
      render();
      return;
    }
    if (action.startsWith("remove:")) {
      entry.draft?.splice(Number(action.split(":")[1]), 1);
      render();
      return;
    }
    if (action === "add") {
      const ref = `${entry.project}:${entry.candidate}`;
      if (
        entry.candidate &&
        entry.draft &&
        !entry.draft.some(
          (value) => (value.includes(":") ? value : `${selected.project}:${value}`) === ref,
        )
      )
        entry.draft.push(ref);
      render();
      return;
    }
    entry.busy = true;
    entry.message = "";
    render();
    if (action === "reload") {
      const result = await api.showBacklog(selected.project, selected.item.id);
      entry.busy = false;
      if (result.ok) {
        entry.revision = result.data.item.revision;
        entry.message = "已重读版本，依赖草稿已保留。请核对后保存。";
      } else entry.message = `${result.error.code}: ${result.error.message}`;
    } else if (action === "save") {
      const result = await api.request<{ result: BacklogItem }>(
        path(selected.project, selected.item.id),
        { depends_on: entry.draft, expected_revision: entry.revision },
      );
      entry.busy = false;
      if (result.ok) {
        entry.revision = result.data.result.revision;
        entry.draft = null;
        entry.message = "依赖已保存";
        await updated();
      } else entry.message = `${result.error.code}: ${result.error.message}`;
    }
    render();
  }
  function click(event: Event) {
    const target = (event.target as HTMLElement)?.closest<HTMLElement>("[data-dependency-action]");
    if (target) {
      event.preventDefault();
      void action(target);
    }
  }
  function change(event: Event) {
    const target = event.target as HTMLSelectElement;
    const selected = current();
    const entry = selected && entries.get(selected.key);
    if (!entry) return;
    if (target.matches("[data-dependency-project]")) {
      entry.project = target.value;
      void candidates(entry);
    }
    if (target.matches("[data-dependency-candidate]")) {
      entry.candidate = target.value;
      render();
    }
  }
  container.addEventListener("click", click);
  container.addEventListener("change", change);
  return {
    render,
    destroy() {
      destroyed = true;
      container.removeEventListener("click", click);
      container.removeEventListener("change", change);
    },
  };
}
