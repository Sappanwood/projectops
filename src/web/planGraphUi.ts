import type { ApiClient } from "./apiClient.js";
import { mappingTarget } from "./planIdentityView.js";

export function createPlanGraphUi(container: HTMLElement, api: ApiClient) {
  let active: HTMLElement | null = null;
  let activeTitle = "";
  let generation = 0;
  let destroyed = false;
  const attempted = new WeakSet<HTMLElement>();
  const pending = new WeakMap<HTMLElement, ReturnType<ApiClient["showBacklog"]>>();
  function readTitle(node: HTMLElement) {
    const existing = pending.get(node);
    if (existing) return existing;
    attempted.add(node);
    const title = node.querySelector(".plan-graph-title");
    if (title) title.textContent = "正在读取…";
    const target = mappingTarget("", node.dataset.graphReference!);
    const request = api.showBacklog(target.project, target.id).then((result) => {
      pending.delete(node);
      if (destroyed || !node.isConnected) return result;
      if (title) title.textContent = result.ok ? result.data.item.title : "标题暂不可用";
      if (result.ok) {
        node.dataset.graphTitle = result.data.item.title;
        node.setAttribute(
          "aria-label",
          `${node.querySelector(".plan-graph-identity")?.textContent} — ${result.data.item.title}`,
        );
      }
      return result;
    });
    pending.set(node, request);
    return request;
  }
  function highlight(node: HTMLElement | null) {
    const graph = (node ?? active)?.closest(".plan-graph");
    if (!graph) return;
    const related = new Set([node?.dataset.graphNode]);
    for (const edge of graph.querySelectorAll<SVGElement>(".plan-graph-connection")) {
      const connected =
        !!node &&
        (edge.dataset.graphFrom === node.dataset.graphNode ||
          edge.dataset.graphTo === node.dataset.graphNode);
      if (connected) {
        related.add(edge.dataset.graphFrom);
        related.add(edge.dataset.graphTo);
      }
      edge.classList.toggle("is-emphasized", connected);
      edge.classList.toggle("is-muted", !!node && !connected);
    }
    for (const entry of graph.querySelectorAll<HTMLElement>("[data-graph-node]")) {
      entry.classList.toggle("is-current", entry === node);
      entry.classList.toggle("is-muted", !!node && !related.has(entry.dataset.graphNode));
    }
  }
  function hide() {
    generation++;
    highlight(null);
    active = null;
    const tooltip = container.querySelector?.<HTMLElement>(".plan-graph-tooltip");
    if (tooltip) tooltip.hidden = true;
  }
  function display(node: HTMLElement, title: string) {
    const tooltip = node.closest(".plan-graph")?.querySelector<HTMLElement>("[role=tooltip]");
    if (!tooltip || !node.isConnected) return;
    activeTitle = title;
    tooltip.textContent = `${node.querySelector(".plan-graph-identity")?.textContent} — ${title}`;
    tooltip.hidden = false;
    const rect = node.getBoundingClientRect();
    const size = tooltip.getBoundingClientRect();
    tooltip.style.left = `${Math.max(16, Math.min(rect.left, innerWidth - size.width - 16))}px`;
    tooltip.style.top = `${Math.max(16, rect.bottom + size.height + 12 < innerHeight ? rect.bottom + 8 : rect.top - size.height - 8)}px`;
  }
  async function show(event: Event) {
    const node = (event.target as HTMLElement).closest<HTMLElement>("[data-graph-node]");
    if (!node || node === active) return;
    highlight(null);
    active = node;
    highlight(node);
    const request = ++generation;
    if (node.dataset.graphTitle) {
      display(node, node.dataset.graphTitle);
      return;
    }
    display(node, "正在读取标题…");
    const result = await readTitle(node);
    if (request !== generation || !node.isConnected) return;
    display(
      node,
      result.ok ? result.data.item.title : "标题读取失败；重新悬停或聚焦可重试，点击仍可打开任务。",
    );
  }
  function leave(event: Event) {
    const node = (event.target as HTMLElement).closest("[data-graph-node]");
    const next = (event as FocusEvent | PointerEvent).relatedTarget;
    if (!node || (next instanceof Node && node.contains(next))) return;
    if (event.type === "pointerout" && node === container.ownerDocument.activeElement) return;
    hide();
  }
  function onKey(event: KeyboardEvent) {
    if (event.key === "Escape") hide();
  }
  function onScroll() {
    if (
      active?.isConnected &&
      (active === container.ownerDocument.activeElement || active.matches(":hover"))
    )
      display(active, activeTitle);
    else hide();
  }
  function onResize() {
    if (active?.isConnected && active === container.ownerDocument.activeElement) {
      active.scrollIntoView({ block: "nearest", inline: "nearest" });
      display(active, activeTitle);
    } else hide();
  }
  container.addEventListener("pointerover", show);
  container.addEventListener("focusin", show);
  container.addEventListener("pointerout", leave);
  container.addEventListener("focusout", leave);
  container.addEventListener("keydown", onKey);
  if (typeof window !== "undefined") {
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
  }
  return {
    render() {
      if (active && !active.isConnected) hide();
      for (const node of container.querySelectorAll?.<HTMLElement>("[data-graph-reference]") ??
        []) {
        if (!attempted.has(node)) void readTitle(node);
      }
    },
    destroy() {
      destroyed = true;
      hide();
      container.removeEventListener("pointerover", show);
      container.removeEventListener("focusin", show);
      container.removeEventListener("pointerout", leave);
      container.removeEventListener("focusout", leave);
      container.removeEventListener("keydown", onKey);
      if (typeof window !== "undefined") {
        window.removeEventListener("scroll", onScroll, true);
        window.removeEventListener("resize", onResize);
      }
    },
  };
}
