import assert from "node:assert/strict";
import test from "node:test";
import { editPlanDependency, renderPlanDependencyEditor } from "../src/web/planDependenciesUi.js";

test("Plan dependency edits preserve draft and distinguish local keys from task references", () => {
  const body = JSON.stringify({
    title: "Plan",
    goal: "Goal",
    items: [
      { key: "api", title: "API", item_type: "task", depends_on: [] },
      { key: "web", title: "Web", item_type: "task", depends_on: ["api"] },
    ],
  });
  const added = editPlanDependency(body, "web", "mochi:MOC-001", false);
  assert.deepEqual(JSON.parse(added).items[1].depends_on, ["api", "mochi:MOC-001"]);
  assert.deepEqual(JSON.parse(editPlanDependency(added, "web", "api", true)).items[1].depends_on, [
    "mochi:MOC-001",
  ]);
  assert.throws(() => editPlanDependency("broken JSON", "web", "api", false));
  const html = renderPlanDependencyEditor(
    added,
    "web",
    "mochi",
    [{ id: "mochi" }],
    [{ id: "MOC-001", title: "Cloud API", status: "todo", item_type: "task" }],
    false,
  );
  assert.match(html, /Plan 内任务/);
  assert.match(html, /mochi:MOC-001/);
  assert.match(html, /Cloud API/);
  assert.match(html, /todo/);
  assert.match(html, /移除/);
});

test("Plan read view separates owned work and existing prerequisites with a return route", async () => {
  const { renderReadPages } = await import("../src/web/readPagesView.js");
  const { formatRoute } = await import("../src/web/router.js");
  const html = renderReadPages(
    "plans",
    {
      plans: [
        {
          schema: "plan/Plan@1",
          id: "plan-deploy",
          title: "Deploy",
          goal: "Cloud",
          status: "draft",
          revision: "r1",
          items: [
            {
              key: "web",
              title: "Web",
              item_type: "task",
              priority: "P1",
              body: "",
              depends_on: ["mochi:MOC-001"],
            },
          ],
          execution: {
            materialized: false,
            prerequisites: { evidence: [], diagnostics: [] },
            counts: {
              total: 0,
              todo: 0,
              in_progress: 0,
              done: 0,
              blocked: 0,
              cancelled: 0,
              unreadable: 0,
            },
            completion_percent: null,
            items: [],
          },
          next_tasks: {
            plan_id: "plan-deploy",
            next: null,
            ready: [],
            in_progress: [],
            blocked: [],
            diagnostics: [],
          },
          delivery_reports: [],
        },
      ],
      reports: [],
      documents: [],
      retrospectives: [],
      diagnostics: [],
    },
    { project: "write", status: "", task: "" },
    { projectId: "write", planId: "plan-deploy" },
  );
  assert.match(html, /1 项任务 · 1 个项目/);
  assert.match(html, /既有依赖不生成或复制任务/);
  const route = formatRoute({
    projectId: "mochi",
    view: "backlog",
    itemId: "MOC-001",
    returnTo: formatRoute({ projectId: "write", view: "plans", planId: "plan-deploy" }),
  });
  assert.ok(html.includes(route.replaceAll("&", "&amp;")));
});
