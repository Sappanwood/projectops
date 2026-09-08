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
    assert.ok(from.x < to.x, `${edge.from} must precede ${edge.to}`);
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
