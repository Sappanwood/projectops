import type { WebDevSnapshot } from "../server/devRoutes.js";
import type { ApiClient } from "./apiClient.js";
import type { AppState } from "./types.js";
import { escapeHtml as e } from "./render.js";

export type DevView = {
  data: WebDevSnapshot | null;
  loading: boolean;
  busy: boolean;
  error: string;
};
export function renderDevServices(view: DevView): string {
  const { data, loading, busy, error } = view;
  const status = data?.status;
  const unavailable =
    busy ||
    loading ||
    !data?.configured ||
    !!error ||
    !status ||
    status.state === "unknown" ||
    status.state === "starting" ||
    status.state === "stopping";
  const button = (action: string, label: string, disabled: boolean) =>
    `<button type="button" id="dev-${action}" class="btn ${action === "start" ? "btn-primary" : "btn-secondary"}" data-dev-action="${action}" ${disabled ? "disabled" : ""}>${label}</button>`;
  return `<section class="overview-card dev-services" aria-label="开发服务" aria-busy="${busy || loading}">
    <h3>开发服务</h3>
    <p role="status">${busy ? "正在执行操作…" : loading ? "正在查询服务…" : !data ? "服务状态不可用" : !data.configured ? "未配置开发服务，请通过 CLI 登记。" : `项目：${e(status!.state)} · manager：${status!.manager === "stopped" ? "未运行" : e(status!.manager)}`}</p>
    ${error ? `<p role="alert">连接或操作失败：${e(error)}。请查询状态后再操作。</p>` : ""}
    <div class="dev-actions">${button("status", "查询状态", busy || loading)}${button("start", "启动", unavailable || status?.state === "running")}${button("restart", "重启", unavailable || !!data?.hosts_workbench)}${button("stop", "停止", unavailable || !!data?.hosts_workbench || status?.state === "stopped")}</div>
    ${data?.hosts_workbench ? `<p class="form-help">此项目承载当前 Workbench，停止或重启请使用 CLI：<code>pops dev stop/restart ${e(status!.project)}</code>。</p>` : ""}
    ${status?.state === "unknown" ? '<p role="alert">进程归属未知，禁止盲目重启。请展开诊断并使用 CLI 核实旧进程。</p>' : ""}
    ${status?.endpoints.length ? `<ul class="dev-endpoints">${status.endpoints.map((p) => `<li><strong>${e(p.endpoint)}</strong> <code>${e(p.origin)}</code>${status.state === "running" ? ` <a id="dev-open-${e(p.endpoint)}" class="btn btn-secondary" href="${e(p.origin)}" target="_blank" rel="noopener noreferrer">打开成果 · ${e(p.endpoint)}</a>` : ""}</li>`).join("")}</ul>` : ""}
    ${status?.processes.length ? `<ul>${status.processes.map((p) => `<li>${e(p.name)}：${e(p.state)}</li>`).join("")}</ul>` : ""}
    ${
      status?.issue || data?.problems.length || status?.processes.some((p) => p.log)
        ? `<details data-dev-diagnostics><summary id="dev-diagnostics">展开服务诊断</summary>${status?.issue ? `<p>${e(status.issue)}</p>` : ""}${data?.problems.map((p) => `<p>${e(p)}</p>`).join("") ?? ""}${
            status?.processes
              .filter((p) => p.log)
              .map((p) => `<h4>${e(p.name)}</h4><pre data-dev-log="${e(p.name)}">${e(p.log)}</pre>`)
              .join("") ?? ""
          }</details>`
        : ""
    }
  </section>`;
}

export function createDevUi(container: HTMLElement, api: ApiClient, getState: () => AppState) {
  let project: string | null = null;
  let generation = 0;
  let destroyed = false;
  let pending = false;
  let view: DevView = { data: null, loading: false, busy: false, error: "" };
  let diagnosticsOpen = false;
  const logPositions = new Map<string, { top: number; left: number }>();
  function saveReading() {
    const host = container.querySelector?.<HTMLElement>("[data-dev-host]");
    const details = host?.querySelector<HTMLDetailsElement>("[data-dev-diagnostics]");
    if (details) diagnosticsOpen = details.open;
    for (const log of host?.querySelectorAll<HTMLElement>("[data-dev-log]") ?? []) {
      logPositions.set(log.dataset.devLog!, { top: log.scrollTop, left: log.scrollLeft });
    }
  }
  function paint() {
    const host = container.querySelector?.<HTMLElement>("[data-dev-host]");
    if (!host) return;
    const focused = host.contains(host.ownerDocument.activeElement)
      ? host.ownerDocument.activeElement?.id
      : undefined;
    saveReading();
    const html = renderDevServices(view);
    if (host.innerHTML === html) return;
    host.innerHTML = html;
    const next = host.querySelector<HTMLDetailsElement>("[data-dev-diagnostics]");
    if (next) next.open = diagnosticsOpen;
    for (const log of host.querySelectorAll<HTMLElement>("[data-dev-log]")) {
      const position = logPositions.get(log.dataset.devLog!);
      if (position) {
        log.scrollTop = position.top;
        log.scrollLeft = position.left;
      }
    }
    if (focused) host.querySelector<HTMLElement>(`#${focused}`)?.focus({ preventScroll: true });
  }
  async function request(action: "status" | "start" | "stop" | "restart" = "status") {
    if (!project || !api.request || pending) return;
    pending = true;
    const id = project;
    const current = generation;
    view = {
      ...view,
      loading: action === "status" && view.data === null,
      busy: action !== "status",
    };
    paint();
    const result = await api.request<WebDevSnapshot>(
      `/api/projects/${encodeURIComponent(id)}/dev`,
      action === "status" ? undefined : { action },
      action === "status" ? "GET" : "POST",
    );
    if (destroyed || current !== generation || id !== project) return;
    pending = false;
    view = {
      data: result.ok ? result.data : view.data,
      loading: false,
      busy: false,
      error: result.ok ? "" : result.error.message,
    };
    paint();
  }
  function render() {
    const state = getState();
    const selected = state.currentView === "overview" ? state.selectedProjectId : null;
    if (selected !== project) {
      project = selected;
      generation++;
      pending = false;
      diagnosticsOpen = false;
      logPositions.clear();
      view = { data: null, loading: false, busy: false, error: "" };
      if (project) void request();
    }
    paint();
  }
  const click = (event: Event) => {
    const target = (event.target as HTMLElement).closest?.<HTMLButtonElement>("[data-dev-action]");
    if (!target || target.disabled) return;
    const action = target.dataset.devAction;
    if (action === "status" || action === "start" || action === "stop" || action === "restart")
      void request(action);
  };
  container.addEventListener("click", click);
  const timer = setInterval(() => {
    if (project && !container.ownerDocument?.hidden) void request();
  }, 2000);
  timer.unref?.();
  return {
    render,
    saveReading,
    destroy() {
      destroyed = true;
      generation++;
      clearInterval(timer);
      container.removeEventListener("click", click);
    },
  };
}
