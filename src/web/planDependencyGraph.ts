import type { Plan } from "../plan/plan.js";
import { mappingTarget } from "./planIdentityView.js";
import { escapeHtml as e } from "./render.js";
import { formatRoute } from "./router.js";
import type { RouteState } from "./types.js";

type GraphNode = {
  key: string;
  label: string;
  title: string;
  external: boolean;
  target?: { project: string; id: string };
  level: number;
  x: number;
  y: number;
  width: number;
};
const nodeHeight = 44;

export function buildPlanGraph(plan: Plan, owner: string) {
  const nodes: GraphNode[] = [];
  const edges = plan.items.flatMap((item) =>
    item.depends_on.map((from) => ({ from, to: item.key })),
  );
  for (const ref of new Set(edges.map((edge) => edge.from).filter((ref) => ref.includes(":"))))
    nodes.push({
      key: ref,
      label: ref,
      title: "",
      external: true,
      target: mappingTarget(owner, ref),
      level: 0,
      x: 0,
      y: 0,
      width: 0,
    });
  const byKey = new Map(nodes.map((node) => [node.key, node]));
  const pending = new Set(plan.items);
  while (pending.size) {
    const item = [...pending].find((item) => item.depends_on.every((ref) => byKey.has(ref)))!;
    pending.delete(item);
    const mapping = plan.materialization?.mapping[item.key];
    const target = mapping ? mappingTarget(owner, mapping) : undefined;
    const node: GraphNode = {
      key: item.key,
      label: target
        ? target.project === owner
          ? target.id
          : `${target.project}:${target.id}`
        : item.key,
      title: item.title,
      external: false,
      ...(target ? { target } : {}),
      level: Math.max(0, ...item.depends_on.map((ref) => (byKey.get(ref)?.level ?? 0) + 1)),
      x: 0,
      y: 0,
      width: 0,
    };
    nodes.push(node);
    byKey.set(node.key, node);
  }
  const levels = Array.from(
    { length: Math.max(0, ...nodes.map((node) => node.level)) + 1 },
    (_, level) => nodes.filter((node) => node.level === level),
  );
  const longEdges = edges.filter(
    (edge) => byKey.get(edge.to)!.level - byKey.get(edge.from)!.level > 1,
  );
  const top = 24 + longEdges.length * 12;
  const rows = Math.max(1, ...levels.map((level) => level.length));
  const height = top + rows * 88;
  let x = 24;
  for (const level of levels) {
    const width = Math.max(120, ...level.map((node) => node.label.length * 9 + 32));
    for (const [row, node] of level.entries()) {
      node.width = width;
      node.x = x;
      node.y = top + row * 88 + ((rows - level.length) * 88) / 2;
    }
    x += width + 72;
  }
  return { nodes, edges, longEdges, width: x - 48, height };
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
      const attributes = `id="${e(prefix)}-node-${index}" class="btn btn-secondary plan-graph-node${node.external ? " plan-graph-external" : ""}" style="left:${node.x}px;top:${node.y}px;width:${node.width}px;height:${nodeHeight}px" data-graph-node="${e(node.key)}" data-graph-title="${e(node.title)}" ${node.external ? `data-graph-reference="${e(node.key)}"` : ""} aria-label="${e(`${node.label} — ${node.title || "既有任务"}`)}" aria-describedby="${e(prefix)}-tooltip"`;
      return href
        ? `<a ${attributes} href="${e(href)}">${e(node.label)}</a>`
        : `<button type="button" ${attributes} data-plan-target="${e(`${plan.id}--${node.key}`)}">${e(node.label)}</button>`;
    })
    .join("");
  const paths = graph.edges
    .map((edge) => {
      const from = graph.nodes.find((node) => node.key === edge.from)!;
      const to = graph.nodes.find((node) => node.key === edge.to)!;
      const x1 = from.x + from.width;
      const y1 = from.y + nodeHeight / 2;
      const x2 = to.x - 4;
      const y2 = to.y + nodeHeight / 2;
      const lane = graph.longEdges.indexOf(edge);
      const d =
        lane < 0
          ? `M ${x1} ${y1} C ${x1 + 36} ${y1}, ${x2 - 36} ${y2}, ${x2} ${y2}`
          : `M ${x1} ${y1} H ${x1 + 24} V ${12 + lane * 12} H ${x2 - 24} V ${y2} H ${x2}`;
      return `<path data-graph-edge="${e(`${edge.from}->${edge.to}`)}" d="${d}" marker-end="url(#${e(prefix)}-arrow)"/>`;
    })
    .join("");
  return `<section class="plan-graph" aria-label="计划依赖图"><h3>依赖关系</h3>
    <p class="form-help">前置任务 → 后续任务 · 虚线框为既有任务。悬停或聚焦查看标题，点击打开任务；尚未生成条目的节点定位到计划正文。</p>
    ${
      graph.nodes.length
        ? `<div class="plan-graph-scroll" tabindex="0" role="group" aria-label="依赖图，可滚动查看" id="${e(prefix)}-scroll"><div class="plan-graph-canvas" style="width:${graph.width}px;height:${graph.height}px">
      <svg width="${graph.width}" height="${graph.height}" aria-hidden="true"><defs><marker id="${e(prefix)}-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"/></marker></defs>${paths}</svg>${links}</div></div>`
        : '<p class="muted">暂无任务。</p>'
    }
    <div class="plan-graph-tooltip" id="${e(prefix)}-tooltip" role="tooltip" hidden></div></section>`;
}
