import assert from "node:assert/strict";
import test from "node:test";
import type { Plan } from "../src/plan/plan.js";
import { buildPlanGraph, renderPlanGraph } from "../src/web/planDependencyGraph.js";

function plan(): Plan {
  return {
    schema: "plan/Plan@1",
    id: "plan-graph",
    title: "Graph",
    goal: "Review dependencies",
    status: "draft",
    items: [
      { key: "ship", title: "Ship", depends_on: ["api", "ui"] },
      { key: "api", title: "API", depends_on: ["empty:EMP-001"] },
      { key: "ui", title: "UI <script>unsafe</script>", depends_on: ["empty:EMP-001"] },
      { key: "solo", title: "Independent", depends_on: [] },
    ].map((item) => ({ ...item, item_type: "task", priority: "P1", body: "" })),
  };
}

test("dependency graph orders predecessors before successors, deduplicates external nodes and keeps independent tasks", () => {
  const graph = buildPlanGraph(plan(), "alpha");
  assert.equal(graph.nodes.length, 5);
  assert.equal(graph.edges.length, 4);
  for (const edge of graph.edges) {
    const from = graph.nodes.find((node) => node.key === edge.from)!;
    const to = graph.nodes.find((node) => node.key === edge.to)!;
    assert.ok(
      from.external ? from.y < to.y : from.x < to.x,
      `${edge.from} must precede ${edge.to}`,
    );
  }
  assert.ok(graph.nodes.some((node) => node.key === "solo"));
  assert.equal(new Set(graph.nodes.map((node) => `${node.x}/${node.y}`)).size, 5);
});

