import type { ApiClient } from './apiClient.js';
import type { AppState } from './types.js';
import { escapeHtml as e } from './render.js';

type Editor = { title: string; body: string; revision: string; open: boolean; busy: boolean; message: string };
type Preview = { applied: boolean; revision: string; confirmation_token: string | null; changes: unknown[]; affected_items: unknown[] };
type PlanEditor = { body: string; revision: string; busy: boolean; message: string; preview: Preview | null };
const button = (action: string, label: string, disabled = false) => `<button type="button" class="btn btn-secondary" data-foundation-action="${action}" ${disabled ? 'disabled' : ''}>${label}</button>`;
const notice = (message: string) => message ? `<p role="status" class="reading-notice">${e(message)}</p>` : '';

export function createFoundationUi(container: HTMLElement, api: ApiClient, getState: () => AppState, updated: () => Promise<void>) {
  const tasks = new Map<string, Editor>();
  const plans = new Map<string, PlanEditor>();
  let destroyed = false;
  const taskKey = () => `${getState().selectedProjectId}/${getState().backlog.item?.id}`;
  const projectPath = () => `/api/projects/${encodeURIComponent(getState().selectedProjectId!)}`;
  function render() {
    if (destroyed || !api.request || !container.querySelector) return;
    const state = getState();
    if (state.currentView === 'backlog' && state.backlog.item && !state.backlog.detailLoading) {
      const panel = container.querySelector('[aria-label="Backlog item detail"]');
      if (panel) {
        let slot = panel.querySelector<HTMLElement>('[data-foundation-editor]');
        if (!slot) { slot = container.ownerDocument.createElement('section'); slot.dataset.foundationEditor = ''; panel.append(slot); }
        const editor = tasks.get(taskKey());
        slot.innerHTML = `<h3>任务内容</h3>${editor?.open ? `<label>任务标题<input class="form-input" data-task-field="title" value="${e(editor.title)}" ${editor.busy ? 'disabled' : ''}></label><label>正文与验收要求<textarea class="form-input" rows="12" data-task-field="body" ${editor.busy ? 'disabled' : ''}>${e(editor.body)}</textarea></label><p>本次编辑基于 revision <code>${e(editor.revision)}</code>。历史执行输入保持不变。</p>${button('save-task', '保存任务内容', editor.busy)} ${button('reload-task', '重读版本并保留草稿', editor.busy)} ${button('close-task', '收起编辑', editor.busy)}${notice(editor.message)}` : button('edit-task','编辑任务内容')}`;
      }
    }
    if (state.currentView === 'plans') for (const card of container.querySelectorAll<HTMLElement>('[data-plan-id]')) {
      const id = card.dataset.planId!;
      let slot = card.querySelector<HTMLElement>('[data-foundation-plan]');
      if (!slot) { slot = container.ownerDocument.createElement('section'); slot.dataset.foundationPlan = id; card.append(slot); }
      const editor = plans.get(`${state.selectedProjectId}/${id}`);
      slot.innerHTML = `<h3>计划修订</h3>${editor ? `<label>计划 JSON 草案<textarea class="form-input" rows="16" data-plan-draft="${e(id)}" ${editor.busy ? 'disabled' : ''}>${e(editor.body)}</textarea></label><p>修改后先预览差异，再确认应用。已开始的任务受保护。</p>${button('preview-plan','预览修订',editor.busy)} ${button('reload-plan','重读版本并保留计划草案',editor.busy)}${editor.preview ? `<h4>修订差异与受影响任务</h4><pre>${e(JSON.stringify({ changes: editor.preview.changes, affected_items: editor.preview.affected_items },null,2))}</pre>${button('confirm-plan','确认应用修订',editor.busy || !editor.preview.confirmation_token)}` : ''}${notice(editor.message)}` : button('edit-plan','修订计划')}`;
    }
  }
  async function action(target: HTMLElement) {
    if (!api.request) return;
    const action = target.dataset.foundationAction;
    const planSlot = target.closest<HTMLElement>('[data-foundation-plan]');
    if (planSlot) {
      const id = planSlot.dataset.foundationPlan!;
      const key = `${getState().selectedProjectId}/${id}`;
      const path = `${projectPath()}/plans/${encodeURIComponent(id)}`;
      if (action === 'edit-plan' || action === 'reload-plan') {
        const existing = plans.get(key);
        if (existing?.busy) return;
        const editor = existing ?? {body:'',revision:'',busy:true,message:'读取计划…',preview:null};
        editor.busy = true; plans.set(key,editor); render();
        const result = await api.request<{plan:unknown;revision:string}>(path);
        editor.busy = false;
        if (result.ok) { editor.revision=result.data.revision; if (!existing) editor.body=JSON.stringify(result.data.plan,null,2); editor.preview=null; editor.message=existing ? '已读取最新版本。请核对草案后重新预览。' : ''; }
        else editor.message=`${result.error.code}: ${result.error.message}`;
        render(); return;
      }
      const editor = plans.get(key);
      if (!editor || editor.busy) return;
      let draft: unknown;
      try { draft = JSON.parse(editor.body); } catch { editor.message='JSON 无法解析，请修正后重试。'; render(); return; }
      const confirm = action === 'confirm-plan' ? editor.preview?.confirmation_token : undefined;
      if (action === 'confirm-plan' && !confirm) return;
      editor.busy=true; editor.message=''; render();
      const result = await api.request<Preview>(`${path}/revision`,{draft,expected_revision:editor.revision,...(confirm ? {confirm} : {})},'POST');
      editor.busy=false;
      if (result.ok) { editor.preview=result.data.applied ? null : result.data; editor.revision=result.data.revision; editor.message=result.data.applied ? '计划修订已保存' : '请检查差异与受影响任务，然后确认。'; }
      else { editor.preview=null; editor.message=`${result.error.code}: ${result.error.message}`; }
      render();
      if (result.ok && result.data.applied && key === `${getState().selectedProjectId}/${id}`) await updated();
      return;
    }
    const item = getState().backlog.item;
    if (!item) return;
    const key = taskKey();
    const path = `${projectPath()}/backlog/${encodeURIComponent(item.id)}`;
    if (action === 'edit-task') { const prior=tasks.get(key); tasks.set(key,prior ? {...prior,open:true} : {title:item.title,body:item.body,revision:item.revision,open:true,busy:false,message:''}); render(); return; }
    const editor = tasks.get(key);
    if (!editor || editor.busy) return;
    if (action === 'close-task') { editor.open=false; render(); return; }
    editor.busy=true; editor.message=''; render();
    if (action === 'reload-task') {
      const result = await api.request<{item:{revision:string}}>(path);
      editor.busy=false;
      if (result.ok) { editor.revision=result.data.item.revision; editor.message='已读取最新版本，草稿已保留。请核对后保存。'; }
      else editor.message=`${result.error.code}: ${result.error.message}`;
      render(); return;
    }
    const result = await api.request<{result:{revision:string}}>(path,{title:editor.title,body:editor.body,expected_revision:editor.revision});
    editor.busy=false;
    if (result.ok) { editor.revision=result.data.result.revision; editor.message='任务内容已保存'; }
    else editor.message=`${result.error.code}: ${result.error.message}`;
    render();
    if (result.ok && key === taskKey()) await updated();
  }
  function onClick(event: Event) { const target=(event.target as HTMLElement)?.closest<HTMLElement>('[data-foundation-action]'); if (target) { event.preventDefault(); void action(target); } }
  function onInput(event: Event) {
    const target=event.target as HTMLInputElement | HTMLTextAreaElement;
    const field=target.dataset.taskField;
    if (field === 'title' || field === 'body') { const editor=tasks.get(taskKey()); if (editor) editor[field]=target.value; }
    if (target.dataset.planDraft) { const editor=plans.get(`${getState().selectedProjectId}/${target.dataset.planDraft}`); if (editor) { editor.body=target.value; editor.preview=null; target.closest('[data-foundation-plan]')?.querySelector('[data-foundation-action="confirm-plan"]')?.setAttribute('disabled',''); } }
  }
  container.addEventListener('click',onClick);
  container.addEventListener('input',onInput);
  return { render, destroy() { destroyed=true; container.removeEventListener('click',onClick); container.removeEventListener('input',onInput); } };
}
