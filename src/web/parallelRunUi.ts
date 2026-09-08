import type { ParallelRun } from "../planRun/parallelRun.js";
import type { ApiClient } from "./apiClient.js";
import { planRunRestriction } from "./planIdentityView.js";
import { renderRunNotice } from "./planRunNotice.js";
import { escapeHtml as e } from "./render.js";
import { formatRoute } from "./router.js";
import type { AppState } from "./types.js";

type Panel = {
  loaded: boolean;
  runs: ParallelRun[];
  selected: string;
  busy: boolean;
  message: string;
  note: string;
  head: string;
  rework: Record<string, string>;
  request: number;
};
const labels: Record<string, string> = {
  ready: "待启动",
  running: "运行中",
  paused: "已暂停",
  completed: "全部落地完成",
  stopped: "并行执行已终止",
  pending: "等待依赖与资源",
  awaiting_acceptance: "等待人工验收",
  awaiting_landing: "已验收，等待落地",
  landing: "落地候选处理中；异常时需人工核对",
  landed: "已落地",
  failed: "失败，需人工恢复",
  unknown: "状态未知，需核对旧工作",
};
const button = (action: string, label: string, disabled = false) =>
  `<button type="button" class="btn btn-secondary" data-parallel-action="${action}" ${disabled ? "disabled" : ""}>${label}</button>`;
