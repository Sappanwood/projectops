import type { ModelCatalog, ModelRef } from "../execution/models.js";
import { escapeHtml as e } from "./render.js";

export type ModelSelectionState = ModelCatalog & {
  selected: ModelRef | null;
  loading: boolean;
  error: string;
};
const storageKey = "projectops.model";
export function initialModelSelection(): ModelSelectionState {
  let selected: ModelRef | null = null;
  try {
    const value: unknown = JSON.parse(globalThis.localStorage?.getItem(storageKey) ?? "null");
    if (
      value &&
      typeof value === "object" &&
      "provider" in value &&
      "id" in value &&
      typeof value.provider === "string" &&
      typeof value.id === "string"
    )
      selected = { provider: value.provider, id: value.id };
  } catch {
    /* Storage may be unavailable. */
  }
  return { selected, available: false, models: [], loading: true, error: "" };
}
export function rememberModel(selected: ModelRef | null): void {
  try {
    globalThis.localStorage?.setItem(storageKey, JSON.stringify(selected));
  } catch {
    /* Keep the session selection. */
  }
}
export function renderModelSelector(state: ModelSelectionState): string {
  const selectedValue = state.selected ? JSON.stringify(state.selected) : "";
  const found =
    !state.selected ||
    state.models.some(
      (m) => m.provider === state.selected!.provider && m.id === state.selected!.id,
    );
  const providers = [...new Set(state.models.map((m) => m.provider))].sort();
  const message =
    state.error ||
    (state.loading
      ? "正在读取模型…"
      : !state.available
        ? "服务尚未启用 Pi"
        : !state.models.length
          ? "请在本地 Pi 完成认证后刷新"
          : !found
            ? "所选模型不可用，请刷新或重新选择"
            : "仅用于新任务；计划运行在创建时固定模型");
  return `<div class="model-selector"><label for="model-select">模型</label>
    <select id="model-select" aria-describedby="model-selection-status" ${state.loading || !state.available ? "disabled" : ""}>
      <option value="" ${!state.selected ? "selected" : ""}>使用 Pi 默认模型</option>
      ${!found ? `<option value="${e(selectedValue)}" selected>${e(state.selected!.provider)}/${e(state.selected!.id)}（不可用）</option>` : ""}
      ${providers
        .map(
          (provider) =>
            `<optgroup label="${e(provider)}">${state.models
              .filter((m) => m.provider === provider)
              .map((m) => {
                const value = JSON.stringify({ provider: m.provider, id: m.id });
                return `<option value="${e(value)}" ${value === selectedValue ? "selected" : ""}>${e(m.name)} · ${e(m.id)}</option>`;
              })
              .join("")}</optgroup>`,
        )
        .join("")}
    </select><span id="model-selection-status" role="status">${e(message)}</span></div>`;
}
