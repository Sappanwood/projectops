import type { Plan } from "../plan/plan.js";
import { mappingTarget } from "./planIdentityView.js";
import { escapeHtml as e } from "./render.js";
import { formatRoute } from "./router.js";
import type { RouteState } from "./types.js";

import { graphEdgePath, layoutPlanGraph, type GraphNode } from "./planGraphLayout.js";

export function buildPlanGraph(plan: Plan, owner: string) {
  const edges = plan.items.flatMap((item) =>
    item.depends_on.map((from) => ({ from, to: item.key })),
  );
  const nodes: GraphNode[] = [
    ...new Set(edges.map((edge) => edge.from).filter((ref) => ref.includes(":"))),
  ].map((ref) => ({
    key: ref,
    label: ref,
    title: "",
    external: true,
    target: mappingTarget(owner, ref),
  }));
  for (const item of plan.items) {
    const mapping = plan.materialization?.mapping[item.key];
    const target = mapping ? mappingTarget(owner, mapping) : undefined;
    const project = target?.project ?? item.project ?? owner;
    const identity = target?.id ?? item.key;
    nodes.push({
      key: item.key,
      label: project === owner ? identity : `${project}:${identity}`,
      title: item.title,
      external: false,
      ...(target ? { target } : {}),
    });
  }
  return layoutPlanGraph(nodes, edges);
}

export function renderPlanGraph(plan: Plan, route: RouteState): string {
  const graph = buildPlanGraph(plan, route.projectId!);
  const prefix = `${plan.id}--graph`;
  const returnTo = formatRoute({ ...route, planTab: undefined, returnTo: undefined });
  const links = graph.nodes
    .map((node, index) => {
      const href = node.target
        ? formatRoute({
            projectId: node.target.project,
            view: "backlog",
            itemId: node.target.id,
            ...(!node.external && node.target.project === route.projectId
              ? { planId: plan.id }
              : {}),
            returnTo,
          })
        : undefined;
      const attributes = `id="${e(prefix)}-node-${index}" class="btn btn-secondary plan-graph-node${node.external ? " plan-graph-external" : ""}" style="left:${node.x}px;top:${node.y}px;width:${node.width}px;height:${node.height}px" data-graph-node="${e(node.key)}" data-graph-title="${e(node.title)}" ${node.external ? `data-graph-reference="${e(node.key)}"` : ""} aria-label="${e(`${node.label} — ${node.title || "既有任务"}`)}" aria-describedby="${e(prefix)}-tooltip"`;
      const content = `<span class="plan-graph-title">${e(node.title || "外部前置")}</span><span class="plan-graph-identity">${e(node.label)}</span>`;
      return href
        ? `<a ${attributes} href="${e(href)}">${content}</a>`
        : `<button type="button" ${attributes} data-plan-target="${e(`${plan.id}--${node.key}`)}">${content}</button>`;
    })
    .join("");
  const paths = graph.edges
    .map((edge) => {
      const d = graphEdgePath(edge.points);
      const kind = edge.external ? "external" : "internal";
      return `<g data-graph-from="${e(edge.from)}" data-graph-to="${e(edge.to)}" class="plan-graph-connection ${kind}"><path class="plan-graph-edge-clearance" d="${d}"/><path data-graph-edge="${e(`${edge.from}->${edge.to}`)}" d="${d}" marker-end="url(#${e(prefix)}-${kind}-arrow)"/></g>`;
    })
    .join("");
  return `<section class="plan-graph" aria-label="计划依赖图"><h3>依赖关系</h3>
    <p class="form-help">从左向右查看计划任务，虚线框为就近排列的外部前置。悬停或聚焦突出直接依赖并查看完整标题；点击打开任务或定位计划正文。</p>
    ${
      graph.nodes.length
        ? `<div class="plan-graph-scroll" tabindex="0" role="group" aria-label="依赖图，可滚动查看" id="${e(prefix)}-scroll"><div class="plan-graph-canvas" style="width:${graph.width}px;height:${graph.height}px">
      <svg width="${graph.width}" height="${graph.height}" aria-hidden="true"><defs>${["internal", "external"].map((kind) => `<marker id="${e(prefix)}-${kind}-arrow" class="${kind}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z"/></marker>`).join("")}</defs>${paths}</svg>${links}</div></div>`
        : '<p class="muted">暂无任务。</p>'
    }
    <div class="plan-graph-tooltip" id="${e(prefix)}-tooltip" role="tooltip" hidden></div></section>`;
}
