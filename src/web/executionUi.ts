import type { ApiClient } from "./apiClient.js";
import type { AppState } from "./types.js";
import type { ExecutionAttempt } from "../execution/attempt.js";
import type { AttemptDetail } from "../application/executionApi.js";
import { escapeHtml as e } from "./render.js";

const active = (attempt: ExecutionAttempt) =>
  ["running", "stop_requested", "unknown"].includes(attempt.state);
const labels: Record<string, string> = {
  running: "运行中",
  stop_requested: "已请求停止，等待确认",
  unknown: "运行状态待确认",
  succeeded: "执行成功（尚需验收）",
  failed: "执行失败",
  stopped: "已停止",
};
const button = (action: string, label: string, disabled = false) =>
  `<button type="button" class="btn btn-secondary" data-execution-action="${action}" ${disabled ? "disabled" : ""}>${label}</button>`;
export function createExecutionUi(
  container: HTMLElement,
  api: ApiClient,
  getState: () => AppState,
  updated: () => Promise<void>,
) {
  let key = "";
  let project = "";
  let item = "";
  let attempts: ExecutionAttempt[] = [];
  let selected: AttemptDetail | null = null;
  let busy = false;
  let message = "";
  let loading = false;
  let generation = 0;
  let requestId = 0;
  let destroyed = false;
  let note = "";
  let instructions = "";
  let steering = "";
  let evidenceView: { attemptId: string; ref: string; body: string; truncated: boolean } | null =
    null;
  let runnerAvailable = false;
  const path = () => `/api/projects/${encodeURIComponent(project)}/executions`;
  function currentKey() {
    const state = getState();
    return state.currentView === "backlog" && state.backlog.item && !state.backlog.detailLoading
      ? `${state.selectedProjectId}/${state.backlog.item.id}`
      : "";
  }
  function draw() {
    if (destroyed || !key || key !== currentKey()) return;
    const panel = container.querySelector('[aria-label="Backlog item detail"]');
    if (!panel) return;
    let slot = panel.querySelector<HTMLElement>("[data-execution-panel]");
    if (!slot) {
      slot = container.ownerDocument.createElement("section");
      slot.dataset.executionPanel = "";
      slot.setAttribute("aria-label", "任务执行");
      panel.append(slot);
    }
    const attempt = selected?.attempt;
    const last = attempt?.verifications.at(-1);
    const canAccept =
      attempt?.state === "succeeded" &&
      !attempt.acceptance &&
      last?.outcome === "passed" &&
      selected?.diagnostics.length === 0;
    const focused = slot.contains(container.ownerDocument.activeElement)
      ? (container.ownerDocument.activeElement as HTMLTextAreaElement)
      : null;
    const focusField = focused?.dataset.executionField;
    const selection = focused ? [focused.selectionStart, focused.selectionEnd] : null;
    const opened = new Set(
      [...slot.querySelectorAll<HTMLDetailsElement>("details[open]")].map(
        (d) => d.dataset.executionDetails,
      ),
    );
    slot.innerHTML = `<h3>任务执行</h3><p>执行与浏览器连接无关。重新连接时重读完整记录；当前输入采用任务的最新版本，历史尝试保持原始输入。</p>${button("refresh", "刷新执行记录", busy)}
      ${attempts.length ? `<ul>${attempts.map((a) => `<li><button type="button" class="btn btn-secondary" data-execution-id="${e(a.id)}" ${busy ? "disabled" : ""}>${e(a.id)} · ${e(labels[a.state] ?? a.state)}</button></li>`).join("")}</ul>` : `<p>${loading ? "读取执行记录…" : "尚无执行记录。点击开始工作创建一次执行尝试。"}</p>`}
      <label>本次工作指示<textarea class="form-input" data-execution-field="instructions" rows="3" ${busy ? "disabled" : ""}>${e(instructions)}</textarea></label>
      ${attempts.length === 0 ? button("start", "开始工作", busy || loading || !runnerAvailable) : ""}
      ${
        attempt
          ? `<article><h4>尝试 ${e(attempt.id)}</h4><p role="status">${e(labels[attempt.state] ?? attempt.state)}</p><dl><dt>执行 ID</dt><dd>${e(attempt.execution_id)}</dd><dt>前次尝试</dt><dd>${e(attempt.retry_of ?? "无")}</dd><dt>开始 / 结束</dt><dd>${e(attempt.started_at)} / ${e(attempt.ended_at ?? "尚未结束")}</dd><dt>任务输入 revision</dt><dd>${e(attempt.input.item.revision)}</dd></dl>
      <details data-execution-details="input"><summary>查看冻结输入</summary><h5>${e(attempt.input.item.title)}</h5><pre>${e(attempt.input.item.body)}</pre><p>${e(attempt.input.instructions)}</p></details>
      <h4>工作进展</h4>${attempt.progress?.session_id ? `<p>Pi session：<code>${e(attempt.progress.session_id)}</code></p>` : ""}
      ${attempt.input.model ? `<p>启动模型：${e(attempt.input.model.provider)}/${e(attempt.input.model.id)}</p>` : ""}
      ${attempt.progress?.model ? `<p>实际模型：${e(attempt.progress.model.provider)}/${e(attempt.progress.model.id)}</p>` : ""}
      ${attempt.progress?.events.length ? `<ol aria-label="工作进展记录">${attempt.progress.events.map((event) => `<li><span>${e(event.at)} · ${e(({ text: "文本", tool: "工具", status: "状态", instruction: "追加指示", session: "会话" } as Record<string, string>)[event.type] ?? event.type)}</span><pre>${e(event.text)}</pre></li>`).join("")}</ol>` : "<p>等待工作进展。</p>"}
      ${attempt.state === "running" ? `<label>追加工作指示<textarea class="form-input" data-execution-field="steering" rows="3" ${busy ? "disabled" : ""}>${e(steering)}</textarea></label>${button("steer", "发送追加指示", busy || !steering.trim())}` : ""}
      <h4>改动摘要</h4><p>${e(attempt.summary || "尚未记录")}</p>${attempt.snapshot ? `<p>Git HEAD: <code>${e(attempt.snapshot.head)}</code> · 快照 <code>${e(attempt.snapshot.digest)}</code></p><details data-execution-details="diff"><summary>查看 diff 与文件</summary><pre>${e(attempt.snapshot.diff || "无已跟踪文件 diff")}</pre><ul>${attempt.snapshot.files.map((file) => `<li>${e(file)}</li>`).join("")}</ul></details>` : "<p>尚无代码快照。</p>"}
      <h4>验证结果</h4>${attempt.verifications.length ? `<ul>${attempt.verifications.map((v) => `<li><strong>${selected!.diagnostics.some((d) => d.includes(v.evidence_ref)) ? "证据不可读 · 记录结果：" : ""}${v.outcome === "passed" ? "通过" : "失败"}</strong> · <code>${e(v.command)}</code><p>${e(v.at)} · 证据引用：<code>${e(v.evidence_ref)}</code></p><p>验证快照：<code>${e(v.snapshot.digest)}</code></p><button type="button" class="btn btn-secondary" data-execution-evidence="${e(v.evidence_ref)}" ${busy ? "disabled" : ""}>查看验证证据正文</button>${evidenceView?.attemptId === attempt.id && evidenceView.ref === v.evidence_ref ? (selected!.diagnostics.some((d) => d.includes(v.evidence_ref)) ? '<p role="alert">证据不可读，请重新核对证据文件。</p>' : `<pre aria-label="验证证据正文">${e(evidenceView.body)}</pre>${evidenceView.truncated ? "<p>证据预览已截断，仅显示前 65,536 个字符。</p>" : ""}`) : ""}</li>`).join("")}</ul>` : "<p>未运行验证</p>"}
      ${selected!.diagnostics.map((d) => `<p role="alert">证据不可读：${e(d)}</p>`).join("")}
      <label>验收或状态核对说明<textarea class="form-input" rows="3" data-execution-field="note" ${busy ? "disabled" : ""}>${e(note)}</textarea></label>
      ${attempt.acceptance ? `<p>验收结论：${attempt.acceptance.decision === "accepted" ? "已接受" : "要求继续修改"} · ${e(attempt.acceptance.at)}</p><p>${e(attempt.acceptance.note)}</p>` : ""}
      ${attempt.state === "running" ? button("stop", "请求停止", busy) : ""}
      ${attempt.state === "unknown" ? `<p>请先人工核对旧进程已停止，再确认中断；不会自动重放工作。</p>${button("confirm-interrupted", "已核对停止，确认中断", busy || !note.trim())}` : ""}
      ${!active(attempt) && !attempt.acceptance ? `${button("accept", "接受本次结果", busy || !canAccept)} ${button("rework", "要求继续修改", busy)}<p>接受前服务端会检查任务输入与代码是否仍匹配验证快照。</p>` : ""}
      ${!active(attempt) && attempt.acceptance?.decision !== "accepted" && !attempts.some((a) => a.retry_of === attempt.id) ? `${button("retry", "用当前任务版本重试", busy || !runnerAvailable)}<p>重试创建新的尝试，采用当前任务 revision ${e(getState().backlog.item!.revision)}；旧尝试及验收结论保留。</p>` : ""}</article>`
          : ""
      }
      ${!runnerAvailable ? "<p>启动不可用：服务端尚未配置 runner。</p>" : ""}${message ? `<p role="alert">${e(message)}</p>` : ""}`;
    for (const detail of slot.querySelectorAll<HTMLDetailsElement>("details"))
      if (opened.has(detail.dataset.executionDetails)) detail.open = true;
    if (focusField) {
      const field = slot.querySelector<HTMLTextAreaElement>(
        `[data-execution-field="${focusField}"]`,
      );
      field?.focus({ preventScroll: true });
      if (field && selection) field.setSelectionRange(selection[0]!, selection[1]!);
    }
  }
  async function load(id?: string) {
    if (!api.request || !key || busy) return;
    const run = generation;
    const request = ++requestId;
    const base = path();
    const targetItem = item;
    loading = true;
    const result = await api.request<{ attempts: ExecutionAttempt[]; runner_available: boolean }>(
      `${base}?item_id=${encodeURIComponent(targetItem)}`,
    );
    if (destroyed || run !== generation || request !== requestId) return;
    loading = false;
    if (!result.ok) {
      message = `${result.error.code}: ${result.error.message}`;
      draw();
      return;
    }
    attempts = result.data.attempts;
    runnerAvailable = result.data.runner_available;
    const chosen = id ?? selected?.attempt.id ?? attempts.at(-1)?.id;
    if (chosen) {
      const detail = await api.request<AttemptDetail>(`${base}/${encodeURIComponent(chosen)}`);
      if (destroyed || run !== generation || request !== requestId) return;
      if (detail.ok) selected = detail.data;
      else message = `${detail.error.code}: ${detail.error.message}`;
    } else selected = null;
    draw();
  }
  function render() {
    if (destroyed || !api.request || !container.querySelector) return;
    const next = currentKey();
    if (next !== key) {
      generation++;
      requestId++;
      key = next;
      attempts = [];
      selected = null;
      message = "";
      busy = false;
      note = "";
      instructions = "";
      steering = "";
      evidenceView = null;
      loading = !!next;
      if (next) {
        project = getState().selectedProjectId!;
        item = getState().backlog.item!.id;
        void load();
      }
    }
    draw();
  }
  async function act(action: string) {
    if (!api.request || busy || !key) return;
    if (action === "refresh") {
      message = "";
      await load();
      return;
    }
    const a = selected?.attempt;
    const run = generation;
    const base = path();
    const starting = action === "start" || action === "retry";
    if (!starting && !a) return;
    busy = true;
    message = "";
    requestId++;
    draw();
    const endpoint = starting
      ? `${base}/start`
      : `${base}/${encodeURIComponent(a!.id)}/${action === "accept" || action === "rework" ? "decide" : action}`;
    const body = starting
      ? {
          model: getState().modelSelection.selected,
          item_id: item,
          instructions,
          expected_revision: getState().backlog.item!.revision,
          ...(action === "retry" ? { retry_of: a!.id } : {}),
        }
      : {
          expected_revision: a!.revision,
          ...(action === "stop" ? {} : action === "steer" ? { message: steering } : { note }),
          ...(action === "accept" || action === "rework"
            ? { decision: action === "accept" ? "accepted" : "rework" }
            : {}),
        };
    const result = await api.request<AttemptDetail>(endpoint, body, "POST");
    if (destroyed || run !== generation) return;
    busy = false;
    if (result.ok) {
      if (action === "steer") steering = "";
      selected = result.data;
      message =
        action === "accept"
          ? "已验收，任务完成。"
          : action === "rework"
            ? "已记录继续修改要求。"
            : "操作已记录。";
    } else message = `${result.error.code}: ${result.error.message}`;
    await load(result.ok ? result.data.attempt.id : undefined);
    draw();
    if (result.ok && action === "accept" && run === generation) await updated();
  }
  async function readEvidence(ref: string) {
    if (!api.request || busy || !selected) return;
    const run = generation;
    const attemptId = selected.attempt.id;
    const result = await api.request<{ ref: string; body: string; truncated: boolean }>(
      `${path()}/${encodeURIComponent(attemptId)}/evidence?ref=${encodeURIComponent(ref)}`,
    );
    if (destroyed || run !== generation || selected?.attempt.id !== attemptId) return;
    if (result.ok) {
      evidenceView = { attemptId, ...result.data };
      message = "";
    } else {
      evidenceView = null;
      message = `证据不可读：${result.error.code}: ${result.error.message}`;
    }
    draw();
  }
  function onClick(event: Event) {
    const target = (event.target as HTMLElement)?.closest<HTMLElement>(
      "[data-execution-action], [data-execution-id], [data-execution-evidence]",
    );
    if (!target) return;
    event.preventDefault();
    if (target.dataset.executionEvidence) {
      void readEvidence(target.dataset.executionEvidence);
    } else if (target.dataset.executionId) {
      note = "";
      void load(target.dataset.executionId);
    } else void act(target.dataset.executionAction!);
  }
  function onInput(event: Event) {
    const target = event.target as HTMLTextAreaElement;
    if (target.dataset.executionField === "note") {
      note = target.value;
      const confirm = container.querySelector<HTMLButtonElement>(
        '[data-execution-action="confirm-interrupted"]',
      );
      if (confirm) confirm.disabled = busy || !note.trim();
    }
    if (target.dataset.executionField === "instructions") instructions = target.value;
    if (target.dataset.executionField === "steering") {
      steering = target.value;
      const send = container.querySelector<HTMLButtonElement>('[data-execution-action="steer"]');
      if (send) send.disabled = busy || !steering.trim();
    }
  }
  container.addEventListener("click", onClick);
  container.addEventListener("input", onInput);
  const timer =
    api.request && typeof window !== "undefined"
      ? setInterval(() => {
          if (key && !busy && attempts.some(active)) void load();
        }, 3000)
      : undefined;
  return {
    render,
    destroy() {
      destroyed = true;
      generation++;
      clearInterval(timer);
      container.removeEventListener("click", onClick);
      container.removeEventListener("input", onInput);
    },
  };
}
