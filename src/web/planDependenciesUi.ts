import type { PlanDraft } from "../plan/plan.js";
import { escapeHtml as e } from "./render.js";

export type DependencyChoice = { id: string; title: string; status: string; item_type: string };

export function editPlanDependency(
  body: string,
  key: string,
  dependency: string,
  remove: boolean,
): string {
  const draft = JSON.parse(body) as PlanDraft;
  const item = draft.items.find((entry) => entry.key === key);
  if (!item || !dependency || key === dependency) throw new Error("请选择有效的任务与前置依赖。");
  const current = item.depends_on ?? [];
  item.depends_on = remove
    ? current.filter((entry) => entry !== dependency)
    : [...new Set([...current, dependency])];
  return JSON.stringify(draft, null, 2);
}

export function renderPlanDependencyEditor(
  body: string,
  selectedKey: string,
  project: string,
  projects: { id: string }[],
  candidates: DependencyChoice[],
  busy: boolean,
): string {
  let draft: PlanDraft;
  try {
    draft = JSON.parse(body) as PlanDraft;
    if (
      !draft ||
      !Array.isArray(draft.items) ||
      !draft.items.every(
        (item) =>
          item &&
          typeof item === "object" &&
          typeof item.key === "string" &&
          typeof item.title === "string" &&
          (item.item_type === "task" || item.item_type === "epic") &&
          (item.depends_on === undefined ||
            (Array.isArray(item.depends_on) &&
              item.depends_on.every((ref) => typeof ref === "string"))),
      )
    )
      return '<p class="form-help">计划任务结构无效；请修正 JSON 后重新预览。草案已保留。</p>';
  } catch {
    return '<p class="form-help">修正 JSON 后可使用依赖选择器。</p>';
  }
  const tasks = draft.items.filter((item) => item.item_type === "task");
  const key = tasks.some((item) => item.key === selectedKey) ? selectedKey : tasks[0]?.key;
  const selected = tasks.find((item) => item.key === key);
  const disabled = busy ? "disabled" : "";
  const description = (ref: string) => {
    const item = candidates.find((candidate) => `${project}:${candidate.id}` === ref);
    return item
      ? `${item.title} · ${item.status}`
      : (tasks.find((task) => task.key === ref)?.title ?? "");
  };
  const options = (entries: { value: string; label: string }[], value = "") =>
    entries
      .map(
        (entry) =>
          `<option value="${e(entry.value)}" ${entry.value === value ? "selected" : ""}>${e(entry.label)}</option>`,
      )
      .join("");
  return `<fieldset ${disabled}><legend>任务依赖</legend><p class="form-help">选择器只更新计划草案；通过下方预览与确认保存。Plan 内 key 与既有 project:ID 引用分别保留。</p>
    <label>编辑依赖的任务<select class="form-select" data-plan-dependency-field="key">${options(
      tasks.map((item) => ({ value: item.key, label: `${item.key} — ${item.title}` })),
      key,
    )}</select></label><p class="form-help">当前任务：${e(selected?.title ?? "未选择")}</p>
    <ul>${(selected?.depends_on ?? []).map((ref) => `<li><code>${e(ref)}</code> <span class="form-help">${e(description(ref))}</span> · ${ref.includes(":") ? "既有任务" : "Plan 内任务"} <button type="button" class="btn btn-secondary" data-plan-dependency-remove="${e(ref)}">移除</button></li>`).join("") || "<li>无前置依赖</li>"}</ul>
    <label>Plan 内任务<select aria-label="Plan 内任务" class="form-select" data-plan-dependency-field="local"><option value="">选择前置任务</option>${options(tasks.filter((item) => item.key !== key).map((item) => ({ value: item.key, label: `${item.key} — ${item.title}` })))}</select></label>
    <label>既有任务所属项目<select class="form-select" data-plan-dependency-field="project">${options(
      projects.map((entry) => ({ value: entry.id, label: entry.id })),
      project,
    )}</select></label>
    <label>既有任务<select aria-label="既有任务" class="form-select" data-plan-dependency-field="external"><option value="">选择既有 task</option>${options(candidates.filter((item) => item.item_type === "task").map((item) => ({ value: `${project}:${item.id}`, label: `${project}:${item.id} — ${item.title} · ${item.status}` })))}</select></label>
  </fieldset>`;
}
