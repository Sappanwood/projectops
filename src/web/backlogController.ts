import type { BacklogItem } from "../backlog/item.js";
import type { BacklogItemSummary } from "../application/backlogApi.js";
import type { ApiClient } from "./apiClient.js";
import type { AppError } from "./types.js";

export type BacklogViewState = {
  projectId: string | null;
  items: BacklogItemSummary[];
  selectedItemId: string | null;
  item: BacklogItem | null;
  loading: boolean;
  detailLoading: boolean;
  saving: boolean;
  error: AppError | null;
  detailError: AppError | null;
  message: string | null;
};

export function emptyBacklogState(): BacklogViewState {
  return { projectId: null, items: [], selectedItemId: null, item: null, loading: false,
    detailLoading: false, saving: false, error: null, detailError: null, message: null };
}

export function createBacklogController(
  api: ApiClient,
  onChange: (state: BacklogViewState) => void,
  onUpdated: (projectId: string) => Promise<void>,
) {
  let state = emptyBacklogState();
  let generation = 0;
  let detailRequest = 0;
  let listRequest = 0;
  let destroyed = false;
  function publish(patch: Partial<BacklogViewState>) {
    if (destroyed) return;
    state = { ...state, ...patch };
    onChange(state);
  }
  function reset() {
    generation++;
    detailRequest++;
    listRequest++;
    state = emptyBacklogState();
    onChange(state);
  }
  async function load(projectId: string) {
    if (state.projectId !== projectId) reset();
    const current = generation;
    const request = ++listRequest;
    publish({ projectId, loading: true, error: null });
    const result = await api.listBacklog(projectId);
    if (destroyed || current !== generation || request !== listRequest) return;
    if (!result.ok) {
      publish({ loading: false, items: [], error: result.error });
      return;
    }
    publish({ loading: false, items: result.data.items });
    if (state.selectedItemId !== null && !state.saving) await select(state.selectedItemId);
  }
  async function select(itemId: string) {
    const projectId = state.projectId;
    if (projectId === null || state.saving) return;
    const current = generation;
    const request = ++detailRequest;
    publish({ selectedItemId: itemId, detailLoading: true, detailError: null, message: null,
      item: state.item?.id === itemId ? state.item : null });
    const result = await api.showBacklog(projectId, itemId);
    if (destroyed || current !== generation || request !== detailRequest) return;
    publish(result.ok
      ? { item: result.data.item, detailLoading: false }
      : { item: null, detailLoading: false, detailError: result.error });
  }
  async function update(status: string) {
    if (state.saving || state.detailLoading || state.item === null || state.projectId === null) return;
    const current = generation;
    const projectId = state.projectId;
    const item = state.item;
    publish({ saving: true, detailError: null, message: null });
    const result = await api.updateBacklog(projectId, item.id, status, item.revision);
    if (destroyed || current !== generation) return;
    if (!result.ok) {
      publish({ saving: false, detailError: result.error });
      return;
    }
    publish({ saving: false, item: result.data.result });
    await load(projectId);
    if (destroyed || current !== generation) return;
    await onUpdated(projectId);
    if (destroyed || current !== generation) return;
    publish({ message: result.data.no_op ? "No changes." : "Status updated." });
  }
  return { getState: () => state, load, select, update, reset,
    destroy() { destroyed = true; generation++; } };
}
