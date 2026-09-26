export type GraphNode = {
  key: string;
  label: string;
  title: string;
  external: boolean;
  target?: { project: string; id: string };
};
export type GraphEdge = { from: string; to: string };
export type Point = { x: number; y: number };
export type PositionedNode = GraphNode & Point & { width: number; height: number; level: number };
const width = 196;
const height = 88;
const column = 284;
const row = 140;
const margin = 32;

export function layoutPlanGraph(input: GraphNode[], dependencies: GraphEdge[]) {
  const nodes: PositionedNode[] = input
    .toSorted((a, b) => a.key.localeCompare(b.key))
    .map((node) => ({ ...node, x: 0, y: 0, width, height, level: 0 }));
  const edges = dependencies.toSorted((a, b) =>
    `${a.from}\0${a.to}`.localeCompare(`${b.from}\0${b.to}`),
  );
  const byKey = new Map(nodes.map((node) => [node.key, node]));
  const readingOrder: PositionedNode[] = [];
  const neighbors = (key: string) =>
    edges.flatMap((edge) => (edge.from === key ? [edge.to] : edge.to === key ? [edge.from] : []));
  const remaining = new Set(nodes.map((node) => node.key));
  let top = margin;
  while (remaining.size) {
    const keys = new Set<string>();
    const pending = [remaining.values().next().value!];
    while (pending.length) {
      const key = pending.pop()!;
      if (!remaining.delete(key)) continue;
      keys.add(key);
      pending.push(...neighbors(key));
    }
    const group = nodes.filter((node) => keys.has(node.key));
    const tasks = group.filter((node) => !node.external);
    const placed = new Set(group.filter((node) => node.external).map((node) => node.key));
    while (placed.size < group.length) {
      const node = tasks.find(
        (candidate) =>
          !placed.has(candidate.key) &&
          edges.filter((edge) => edge.to === candidate.key).every((edge) => placed.has(edge.from)),
      );
      if (!node) throw new Error("Plan dependency graph must be acyclic and complete");
      node.level = Math.max(
        0,
        ...edges
          .filter((edge) => edge.to === node.key && !byKey.get(edge.from)!.external)
          .map((edge) => byKey.get(edge.from)!.level + 1),
      );
      placed.add(node.key);
    }
    const levels = Array.from(
      { length: Math.max(0, ...tasks.map((node) => node.level)) + 1 },
      (_, level) => tasks.filter((node) => node.level === level),
    );
    const rows = Math.max(1, ...levels.map((level) => level.length));
    const positions = () => {
      for (const level of levels)
        level.forEach((node, index) => {
          node.y = (index + (rows - level.length) / 2) * row;
        });
    };
    positions();
    for (let pass = 0; pass < 4; pass++) {
      const forward = pass % 2 === 0;
      for (const level of forward ? levels : [...levels].reverse()) {
        const center = (node: PositionedNode) => {
          const related = edges
            .filter((edge) => (forward ? edge.to === node.key : edge.from === node.key))
            .map((edge) => byKey.get(forward ? edge.from : edge.to)!)
            .filter((entry) => !entry.external);
          return related.length
            ? related.reduce((sum, entry) => sum + entry.y, 0) / related.length
            : node.y;
        };
        const centers = new Map(level.map((node) => [node.key, center(node)]));
        level.sort(
          (a, b) => centers.get(a.key)! - centers.get(b.key)! || a.key.localeCompare(b.key),
        );
        positions();
      }
    }
    for (const node of tasks) node.x = margin + node.level * column;
    const right = Math.max(margin + width, ...tasks.map((node) => node.x + width));
    const externals = group.filter((node) => node.external);
    for (const node of externals) {
      const targets = edges
        .filter((edge) => edge.from === node.key)
        .map((edge) => byKey.get(edge.to)!);
      node.x = Math.min(
        right - width,
        Math.max(margin, targets.reduce((sum, entry) => sum + entry.x, 0) / targets.length),
      );
    }
    const shelves: PositionedNode[][] = [];
    for (const node of externals.toSorted((a, b) => a.x - b.x || a.key.localeCompare(b.key))) {
      let shelf = shelves.findIndex((entries) =>
        entries.every((entry) => node.x + width + 24 <= entry.x || entry.x + width + 24 <= node.x),
      );
      if (shelf < 0) {
        shelf = shelves.length;
        shelves.push([]);
      }
      shelves[shelf]!.push(node);
      node.y = top + shelf * row;
    }
    const taskTop = top + shelves.length * row;
    for (const node of tasks) node.y += taskTop;
    readingOrder.push(
      ...externals.toSorted((a, b) => a.y - b.y || a.x - b.x),
      ...tasks.toSorted((a, b) => a.level - b.level || a.y - b.y),
    );
    top = Math.max(...group.map((node) => node.y + height)) + 96;
  }
  const graphWidth = Math.max(0, ...nodes.map((node) => node.x + width)) + margin;
  const graphHeight = Math.max(0, ...nodes.map((node) => node.y + height)) + margin;
  const routed: Array<GraphEdge & { external: boolean; points: Point[] }> = [];
  for (const edge of edges.toSorted(
    (a, b) => Number(byKey.get(a.from)!.external) - Number(byKey.get(b.from)!.external),
  )) {
    const from = byKey.get(edge.from)!;
    const to = byKey.get(edge.to)!;
    const external = from.external;
    const outgoing = edges
      .filter((candidate) => candidate.from === from.key)
      .sort((a, b) =>
        external
          ? byKey.get(a.to)!.x - byKey.get(b.to)!.x
          : byKey.get(a.to)!.y - byKey.get(b.to)!.y,
      );
    const incoming = edges
      .filter(
        (candidate) => candidate.to === to.key && byKey.get(candidate.from)!.external === external,
      )
      .sort((a, b) =>
        external
          ? byKey.get(a.from)!.x - byKey.get(b.from)!.x
          : byKey.get(a.from)!.y - byKey.get(b.from)!.y,
      );
    const port = (length: number, collection: GraphEdge[]) =>
      (length * (collection.indexOf(edge) + 1)) / (collection.length + 1);
    const start = external
      ? { x: from.x + port(width, outgoing), y: from.y + height }
      : { x: from.x + width, y: from.y + port(height, outgoing) };
    const end = external
      ? { x: to.x + port(width, incoming), y: to.y - 5 }
      : { x: to.x - 5, y: to.y + port(height, incoming) };
    const exit = external ? { x: start.x, y: start.y + 16 } : { x: start.x + 16, y: start.y };
    const entry = external ? { x: end.x, y: to.y - 16 } : { x: to.x - 16, y: end.y };
    const points = [
      start,
      ...routeEdge(
        exit,
        entry,
        nodes,
        routed.flatMap((item) => segments(item.points)),
        graphWidth,
        graphHeight,
      ),
      end,
    ];
    routed.push({ ...edge, external, points: simplify(points) });
  }
  return { nodes: readingOrder, edges: routed, width: graphWidth, height: graphHeight };
}

