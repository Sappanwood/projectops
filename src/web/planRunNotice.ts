import { escapeHtml as e } from "./render.js";
import { formatRoute } from "./router.js";
import type { RouteState } from "./types.js";

export function renderRunNotice(
  host: HTMLElement | null,
  label: string,
  runs: { state: string; nodes: { state: string }[] }[],
  route: RouteState,
  loaded: boolean,
  message: string,
) {
  if (!host) return;
  const active = runs.filter((run) => !["completed", "stopped"].includes(run.state));
  const issues = active
    .flatMap((run) => run.nodes)
    .filter((node) => ["failed", "unknown"].includes(node.state));
  const text = message
    ? `${label}读取或操作提示：${message}`
    : !loaded
      ? `正在读取${label}状态…`
      : active.length
        ? `${label}：${active.length} 个未结束运行${issues.length ? ` · ${issues.length} 项失败或状态未知，需处理` : ""}`
        : "";
  const html = text
    ? `<p>${e(text)} <a href="${e(formatRoute({ ...route, planTab: "execution" }))}">查看${label}</a></p>`
    : "";
  if (host.innerHTML !== html) host.innerHTML = html;
}