test("graph navigation uses complete mapped identities and keeps uncreated nodes inside the plan", () => {
  const draft = plan();
  draft.materialization = {
    state: "partial",
    materialized_at: "2026-09-08",
    mapping: { api: "ALP-002", ui: "empty:EMP-002" },
  };
  const graph = buildPlanGraph(draft, "alpha");
  assert.equal(graph.nodes.find((node) => node.key === "api")?.label, "ALP-002");
  assert.equal(graph.nodes.find((node) => node.key === "ui")?.label, "empty:EMP-002");
  assert.equal(graph.nodes.find((node) => node.key === "ui")?.external, false);
  assert.deepEqual(graph.nodes.find((node) => node.key === "ui")?.target, {
    project: "empty",
    id: "EMP-002",
  });
  assert.equal(graph.nodes.find((node) => node.key === "ship")?.target, undefined);
  const html = renderPlanGraph(draft, { projectId: "alpha", view: "plans", planId: draft.id });
  assert.match(html, /data-plan-target="plan-graph--ship"/);
  assert.match(html, /backlog\/EMP-002\?from=/);
  assert.match(html, /UI &lt;script&gt;unsafe&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test("empty plans have an explicit graph empty state", () => {
  const draft = { ...plan(), items: [] };
  assert.match(renderPlanGraph(draft, { projectId: "alpha", view: "plans" }), /暂无任务/);
});

function creativeSlice() {
  const draft = plan();
  draft.items = [
    { key: "assets", depends_on: ["mochi:MOC-007"] },
    { key: "creation", depends_on: ["assets", "mochi:MOC-007"] },
    { key: "session", depends_on: ["creation", "mochi:MOC-008"] },
    { key: "acceptance", depends_on: ["session", "mochi:MOC-008"] },
  ].map((item) => ({ ...item, title: item.key, item_type: "task", priority: "P1", body: "" }));
  return draft;
}

test("external prerequisites sit above their consumers without adding task columns", () => {
  const graph = buildPlanGraph(creativeSlice(), "alpha");
  const node = (key: string) => graph.nodes.find((entry) => entry.key === key)!;
  const first = node("mochi:MOC-007");
  const second = node("mochi:MOC-008");
  assert.ok(first.y < node("assets").y);
  assert.ok(second.y < node("session").y);
  assert.ok(second.x > node("creation").x, "late prerequisites belong near late consumers");
  assert.equal(node("assets").x, Math.min(...graph.nodes.map((entry) => entry.x)));
  assert.equal(
    new Set(graph.nodes.filter((entry) => !entry.external).map((entry) => entry.y)).size,
    1,
  );
  assert.equal(graph.edges.length, 7, "all declared direct dependencies remain visible");
});

test("task titles are visible alongside their identity before hover", () => {
  const html = renderPlanGraph(plan(), { projectId: "alpha", view: "plans" });
  assert.match(html, /class="plan-graph-title">Ship<\/span>/);
  assert.match(html, /class="plan-graph-identity">ship<\/span>/);
});

test("branches align with their consumers and disconnected groups occupy separate bands", () => {
  const draft = plan();
  draft.items = [
    { key: "a", depends_on: [] },
    { key: "b", depends_on: [] },
    { key: "c", depends_on: ["b"] },
    { key: "d", depends_on: ["a"] },
    { key: "merge", depends_on: ["c", "d"] },
    { key: "solo", depends_on: [] },
  ].map((item) => ({ ...item, title: item.key, item_type: "task", priority: "P1", body: "" }));
  const graph = buildPlanGraph(draft, "alpha");
  const node = (key: string) => graph.nodes.find((entry) => entry.key === key)!;
  assert.equal(node("a").y, node("d").y);
  assert.equal(node("b").y, node("c").y);
  assert.ok(node("merge").x > node("c").x);
  assert.ok(node("solo").y > Math.max(node("a").y, node("b").y, node("merge").y));
  assert.deepEqual(buildPlanGraph({ ...draft, items: [...draft.items].reverse() }, "alpha"), graph);
});

test("routes avoid every card, stay in bounds and preserve all dependencies across shared prerequisites and skip edges", () => {
  const draft = plan();
  draft.items = [
    { key: "a", depends_on: ["remote:PRE-001", "remote:PRE-002"] },
    { key: "b", depends_on: ["a", "remote:PRE-001"] },
    { key: "c", depends_on: ["a", "remote:PRE-002"] },
    { key: "d", depends_on: ["b", "c", "a", "remote:PRE-001"] },
    { key: "isolated", depends_on: [] },
  ].map((item) => ({ ...item, title: item.key, item_type: "task", priority: "P1", body: "" }));
  const snapshot = JSON.stringify(draft);
  const graph = buildPlanGraph(draft, "alpha");
  assert.equal(JSON.stringify(draft), snapshot);
  assert.equal(
    graph.edges.length,
    draft.items.reduce((sum, item) => sum + item.depends_on.length, 0),
  );
  for (const node of graph.nodes) {
    assert.ok(
      node.x >= 0 &&
        node.y >= 0 &&
        node.x + node.width <= graph.width &&
        node.y + node.height <= graph.height,
    );
    for (const other of graph.nodes.filter((entry) => entry.key !== node.key)) {
      assert.ok(
        node.x + node.width <= other.x ||
          other.x + other.width <= node.x ||
          node.y + node.height <= other.y ||
          other.y + other.height <= node.y,
        `${node.key} overlaps ${other.key}`,
      );
    }
  }
  for (const edge of graph.edges) {
    for (const [index, point] of edge.points.entries()) {
      assert.ok(point.x >= 0 && point.y >= 0 && point.x <= graph.width && point.y <= graph.height);
      if (index === 0) continue;
      const previous = edge.points[index - 1]!;
      assert.ok(previous.x === point.x || previous.y === point.y);
      for (const node of graph.nodes) {
        const intersects =
          Math.max(previous.x, point.x) > node.x &&
          Math.min(previous.x, point.x) < node.x + node.width &&
          Math.max(previous.y, point.y) > node.y &&
          Math.min(previous.y, point.y) < node.y + node.height;
        assert.equal(intersects, false, `${edge.from}->${edge.to} crosses ${node.key}`);
      }
    }
  }
  for (const incoming of [false, true]) {
    const ports = graph.edges.map((edge) => (incoming ? edge.points.at(-1)! : edge.points[0]!));
    assert.equal(new Set(ports.map((point) => `${point.x}/${point.y}`)).size, ports.length);
  }
});