export function createParallelRunUi(
  container: HTMLElement,
  api: ApiClient,
  getState: () => AppState,
) {
  const panels = new Map<string, Panel>();
  let destroyed = false;
  let projection: AppState["readPages"] = null;
  const key = (project: string, plan: string) => `${project}/${plan}`;
  const base = (project: string) => `/api/projects/${encodeURIComponent(project)}/parallel-runs`;
  function panel(project: string, plan: string): Panel {
    const id = key(project, plan);
    let value = panels.get(id);
    if (!value) {
      value = {
        loaded: false,
        runs: [],
        selected: "",
        busy: false,
        message: "",
        note: "",
        head: "",
        rework: {},
        request: 0,
      };
      panels.set(id, value);
      void load(project, plan, value);
    }
    return value;
  }
  async function load(project: string, plan: string, value: Panel) {
    if (!api.request || value.busy) return;
    const request = ++value.request;
    const result = await api.request<{ runs: ParallelRun[] }>(
      `${base(project)}?plan_id=${encodeURIComponent(plan)}`,
    );
    if (destroyed || request !== value.request) return;
    value.loaded = true;
    if (result.ok) {
      value.runs = result.data.runs.toSorted((a, b) => b.created_at.localeCompare(a.created_at));
      if (!value.selected)
        value.selected =
          value.runs.find((run) => !["completed", "stopped"].includes(run.state))?.id ??
          value.runs[0]?.id ??
          "";
    } else value.message = `${result.error.code}: ${result.error.message}`;
    render();
  }
  function render() {
    const state = getState();
    if (
      destroyed ||
      !api.request ||
      !container.querySelectorAll ||
      state.currentView !== "plans" ||
      !state.selectedProjectId
    )
      return;
    const refreshed = projection !== state.readPages;
    projection = state.readPages;
    for (const card of container.querySelectorAll<HTMLElement>("[data-plan-id]")) {
      const plan = card.dataset.planId!,
        project = state.selectedProjectId;
      if (!state.readPages?.plans.some((entry) => entry.id === plan)) continue;
      const permission =
        state.readPages?.plans.find((entry) => entry.id === plan)?.execution_policy
          ?.max_parallel === 2;
      const restriction = planRunRestriction(
        state.readPages?.plans.find((entry) => entry.id === plan),
        project,
      );
      const value = panel(project, plan);
      if (refreshed && value.loaded) {
        value.message = "";
        void load(project, plan, value);
      }
      renderRunNotice(
        card.querySelector("[data-parallel-notice]"),
        "并行执行",
        value.runs,
        state.route,
        value.loaded,
        value.message,
      );
      let slot = card.querySelector<HTMLElement>("[data-parallel-panel]");
      if (!slot) {
        slot = container.ownerDocument.createElement("section");
        slot.dataset.parallelPanel = plan;
        slot.setAttribute("aria-label", `并行执行 ${plan}`);
        (card.querySelector("[data-plan-run-host]") ?? card).append(slot);
      }
      const focused = slot.contains(container.ownerDocument.activeElement)
        ? (container.ownerDocument.activeElement as HTMLTextAreaElement)
        : null;
      const field = focused?.dataset.parallelField,
        reworkField = focused?.dataset.parallelReworkNote,
        selection = focused ? [focused.selectionStart, focused.selectionEnd] : null;
      const focusAttribute = [
        "data-parallel-action",
        "data-parallel-id",
        "data-parallel-land",
        "data-parallel-rework",
        "href",
      ].find((name) => focused?.hasAttribute(name));
      const focusedSummary =
        focused?.tagName === "SUMMARY"
          ? focused.parentElement?.getAttribute("data-parallel-details")
          : null;
      const nodeScrollTop =
        slot.dataset.selectedRun === value.selected
          ? (slot.querySelector<HTMLElement>(".run-nodes")?.scrollTop ?? 0)
          : 0;
      slot.dataset.selectedRun = value.selected;
      const scrollPosition = typeof window !== "undefined" ? window.scrollY : 0;
      const opened = new Set(
        [...slot.querySelectorAll<HTMLDetailsElement>("details[open]")].map(
          (detail) => detail.dataset.parallelDetails,
        ),
      );
      const run = value.runs.find((entry) => entry.id === value.selected);
      const active = value.runs.filter((entry) => !["completed", "stopped"].includes(entry.state));
      const history = value.runs.filter((entry) => ["completed", "stopped"].includes(entry.state));

      const terminal = run && ["completed", "stopped"].includes(run.state);
      slot.dataset.active = String(active.length > 0);
      slot.innerHTML = `${restriction ? `<p class="reading-notice">${e(restriction)}</p>` : ""}<h4>有界并行执行</h4><p>${permission ? "计划已显式允许并行，最大容量为 2。" : "计划尚未显式允许并行；请先修订并批准并行许可。"} 每个任务使用独立 checkout，前置任务验收并落地后才解锁依赖。</p>${button("refresh", "刷新并行执行", value.busy)} ${button("create", "创建有界并行执行", value.busy || !!restriction || !permission || state.readPages?.plans.find((entry) => entry.id === plan)?.status === "done")}
        ${
          active.length
            ? `<div class="run-current"><h5>当前并行运行</h5><ul>${active
                .map(
                  (entry) =>
                    `<li><button type="button" class="btn btn-secondary" data-parallel-id="${e(entry.id)}">${e(labels[entry.state] ?? entry.state)} · ${e(entry.id)}</button>${entry.nodes
                      .filter((node) => ["failed", "unknown"].includes(node.state))
                      .map(
                        (node) =>
                          `<p role="alert">${e(node.input.title)}：${e(labels[node.state] ?? node.state)}</p>`,
                      )
                      .join("")}</li>`,
                )
                .join("")}</ul></div>`
            : `<p>当前没有活动并行运行。</p>`
        }
        ${history.length ? `<details data-parallel-details="history" class="run-history"><summary>并行历史运行（${history.length}）</summary><ul>${history.map((entry) => `<li><button type="button" class="btn btn-secondary" data-parallel-id="${e(entry.id)}">${e(entry.id)} · ${e(labels[entry.state] ?? entry.state)}</button></li>`).join("")}</ul></details>` : ""}
        ${!value.runs.length ? "<p>尚无并行执行。</p>" : ""}
        ${
          run
            ? `${["completed", "stopped"].includes(run.state) ? `<details data-parallel-details="record-${e(run.id)}" class="run-history"><summary>查看并行历史详情 · ${e(labels[run.state] ?? run.state)}</summary>` : ""}<article class="run-detail"><h4>${e(run.plan_snapshot.title)} · ${e(labels[run.state] ?? run.state)}</h4><p>执行 ID：${e(run.id)} · 冻结计划 revision：${e(run.plan_revision)} · 并发容量：${run.capacity}</p>
          ${run.model ? `<p>固定模型：${e(run.model.provider)}/${e(run.model.id)}</p>` : ""}
          <p>集成 HEAD：<code>${e(run.integration_head)}</code></p><p>集成 checkout：<code>${e(run.workspace.integrationDir)}</code></p>
          <details data-parallel-details="snapshot"><summary>查看并行执行冻结计划</summary><pre>${e(JSON.stringify(run.plan_snapshot, null, 2))}</pre></details>
          <details data-parallel-details="commands"><summary>查看服务端落地验证命令</summary><pre>${e(JSON.stringify(run.commands, null, 2))}</pre></details>
          <ol class="run-nodes">${run.nodes
            .map(
              (
                node,
              ) => `<li data-parallel-node="${e(node.key)}"><a href="#/projects/${encodeURIComponent(project)}/backlog/${encodeURIComponent(node.item_id)}?plan=${encodeURIComponent(plan)}&amp;from=${encodeURIComponent(formatRoute({ projectId: project, view: "plans", planId: plan, planTab: "execution" }))}">${e(node.item_id)} — ${e(node.input.title)}</a><p>${e(labels[node.state] ?? node.state)} · ${node.parallel ? "允许并行" : "独占运行"} · 资源：${e(node.resources.join(", ") || "无声明资源")} · 依赖：${e(node.depends_on.join(", ") || "无")}</p><p>尝试：${e(node.attempt_ids.join(", ") || "尚未启动")}</p><p>任务 checkout：<code>${e(node.workspace?.dir ?? "尚未创建")}</code></p>
            ${node.landings.map((landing, index) => `<details data-parallel-details="landing-${e(node.key)}-${index}"><summary>落地结果 ${e(landing.outcome)} · ${e(landing.candidateCommit ?? "未生成提交")}</summary><p>候选 checkout：${e(landing.candidateDir)}</p><pre>${e(landing.evidence.slice(0, 65536))}</pre></details>`).join("")}
            ${node.workspace ? "<p>核对上述任务 checkout：有未提交改动时先在该目录 git commit，再用 pops execution verify 记录验证；到任务页人工验收后，返回此处落地。</p>" : ""}
            ${!terminal && (node.state === "awaiting_landing" || node.landings.some((landing) => landing.outcome !== "landed")) && !["landed", "running", "unknown", "landing", "pending"].includes(node.state) ? `<label>重新工作说明 ${e(node.input.title)}<textarea class="form-input" data-parallel-rework-note="${e(node.key)}">${e(value.rework[node.key] ?? "")}</textarea></label><button type="button" class="btn btn-secondary" data-parallel-rework="${e(node.key)}" ${value.busy || !value.rework[node.key]?.trim() ? "disabled" : ""}>要求修改并重新验收 ${e(node.input.title)}</button>` : ""}
            ${!terminal && node.state === "awaiting_landing" ? `<button type="button" class="btn btn-secondary" data-parallel-land="${e(node.key)}" ${value.busy ? "disabled" : ""}>验证并落地 ${e(node.input.title)}</button>` : ""}</li>`,
            )
            .join("")}</ol>
          ${run.diagnostics.map((message) => `<p role="alert">${e(message)}</p>`).join("")}
          ${run.state === "ready" ? button("advance", "启动并行任务", value.busy || !!restriction) : ""}
          ${
            !terminal
              ? `${button("pause", "暂停并行派发", value.busy || run.state === "paused")}<p>暂停后已运行的任务仍可结束。请进入任务页检查、停止或验收单个任务。</p>
          <label>并行恢复或终止说明<textarea class="form-input" data-parallel-field="note">${e(value.note)}</textarea></label><label>人工核对后的集成 HEAD（仅漂移时填写）<input class="form-input" data-parallel-field="head" value="${e(value.head)}"></label>
          ${run.state === "paused" ? button("resume", "确认恢复并行派发", value.busy || !!restriction || !value.note.trim()) : ""}
          ${button("close-stopped", "终止并行执行", value.busy || !value.note.trim() || run.nodes.some((node) => ["running", "unknown", "landing"].includes(node.state)))}`
              : ""
          }
          ${run.controls.length ? `<details data-parallel-details="controls"><summary>查看并行控制记录</summary><ul>${run.controls.map((control) => `<li>${e(control.at)} · ${e(control.action)} · ${e(control.note)}</li>`).join("")}</ul></details>` : ""}</article>${["completed", "stopped"].includes(run.state) ? "</details>" : ""}`
            : ""
        }
        ${value.message ? `<p role="alert">${e(value.message)}</p>` : ""}`;
      for (const detail of slot.querySelectorAll<HTMLDetailsElement>("details")) {
        detail.dataset.readingKey = `${plan}--parallelDetails-${value.selected}-${detail.dataset.parallelDetails}`;
        if (opened.has(detail.dataset.parallelDetails)) detail.open = true;
      }
      const nodeList = slot.querySelector<HTMLElement>(".run-nodes");
      if (nodeList) nodeList.scrollTop = nodeScrollTop;
      if (focusAttribute) {
        const value = focused!.getAttribute(focusAttribute)!;
        slot
          .querySelector<HTMLElement>(`[${focusAttribute}="${CSS.escape(value)}"]`)
          ?.focus({ preventScroll: true });
      } else if (focusedSummary) {
        slot
          .querySelector<HTMLElement>(
            `[data-parallel-details="${CSS.escape(focusedSummary)}"] > summary`,
          )
          ?.focus({ preventScroll: true });
      }
      if (typeof window !== "undefined")
        window.scrollTo({ top: scrollPosition, behavior: "instant" });
      if (field || reworkField) {
        const target = field
          ? slot.querySelector<HTMLTextAreaElement>(`[data-parallel-field="${field}"]`)
          : slot.querySelector<HTMLTextAreaElement>(`[data-parallel-rework-note="${reworkField}"]`);
        target?.focus({ preventScroll: true });
        if (target && selection) target.setSelectionRange(selection[0]!, selection[1]!);
      }
    }
  }
  async function act(target: HTMLElement) {
    if (!api.request) return;
    const plan = target.closest<HTMLElement>("[data-parallel-panel]")?.dataset.parallelPanel,
      project = getState().selectedProjectId;
    if (!plan || !project) return;
    const value = panel(project, plan);
    if (value.busy) return;
    if (target.dataset.parallelId) {
      value.selected = target.dataset.parallelId;
      render();
      return;
    }
    const action = target.dataset.parallelRework
      ? "rework"
      : target.dataset.parallelLand
        ? "land"
        : target.dataset.parallelAction!;
    if (action === "refresh") {
      value.message = "";
      await load(project, plan, value);
      return;
    }
    value.busy = true;
    value.request++;
    value.message = "";
    render();
    let result;
    if (action === "create") {
      const model = getState().modelSelection.selected;
      const revision = await api.request<{ revision: string }>(
        `/api/projects/${encodeURIComponent(project)}/plans/${encodeURIComponent(plan)}`,
      );
      if (!revision.ok) result = revision;
      else
        result = await api.request<{ run: ParallelRun; diagnostics: string[] }>(
          base(project),
          { model, plan_id: plan, expected_revision: revision.data.revision },
          "POST",
        );
    } else {
      const run = value.runs.find((entry) => entry.id === value.selected);

      if (!run) {
        value.busy = false;
        render();
        return;
      }
      result = await api.request<{ run: ParallelRun; diagnostics: string[] }>(
        `${base(project)}/${encodeURIComponent(run.id)}/${action}`,
        {
          expected_revision: run.revision,
          ...(action === "resume"
            ? {
                note: value.note,
                ...(value.head.trim() ? { integration_head: value.head.trim() } : {}),
              }
            : action === "close-stopped"
              ? { note: value.note }
              : action === "rework"
                ? {
                    node_key: target.dataset.parallelRework,
                    note: value.rework[target.dataset.parallelRework!],
                  }
                : action === "land"
                  ? { node_key: target.dataset.parallelLand }
                  : {}),
        },
        "POST",
      );
    }
    if (destroyed) return;
    value.busy = false;
    if (result.ok) value.selected = (result.data as { run: ParallelRun }).run.id;
    else value.message = `${result.error.code}: ${result.error.message}`;
    await load(project, plan, value);
  }
  function onClick(event: Event) {
    const target = (event.target as HTMLElement)?.closest<HTMLElement>(
      "[data-parallel-action], [data-parallel-id], [data-parallel-land], [data-parallel-rework]",
    );
    if (target) {
      event.preventDefault();
      void act(target);
    }
  }
  function onInput(event: Event) {
    const target = event.target as HTMLInputElement;
    const plan = target.closest<HTMLElement>("[data-parallel-panel]")?.dataset.parallelPanel,
      project = getState().selectedProjectId;
    const field = target.dataset.parallelField;
    if (plan && project && target.dataset.parallelReworkNote) {
      const value = panel(project, plan),
        node = target.dataset.parallelReworkNote;
      value.rework[node] = target.value;
      const submit = target
        .closest("[data-parallel-node]")
        ?.querySelector<HTMLButtonElement>("[data-parallel-rework]");
      if (submit) submit.disabled = value.busy || !target.value.trim();
    }
    if (plan && project && (field === "note" || field === "head")) {
      const value = panel(project, plan);
      value[field] = target.value;
      const resume = target
        .closest("[data-parallel-panel]")
        ?.querySelector<HTMLButtonElement>('[data-parallel-action="resume"]');
      if (resume)
        resume.disabled =
          value.busy ||
          !!planRunRestriction(
            getState().readPages?.plans.find((entry) => entry.id === plan),
            project,
          ) ||
          !value.note.trim();
      const close = target
        .closest("[data-parallel-panel]")
        ?.querySelector<HTMLButtonElement>('[data-parallel-action="close-stopped"]');
      const run = value.runs.find((entry) => entry.id === value.selected);

      if (close)
        close.disabled =
          value.busy ||
          !value.note.trim() ||
          !!run?.nodes.some((node) => ["running", "unknown", "landing"].includes(node.state));
    }
  }
  container.addEventListener("click", onClick);
  container.addEventListener("input", onInput);
  const timer =
    api.request && typeof window !== "undefined"
      ? setInterval(() => {
          const state = getState();
          if (state.currentView !== "plans" || !state.selectedProjectId) return;
          for (const card of container.querySelectorAll<HTMLElement>("[data-plan-id]")) {
            const plan = card.dataset.planId!;
            const value = panels.get(key(state.selectedProjectId, plan));
            if (
              value &&
              !value.busy &&
              value.runs.some((run) => !["completed", "stopped"].includes(run.state))
            )
              void load(state.selectedProjectId, plan, value);
          }
        }, 2000)
      : undefined;
  return {
    render,
    destroy() {
      destroyed = true;
      clearInterval(timer);
      container.removeEventListener("click", onClick);
      container.removeEventListener("input", onInput);
    },
  };
}