function segments(points: Point[]) {
  return points.slice(1).map((point, index) => ({ a: points[index]!, b: point }));
}
function simplify(points: Point[]) {
  return points.filter((point, index) => {
    const before = points[index - 1];
    const after = points[index + 1];
    return (
      !before ||
      !after ||
      !(
        (before.x === point.x && point.x === after.x) ||
        (before.y === point.y && point.y === after.y)
      )
    );
  });
}

function routeEdge(
  start: Point,
  end: Point,
  nodes: PositionedNode[],
  used: ReturnType<typeof segments>,
  graphWidth: number,
  graphHeight: number,
): Point[] {
  const xs = [
    ...new Set([
      16,
      graphWidth - 16,
      start.x,
      end.x,
      ...nodes.flatMap((node) => [node.x - 16, node.x + node.width + 16]),
    ]),
  ].sort((a, b) => a - b);
  const ys = [
    ...new Set([
      16,
      graphHeight - 16,
      start.y,
      end.y,
      ...nodes.flatMap((node) => [node.y - 16, node.y + node.height + 16]),
    ]),
  ].sort((a, b) => a - b);
  const blocked = (a: Point, b: Point) =>
    nodes.some(
      (node) =>
        Math.max(a.x, b.x) > node.x - 8 &&
        Math.min(a.x, b.x) < node.x + node.width + 8 &&
        Math.max(a.y, b.y) > node.y - 8 &&
        Math.min(a.y, b.y) < node.y + node.height + 8,
    );
  const penalty = (a: Point, b: Point) =>
    used.reduce((cost, segment) => {
      const horizontal = a.y === b.y;
      const otherHorizontal = segment.a.y === segment.b.y;
      if (horizontal !== otherHorizontal) return cost;
      const sameLine = horizontal ? a.y === segment.a.y : a.x === segment.a.x;
      const axis = horizontal ? "x" : "y";
      const overlap =
        Math.min(Math.max(a[axis], b[axis]), Math.max(segment.a[axis], segment.b[axis])) -
        Math.max(Math.min(a[axis], b[axis]), Math.min(segment.a[axis], segment.b[axis]));
      return cost + (sameLine && overlap > 0 ? overlap * 10 : 0);
    }, 0);
  type Step = {
    x: number;
    y: number;
    direction: number;
    cost: number;
    estimate: number;
    previous?: Step;
  };
  const distance = (x: number, y: number) => Math.abs(xs[x]! - end.x) + Math.abs(ys[y]! - end.y);
  const queue: Step[] = [
    {
      x: xs.indexOf(start.x),
      y: ys.indexOf(start.y),
      direction: -1,
      cost: 0,
      estimate: distance(xs.indexOf(start.x), ys.indexOf(start.y)),
    },
  ];
  const costs = new Map<string, number>();
  while (queue.length) {
    let best = 0;
    for (let index = 1; index < queue.length; index++)
      if (queue[index]!.estimate < queue[best]!.estimate) best = index;
    const current = queue.splice(best, 1)[0]!;
    const a = { x: xs[current.x]!, y: ys[current.y]! };
    if (a.x === end.x && a.y === end.y) {
      const points: Point[] = [];
      for (let step: Step | undefined = current; step; step = step.previous)
        points.push({ x: xs[step.x]!, y: ys[step.y]! });
      return points.reverse();
    }
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ]) {
      const x = current.x + dx!;
      const y = current.y + dy!;
      if (xs[x] === undefined || ys[y] === undefined) continue;
      const b = { x: xs[x]!, y: ys[y]! };
      if (blocked(a, b)) continue;
      const direction = dx === 0 ? 1 : 0;
      const cost =
        current.cost +
        Math.abs(a.x - b.x) +
        Math.abs(a.y - b.y) +
        (current.direction >= 0 && current.direction !== direction ? 24 : 0) +
        penalty(a, b);
      const key = `${x}/${y}/${direction}`;
      if (cost >= (costs.get(key) ?? Infinity)) continue;
      costs.set(key, cost);
      queue.push({ x, y, direction, cost, estimate: cost + distance(x, y), previous: current });
    }
  }
  throw new Error("Unable to route Plan dependency");
}

export function graphEdgePath(points: Point[]) {
  let path = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let index = 1; index < points.length; index++) {
    const point = points[index]!;
    const next = points[index + 1];
    if (!next) {
      path += ` L ${point.x} ${point.y}`;
      continue;
    }
    const previous = points[index - 1]!;
    const before = Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y);
    const after = Math.abs(next.x - point.x) + Math.abs(next.y - point.y);
    const radius = Math.min(8, before / 2, after / 2);
    const a = {
      x: point.x + Math.sign(previous.x - point.x) * radius,
      y: point.y + Math.sign(previous.y - point.y) * radius,
    };
    const b = {
      x: point.x + Math.sign(next.x - point.x) * radius,
      y: point.y + Math.sign(next.y - point.y) * radius,
    };
    path += ` L ${a.x} ${a.y} Q ${point.x} ${point.y} ${b.x} ${b.y}`;
  }
  return path;
}
