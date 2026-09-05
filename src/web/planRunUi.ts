import type { ApiClient } from './apiClient.js';
import type { AppState } from './types.js';
import type { PlanRun } from '../planRun/planRun.js';
import type { PlanRunDetail } from '../application/planRunApi.js';
import { escapeHtml as e } from './render.js';

type Panel = { runs: PlanRun[]; selected: string; busy: boolean; message: string; note: string; baseline: string; reuse: string; instructions: string; request: number };
const labels: Record<string, string> = { stopped: '计划已终止', ready: '待启动', running: '运行中', paused: '已暂停', completed: '全部验收完成', pending: '等待依赖与调度', awaiting_acceptance: '等待人工验收', accepted: '已验收', failed: '执行失败，需人工恢复', unknown: '状态未知，需核对旧工作' };
const button = (action: string, label: string, disabled = false) => `<button type="button" class="btn btn-secondary" data-plan-run-action="${action}" ${disabled ? 'disabled' : ''}>${label}</button>`;
export function createPlanRunUi(container: HTMLElement, api: ApiClient, getState: () => AppState) {
  const panels = new Map<string, Panel>();
  let destroyed = false;
  const key = (project: string, plan: string) => `${project}/${plan}`;
  const base = (project: string) => `/api/projects/${encodeURIComponent(project)}/plan-runs`;
  function panel(project: string, plan: string): Panel {
    const id = key(project, plan);
    let value = panels.get(id);
    if (!value) { value = { runs: [], selected: '', busy: false, message: '', note: '', baseline: '', reuse: '', instructions: '', request: 0 }; panels.set(id, value); void load(project, plan, value); }
    return value;
  }
  async function load(project: string, plan: string, value: Panel) {
    if (!api.request || value.busy) return;
    const request = ++value.request;
    const result = await api.request<{ runs: PlanRun[] }>(`${base(project)}?plan_id=${encodeURIComponent(plan)}`);
    if (destroyed || request !== value.request) return;
    if (result.ok) { value.runs = result.data.runs; if (!value.selected) value.selected = value.runs[0]?.id ?? ''; }
    else value.message = `${result.error.code}: ${result.error.message}`;
    render();
  }
  function render() {
    const state = getState();
    if (destroyed || !api.request || !container.querySelectorAll || state.currentView !== 'plans' || !state.selectedProjectId) return;
    for (const card of container.querySelectorAll<HTMLElement>('[data-plan-id]')) {
      const plan = card.dataset.planId!, project = state.selectedProjectId;
      const value = panel(project, plan);
      let slot = card.querySelector<HTMLElement>('[data-plan-run-panel]');
      if (!slot) { slot = container.ownerDocument.createElement('section'); slot.dataset.planRunPanel = plan; slot.setAttribute('aria-label', `计划执行 ${plan}`); card.append(slot); }
      const focused = slot.contains(container.ownerDocument.activeElement) ? container.ownerDocument.activeElement as HTMLTextAreaElement : null;
      const field = focused?.dataset.planRunField, selection = focused ? [focused.selectionStart, focused.selectionEnd] : null;
      const opened = new Set([...slot.querySelectorAll<HTMLDetailsElement>('details[open]')].map(detail => detail.dataset.runDetails));
      const run = value.runs.find(entry => entry.id === value.selected);
      slot.innerHTML = `<h3>计划执行</h3><p>每次执行冻结计划与任务输入。串行任务逐个运行，前置任务经人工验收后才继续。</p>${button('refresh', '刷新计划执行', value.busy)}
        <details data-run-details="reuse"><summary>复用已验收任务</summary><p>如需复用已完成任务或外部依赖，逐行填写任务 ID、尝试 ID 和复用说明，以 Tab 分隔。</p><label>复用记录<textarea class="form-input" data-plan-run-field="reuse">${e(value.reuse)}</textarea></label></details>
        <label>本次计划工作指示<textarea class="form-input" data-plan-run-field="instructions">${e(value.instructions)}</textarea></label>${button('create', '创建串行执行', value.busy)}
        ${value.runs.length ? `<ul>${value.runs.map(entry => `<li><button type="button" class="btn btn-secondary" data-plan-run-id="${e(entry.id)}">${e(entry.id)} · ${e(labels[entry.state]??entry.state)}</button></li>`).join('')}</ul>` : '<p>尚无计划执行。</p>'}
        ${run ? `<article><h4>${e(run.plan_snapshot.title)} · ${e(labels[run.state]??run.state)}</h4><p>执行 ID：${e(run.id)} · 冻结计划 revision：${e(run.plan_revision)} · 并发容量：${run.capacity}</p>
          <details data-run-details="snapshot"><summary>查看本次冻结计划</summary><pre>${e(JSON.stringify(run.plan_snapshot, null, 2))}</pre></details>
          <ol>${run.nodes.map(node => `<li><a href="#/projects/${encodeURIComponent(project)}/backlog/${encodeURIComponent(node.item_id)}?plan=${encodeURIComponent(plan)}">${e(node.item_id)} — ${e(node.input.title)}</a><p>${e(labels[node.state]??node.state)} · 依赖：${e(node.depends_on.join(', ') || '无')}</p><p>尝试：${e(node.attempt_ids.join(', ') || '尚未启动')}</p>${node.reuse_note ? `<p>复用说明：${e(node.reuse_note)}</p>` : ''}</li>`).join('')}</ol>
          ${run.diagnostics.map(message => `<p role="alert">${e(message)}</p>`).join('')}
          ${run.state === 'ready' ? button('advance', '启动计划执行', value.busy) : ''}
          ${!['completed', 'stopped'].includes(run.state) ? `${button('pause', '暂停后续任务', value.busy || run.state === 'paused')}${button('stop-current', '停止当前任务', value.busy || !run.nodes.some(node => node.state === 'running'))}
          <label>恢复说明<textarea class="form-input" data-plan-run-field="note">${e(value.note)}</textarea></label><label>人工核对后的基线 digest（仅代码漂移时填写）<input class="form-input" data-plan-run-field="baseline" value="${e(value.baseline)}"></label>
          ${run.state === 'paused' ? `${button('resume', '确认恢复或重试失败任务', value.busy || !value.note.trim())}<p>先核对当前工作已结束；状态未知须进入任务页确认中断。恢复保留所有历史尝试。</p>` : ''}` : ''}
          ${!['completed', 'stopped'].includes(run.state) ? button('close-stopped', '终止计划执行', value.busy || !value.note.trim() || run.nodes.some(node => ['running', 'unknown'].includes(node.state))) : ''}<p>本次基线：<code>${e(run.baseline.digest)}</code></p>
          ${run.controls.length ? `<details data-run-details="controls"><summary>查看人工控制记录</summary><ul>${run.controls.map(control => `<li>${e(control.at)} · ${e(control.action)} · ${e(control.note)}</li>`).join('')}</ul></details>` : ''}</article>` : ''}
        ${value.message ? `<p role="alert">${e(value.message)}</p>` : ''}`;
      for (const detail of slot.querySelectorAll<HTMLDetailsElement>('details')) if (opened.has(detail.dataset.runDetails)) detail.open = true;
      if (field) { const target = slot.querySelector<HTMLTextAreaElement>(`[data-plan-run-field="${field}"]`); target?.focus({ preventScroll: true }); if (target && selection) target.setSelectionRange(selection[0]!, selection[1]!); }
    }
  }
  async function act(target: HTMLElement) {
    if (!api.request) return;
    const plan = target.closest<HTMLElement>('[data-plan-run-panel]')?.dataset.planRunPanel, project = getState().selectedProjectId;
    if (!plan || !project) return;
    const value = panel(project, plan);
    if (value.busy) return;
    if (target.dataset.planRunId) { value.selected = target.dataset.planRunId; render(); return; }
    const action = target.dataset.planRunAction!;
    if (action === 'refresh') { value.message = ''; await load(project, plan, value); return; }
    value.busy = true; value.request++; value.message = ''; render();
    let result;
    if (action === 'create') {
      const revision = await api.request<{ revision: string }>(`/api/projects/${encodeURIComponent(project)}/plans/${encodeURIComponent(plan)}`);
      if (!revision.ok) result = revision;
      else {
        const reuse = value.reuse.trim() ? value.reuse.trim().split('\n').map(line => { const [item_id, attempt_id, ...note] = line.split('\t'); return { item_id, attempt_id, note: note.join('\t') }; }) : undefined;
        result = await api.request<PlanRunDetail>(base(project), { plan_id: plan, expected_revision: revision.data.revision, instructions: value.instructions, ...(reuse ? { reuse } : {}) }, 'POST');
      }
    } else {
      const run = value.runs.find(entry => entry.id === value.selected);
      if (!run) { value.busy = false; render(); return; }
      result = await api.request<PlanRunDetail>(`${base(project)}/${encodeURIComponent(run.id)}/${action}`, { expected_revision: run.revision, ...(action === 'resume' ? { note: value.note, ...(value.baseline.trim() ? { baseline_digest: value.baseline.trim() } : {}) } : action === 'close-stopped' ? { note: value.note } : {}) }, 'POST');
    }
    if (destroyed) return;
    value.busy = false;
    if (result.ok) { const data = result.data as PlanRunDetail; value.selected = data.run.id; }
    else value.message = `${result.error.code}: ${result.error.message}`;
    await load(project, plan, value);
  }
  function onClick(event: Event) { const target = (event.target as HTMLElement)?.closest<HTMLElement>('[data-plan-run-action], [data-plan-run-id]'); if (target) { event.preventDefault(); void act(target); } }
  function onInput(event: Event) {
    const target = event.target as HTMLInputElement;
    const plan = target.closest<HTMLElement>('[data-plan-run-panel]')?.dataset.planRunPanel, project = getState().selectedProjectId;
    const field = target.dataset.planRunField;
    if (plan && project && (field === 'note' || field === 'baseline' || field === 'reuse' || field === 'instructions')) {
      const value = panel(project, plan); value[field] = target.value;
      const resume = target.closest('[data-plan-run-panel]')?.querySelector<HTMLButtonElement>('[data-plan-run-action="resume"]'); if (resume) resume.disabled = value.busy || !value.note.trim();
      const close = target.closest('[data-plan-run-panel]')?.querySelector<HTMLButtonElement>('[data-plan-run-action="close-stopped"]');
      const run = value.runs.find(entry => entry.id === value.selected);
      if (close) close.disabled = value.busy || !value.note.trim() || !!run?.nodes.some(node => ['running', 'unknown'].includes(node.state));
    }
  }
  container.addEventListener('click', onClick); container.addEventListener('input', onInput);
  const timer = api.request && typeof window !== 'undefined' ? setInterval(() => { const state = getState(); if (state.currentView !== 'plans' || !state.selectedProjectId) return; for (const card of container.querySelectorAll<HTMLElement>('[data-plan-id]')) { const plan = card.dataset.planId!; const value = panels.get(key(state.selectedProjectId, plan)); if (value && !value.busy && value.runs.some(run => !['completed', 'stopped'].includes(run.state))) void load(state.selectedProjectId, plan, value); } }, 2000) : undefined;
  return { render, destroy() { destroyed = true; clearInterval(timer); container.removeEventListener('click', onClick); container.removeEventListener('input', onInput); } };
}
