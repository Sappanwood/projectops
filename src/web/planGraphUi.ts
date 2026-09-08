import type { ApiClient } from "./apiClient.js";
import { mappingTarget } from "./planIdentityView.js";

export function createPlanGraphUi(container: HTMLElement, api: ApiClient) {
  let active: HTMLElement | null = null;
  let activeTitle = "";
  let generation = 0;
  function hide() {
    generation++;
    active = null;
    const tooltip = container.querySelector?.<HTMLElement>(".plan-graph-tooltip");
    if (tooltip) tooltip.hidden = true;
  }
  function display(node: HTMLElement, title: string) {
    const tooltip = node.closest(".plan-graph")?.querySelector<HTMLElement>("[role=tooltip]");
    if (!tooltip || !node.isConnected) return;
    activeTitle = title;
    tooltip.textContent = `${node.dataset.graphNode} — ${title}`;
    tooltip.hidden = false;
    const rect = node.getBoundingClientRect();
    const size = tooltip.getBoundingClientRect();
    tooltip.style.left = `${Math.max(16, Math.min(rect.left, innerWidth - size.width - 16))}px`;
    tooltip.style.top = `${Math.max(16, rect.bottom + size.height + 12 < innerHeight ? rect.bottom + 8 : rect.top - size.height - 8)}px`;
  }
  async function show(event: Event) {
    const node = (event.target as HTMLElement).closest<HTMLElement>("[data-graph-node]");
    if (!node || node === active) return;
    active = node;
    const request = ++generation;
    if (node.dataset.graphTitle) {
      display(node, node.dataset.graphTitle);
      return;
    }
    display(node, "正在读取标题…");
    const target = mappingTarget("", node.dataset.graphReference!);
    const result = await api.showBacklog(target.project, target.id);
    if (request !== generation || !node.isConnected) return;
    if (result.ok) {
      node.dataset.graphTitle = result.data.item.title;
      node.setAttribute("aria-label", `${node.textContent} — ${result.data.item.title}`);
    }
    display(
      node,
      result.ok ? result.data.item.title : "标题读取失败；重新悬停或聚焦可重试，点击仍可打开任务。",
    );
  }
  function leave(event: Event) {
    if ((event.target as HTMLElement).closest("[data-graph-node]")) hide();
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
    destroy() {
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
