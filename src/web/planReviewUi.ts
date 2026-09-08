import { escapeHtml as e } from "./render.js";
import type { AppState } from "./types.js";

export function createPlanReviewUi(container: HTMLElement, getState: () => AppState) {
  const results = new Map<string, { message: string; text: string }>();
  let destroyed = false;
  function render() {
    const state = getState();
    if (destroyed || !container.querySelector || state.currentView !== "plans") return;
    const key = `${state.selectedProjectId}/${state.selectedPlanId}`;
    const result = results.get(key);
    const host = container.querySelector<HTMLElement>("[data-plan-copy-result]");
    if (host)
      host.innerHTML = result
        ? `<p role="status">${e(result.message)}</p>${result.text ? `<label>手动复制上下文<textarea class="form-input" readonly rows="6">${e(result.text)}</textarea></label>` : ""}`
        : "";
  }
  async function copy(target: HTMLElement) {
    const state = getState();
    const plan = state.readPages?.plans.find((entry) => entry.id === state.selectedPlanId);
    if (!plan || !state.selectedProjectId) return;
    const key = `${state.selectedProjectId}/${plan.id}`;
    if (state.readPagesLoading || state.readPagesError || !plan.revision) {
      results.set(key, { message: "当前版本未确认，请先刷新计划后复制。", text: "" });
      render();
      return;
    }
    const item = plan.items.find((entry) => entry.key === target.dataset.planCopy);
    const text = [
      `Project: ${state.selectedProjectId}`,
      `Plan: ${plan.id} — ${plan.title}`,
      `Reference: project-ops:plans/${plan.id}.json`,
      `Revision: ${plan.revision}`,
      `pops plan show ${state.selectedProjectId} ${plan.id} --json`,
      ...(item
        ? [
            `Task key: ${item.key}`,
            `Title: ${item.title}`,
            `Target project: ${item.project ?? state.selectedProjectId}`,
            `Dependencies: ${item.depends_on.join(", ") || "无"}`,
            "",
            "## 计划目标",
            plan.goal,
            "",
            "## 任务正文",
            item.body,
          ]
        : []),
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      results.set(key, { message: "已复制当前阅读版本的上下文。", text: "" });
    } catch {
      results.set(key, { message: "无法写入剪贴板，请选择下方文本手动复制。", text });
    }
    render();
  }
  function onClick(event: Event) {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-plan-copy]");
    if (target) void copy(target);
  }
  container.addEventListener("click", onClick);
  return {
    render,
    destroy() {
      destroyed = true;
      container.removeEventListener("click", onClick);
    },
  };
}
