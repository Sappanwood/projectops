import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runCli } from "../src/app.js";
import { startWorkbenchServer } from "../src/server/workbenchServer.js";
import { serializeReport, type Report } from "../src/report/report.js";
import { serializeRetrospective } from "../src/retrospective/retrospective.js";
import { renderReadPages } from "../src/web/readPagesView.js";
import type { WorkbenchReadPages } from "../src/application/workbenchReadModel.js";

function setup() {
  const root = mkdtempSync(path.join(tmpdir(), "pops-read-pages-"));
  function run(args: string[]) {
    const errors: string[] = [];
    assert.equal(runCli(args, { stdout() {}, stderr: (message) => errors.push(message) }, root), 0, errors.join("\n"));
  }
  run(["init"]);
  mkdirSync(path.join(root, "alpha"));
  run(["project", "add", "alpha"]);
  return { root, run, ops: path.join(root, "ops/alpha") };
}
function snapshot(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      for (const [name, body] of Object.entries(snapshot(path.join(root, entry.name)))) files[`${entry.name}/${name}`] = body;
    } else files[entry.name] = readFileSync(path.join(root, entry.name), "utf8");
  }
  return files;
}

test("four read-only pages expose full typed details through HTTP without writes", async () => {
  const { root, ops, run } = setup();
  let server;
  try {
    run(["docs", "scaffold", "alpha"]);
    writeFileSync(path.join(ops, "plans/plan-delivery.json"), JSON.stringify({
      schema: "plan/Plan@1", id: "plan-delivery", title: "Delivery", goal: "Readable <goal>", status: "approved",
      approval: { approved_at: "2026-09-05", review_note: "Accepted review" },
      materialization: { materialized_at: "2026-09-05", mapping: { first: "ALP-001", second: "ALP-002" } },
      items: [
        { key: "first", title: "First", item_type: "task", priority: "P1", body: "First body", depends_on: [] },
        { key: "second", title: "Second", item_type: "task", priority: "P2", body: "Second body", depends_on: ["first"] },
      ],
    }));
    const report: Report = {
      schema: "report/Report@1", id: "report-delivery", title: "Delivery evidence", project: "alpha", created_at: "2026-09-05",
      outcome: "partial", plan: "project-ops:plans/plan-delivery.json", backlog: [{ id: "ALP-001", status: "done", uri: "project-ops:backlog/items/ALP-001.md" }],
      verification: ["npm test passed"], deviations: ["Accepted partial"], workarounds: ["Temporary fixture"], repo_docs: ["README.md"], body: "## Evidence\n<script>unsafe</script>",
    };
    writeFileSync(path.join(ops, "reports/report-delivery.md"), serializeReport(report));
    for (let i = 0; i < 8; i++) {
      const status = (["inbox", "active", "archive"] as const)[i % 3]!;
      writeFileSync(path.join(root, `retrospectives/${status}/record-${i}.md`), serializeRetrospective({
        schema: "retrospective/Retrospective@1", id: `record-${i}`, created_at: "2026-09-05", project: i === 7 ? null : "alpha", task: `ALP-00${i}`, status,
        trigger: "workflow-friction", harness: "test", model: null, body: "## Evidence\n<unsafe>",
      }));
    }
    const before = snapshot(root);
    server = await startWorkbenchServer({ workspaceDir: root, port: 0 });
    const response = await fetch(`${server.origin}/api/projects/alpha/read-pages`);
    assert.equal(response.status, 200);
    const payload = await response.json() as { ok: boolean; data: WorkbenchReadPages };
    assert.equal(payload.ok, true);
    const data = payload.data;
    assert.equal(data.plans[0]!.goal, "Readable <goal>");
    assert.deepEqual(data.reports[0], report);
    assert.equal(data.retrospectives.length, 8);
    assert.equal(data.documents.length, 4);
    const plans = renderReadPages("plans", data, { project: "alpha", status: "", task: "" });
    for (const text of ["Readable &lt;goal&gt;", "Accepted review", "ALP-002", "Dependencies", "first", "Second body"]) assert.ok(plans.includes(text), text);
    const reports = renderReadPages("reports", data, { project: "alpha", status: "", task: "" });
    for (const text of [report.plan, "ALP-001", "npm test passed", "Accepted partial", "Temporary fixture", "&lt;script&gt;"]) assert.ok(reports.includes(text), text);
    assert.doesNotMatch(reports, /<script>/);
    const retro = renderReadPages("retrospectives", data, { project: "alpha", status: "active", task: "ALP-004" });
    assert.match(retro, /record-4/);
    assert.doesNotMatch(retro, /record-1|record-7/);
    assert.match(retro, /&lt;unsafe&gt;/);
    assert.match(renderReadPages("retrospectives", data, { project: "", status: "", task: "" }), /record-7/);
    const docs = renderReadPages("docs", data, { project: "alpha", status: "", task: "" });
    for (const name of ["README.md", "AGENTS.md", "docs/PRODUCT_SPEC.md", "docs/ARCHITECTURE.md"]) assert.ok(docs.includes(name));
    assert.deepEqual(snapshot(root), before);
    assert.equal((await fetch(`${server.origin}/api/projects/alpha/read-pages`, { method: "POST" })).status, 405);
    assert.equal((await fetch(`${server.origin}/api/projects/alpha/read-pages?path=README.md`)).status, 400);
    assert.equal((await fetch(`${server.origin}/api/projects/missing/read-pages`)).status, 404);
  } finally { await server?.close(); rmSync(root, { recursive: true, force: true }); }
});

test("each page presents empty data and domain diagnostics without hiding healthy records", async () => {
  const { root, ops } = setup();
  let server;
  try {
    server = await startWorkbenchServer({ workspaceDir: root, port: 0 });
    async function read() {
      const response = await fetch(`${server!.origin}/api/projects/alpha/read-pages`);
      assert.equal(response.status, 200);
      return (await response.json() as { data: WorkbenchReadPages }).data;
    }
    let data = await read();
    for (const view of ["plans", "reports", "retrospectives"] as const) assert.match(renderReadPages(view, data, { project: "alpha", status: "", task: "" }), /No .*found/);
    assert.equal(data.documents.length, 4);
    assert.ok(data.documents.every((document) => document.issue === "document is missing"));
    assert.match(renderReadPages("docs", data, { project: "alpha", status: "", task: "" }), /missing/);
    writeFileSync(path.join(ops, "plans/plan-broken.json"), "{");
    writeFileSync(path.join(ops, "reports/report-broken.md"), "broken");
    writeFileSync(path.join(root, "retrospectives/inbox/broken.md"), "broken");
    writeFileSync(path.join(root, "alpha/README.md"), "No heading");
    data = await read();
    for (const view of ["plans", "reports", "docs", "retrospectives"] as const) {
      const html = renderReadPages(view, data, { project: "alpha", status: "", task: "" });
      assert.match(html, /diagnostic|missing|heading/i);
    }
    for (const source of ["plans", "reports", "retrospectives"]) assert.ok(data.diagnostics.some((diagnostic) => diagnostic.source === source && diagnostic.code === "ARTIFACT_INVALID"));
    assert.equal(JSON.stringify(data).includes(root), false);
  } finally { await server?.close(); rmSync(root, { recursive: true, force: true }); }
});

test("mounted Workbench loads read pages, submits filters and refreshes authority data", async () => {
  const { createWorkbenchApp } = await import("../src/web/app.js");
  const { createApiClient } = await import("../src/web/apiClient.js");
  const { root, ops } = setup();
  let server;
  let app;
  try {
    writeFileSync(path.join(root, "retrospectives/inbox/visible.md"), serializeRetrospective({
      schema: "retrospective/Retrospective@1", id: "visible", created_at: "2026-09-05", project: "alpha", task: "ALP-001", status: "inbox",
      trigger: "workflow-friction", harness: "test", model: null, body: "Visible detail",
    }));
    server = await startWorkbenchServer({ workspaceDir: root, port: 0 });
    const handlers: Record<string, (event: any) => void> = {};
    const container = { innerHTML: "", addEventListener: (name: string, handler: any) => { handlers[name] = handler; }, removeEventListener() {} };
    let route: import("../src/web/types.js").RouteState = { projectId: "alpha", view: "retrospectives" };
    let navigate!: (next: typeof route) => void;
    app = createWorkbenchApp({ container: container as unknown as HTMLElement,
      apiClient: createApiClient({ baseUrl: server.origin }),
      router: (onChange) => ({ getCurrentRoute: () => route, navigate: navigate = (next) => { route = next; onChange(next); }, cleanup() {} }),
    });
    async function until(predicate: () => boolean) {
      const deadline = Date.now() + 3000;
      while (!predicate()) {
        assert.ok(Date.now() < deadline, "Read page did not settle");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    await until(() => app!.getState().readPages !== null);
    assert.match(container.innerHTML, /Visible detail/);
    assert.equal(app.getState().retrospectiveFilters.project, "alpha");
    const values: Record<string, string> = { project: "alpha", status: "active", task: "ALP-001" };
    handlers.submit!({ target: { id: "retrospective-filters", elements: { namedItem: (name: string) => ({ value: values[name] }) } }, preventDefault() {} });
    assert.doesNotMatch(container.innerHTML, /Visible detail/);
    assert.match(container.innerHTML, /No active retrospectives found/);
    values.status = "inbox";
    handlers.submit!({ target: { id: "retrospective-filters", elements: { namedItem: (name: string) => ({ value: values[name] }) } }, preventDefault() {} });
    assert.match(container.innerHTML, /Visible detail/);
    navigate({ projectId: "alpha", view: "plans" });
    await until(() => !app!.getState().readPagesLoading);
    assert.match(container.innerHTML, /No plans found/);
    writeFileSync(path.join(ops, "plans/plan-new.json"), JSON.stringify({ schema: "plan/Plan@1", id: "plan-new", title: "New plan", goal: "Fresh authority", status: "draft", items: [] }));
    await app.refresh();
    assert.match(container.innerHTML, /Fresh authority/);
    assert.deepEqual(app.getState().retrospectiveFilters, { project: "alpha", status: "inbox", task: "ALP-001" });
    navigate({ projectId: null, view: "overview" });
    assert.equal(app.getState().readPages, null);
  } finally { app?.destroy(); await server?.close(); rmSync(root, { recursive: true, force: true }); }
});

test("read page requests discard stale responses and expose retry after a read failure", async () => {
  const { createWorkbenchApp } = await import("../src/web/app.js");
  const { createApiClient } = await import("../src/web/apiClient.js");
  const { getWorkbenchProjectOverview, getWorkbenchWorkspaceOverview } = await import("../src/application/workbenchReadModel.js");
  const { root, run } = setup();
  mkdirSync(path.join(root, "beta"));
  run(["project", "add", "beta"]);
  type Result = import("../src/web/apiClient.js").ApiResult<WorkbenchReadPages>;
  const pending: Array<(result: Result) => void> = [];
  const pages = (title: string): WorkbenchReadPages => ({ plans: [{ revision: "fixture-revision", schema: "plan/Plan@1", id: "plan-test", title, goal: title, status: "draft", items: [], execution: { materialized: false, counts: { total: 0, todo: 0, in_progress: 0, done: 0, blocked: 0, cancelled: 0, unreadable: 0 }, completion_percent: null, items: [] }, next_tasks: { plan_id: "plan-test", ready: [], in_progress: [], blocked: [], next: null, diagnostics: [] }, delivery_reports: [] }], reports: [], documents: [], retrospectives: [], diagnostics: [] });
  const handlers: Record<string, (event: any) => void> = {};
  const container = { innerHTML: "", addEventListener: (name: string, handler: any) => { handlers[name] = handler; }, removeEventListener() {} };
  let route: import("../src/web/types.js").RouteState = { projectId: "alpha", view: "plans" };
  let navigate!: (next: typeof route) => void;
  const app = createWorkbenchApp({ container: container as unknown as HTMLElement,
    apiClient: { ...createApiClient(),
      getWorkspaceOverview: async () => getWorkbenchWorkspaceOverview({ workspaceDir: root }),
      getProjectOverview: async (projectId) => getWorkbenchProjectOverview({ workspaceDir: root, projectId }),
      getReadPages: () => new Promise((resolve) => pending.push(resolve)),
    },
    router: (onChange) => ({ getCurrentRoute: () => route, navigate: navigate = (next) => { route = next; onChange(next); }, cleanup() {} }),
  });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  try {
    await settle();
    assert.match(container.innerHTML, /Loading read-only view/);
    navigate({ projectId: "beta", view: "plans" });
    await settle();
    pending[1]!({ ok: true, data: pages("Beta fresh") });
    await settle();
    pending[0]!({ ok: true, data: pages("Alpha stale") });
    await settle();
    assert.match(container.innerHTML, /Beta fresh/);
    assert.doesNotMatch(container.innerHTML, /Alpha stale/);
    navigate({ projectId: "beta", view: "reports" });
    navigate({ projectId: "beta", view: "plans" });
    pending[3]!({ ok: false, error: { message: "Read unavailable" } });
    await settle();
    pending[2]!({ ok: true, data: pages("Stale same project") });
    await settle();
    assert.match(container.innerHTML, /Read unavailable/);
    assert.doesNotMatch(container.innerHTML, /Stale same project/);
    handlers.click!({ target: { closest: (selector: string) => selector === "#read-pages-retry" ? {} : null } });
    pending[4]!({ ok: true, data: pages("Recovered") });
    await settle();
    assert.match(container.innerHTML, /Recovered/);
    assert.doesNotMatch(container.innerHTML, /Read unavailable/);
  } finally { app.destroy(); rmSync(root, { recursive: true, force: true }); }
});


test("Plan execution counts current mapped tasks, isolates unreadable targets and never writes", async () => {
  const { root, ops, run } = setup();
  let server;
  try {
    run(["backlog", "init", "alpha"]);
    for (const title of ["Actual todo", "Actual running", "Actual done", "Broken", "Epic"]) {
      run(["backlog", "add", "alpha", "-T", title, "-c", "feature", "--priority", "P1", ...(title === "Epic" ? ["--item-type", "epic"] : [])]);
    }
    run(["backlog", "update", "alpha", "ALP-002", "--status", "in_progress"]);
    run(["backlog", "update", "alpha", "ALP-003", "--status", "done"]);
    run(["backlog", "update", "alpha", "ALP-005", "--status", "done"]);
    writeFileSync(path.join(ops, "backlog/items/ALP-004.md"), "broken");
    const keys = ["todo", "running", "done", "broken", "epic", "missing"];
    writeFileSync(path.join(ops, "plans/plan-progress.json"), JSON.stringify({
      schema: "plan/Plan@1", id: "plan-progress", title: "Progress", goal: "Current execution", status: "approved",
      approval: { approved_at: "2026-09-05", review_note: "Fixture" },
      materialization: { materialized_at: "2026-09-05", mapping: Object.fromEntries(keys.map((key, i) => [key, `ALP-00${i + 1}`])) },
      items: keys.map((key) => ({ key, title: `Planned ${key}`, item_type: key === "epic" ? "epic" : "task", priority: "P1", body: "Scope", depends_on: [] })),
    }));
    server = await startWorkbenchServer({ workspaceDir: root, port: 0 });
    const read = async () => {
      const response = await fetch(`${server!.origin}/api/projects/alpha/read-pages`);
      assert.equal(response.status, 200);
      return (await response.json() as { data: WorkbenchReadPages }).data;
    };
    const before = snapshot(root);
    const data = await read();
    const execution = data.plans[0]!.execution;
    assert.deepEqual(execution.counts, { total: 5, todo: 1, in_progress: 1, done: 1, blocked: 0, cancelled: 0, unreadable: 2 });
    assert.equal(execution.completion_percent, 20);
    assert.deepEqual(execution.items.map((item) => item.status), ["todo", "in_progress", "done", "unreadable", "done", "unreadable"]);
    assert.equal(execution.items[0]!.title, "Actual todo");
    assert.equal(execution.items[3]!.diagnostic?.code, "ITEM_INVALID");
    assert.equal(execution.items[5]!.diagnostic?.code, "ITEM_NOT_FOUND");
    const html = renderReadPages("plans", data, { project: "alpha", status: "", task: "" });
    for (const text of ["1/5", "20%", "Actual running", "ALP-006", "无法读取", "已批准"]) assert.ok(html.includes(text), text);
    assert.equal(JSON.stringify(data).includes(root), false);
    assert.deepEqual(snapshot(root), before);
    writeFileSync(path.join(ops, "backlog/items/ALP-001.md"), readFileSync(path.join(ops, "backlog/items/ALP-001.md"), "utf8").replace("status: todo", "status: done"));
    const updated = snapshot(root);
    const refreshed = await read();
    assert.equal(refreshed.plans[0]!.execution.counts.done, 2);
    assert.equal(refreshed.plans[0]!.execution.completion_percent, 40);
    assert.deepEqual(snapshot(root), updated);
  } finally { await server?.close(); rmSync(root, { recursive: true, force: true }); }
});

test("unmaterialized and zero-task Plans have no misleading completion percentage", async () => {
  const { getWorkbenchReadPages } = await import("../src/application/workbenchReadModel.js");
  const { root, ops } = setup();
  try {
    const base = { schema: "plan/Plan@1", title: "Empty", goal: "No execution", items: [] };
    writeFileSync(path.join(ops, "plans/plan-draft.json"), JSON.stringify({ ...base, id: "plan-draft", status: "draft" }));
    writeFileSync(path.join(ops, "plans/plan-empty.json"), JSON.stringify({ ...base, id: "plan-empty", status: "approved",
      approval: { approved_at: "2026-09-05", review_note: "Fixture" }, materialization: { materialized_at: "2026-09-05", mapping: {} } }));
    const result = getWorkbenchReadPages({ workspaceDir: root, projectId: "alpha" });
    assert.ok(result.ok);
    for (const plan of result.data.plans) {
      assert.equal(plan.execution.completion_percent, null);
      assert.equal(plan.execution.counts.total, 0);
    }
    assert.equal(result.data.plans[0]!.execution.materialized, false);
    assert.equal(result.data.plans[1]!.execution.materialized, true);
    const html = renderReadPages("plans", result.data, { project: "alpha", status: "", task: "" });
    assert.match(html, /未开始执行/);
    assert.match(html, /无可执行任务/);
    assert.doesNotMatch(html, /100%|<progress/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("Plan delivery links retain every matching report, timestamp order and independent snapshots", async () => {
  const { getWorkbenchReadPages } = await import("../src/application/workbenchReadModel.js");
  const { root, ops, run } = setup();
  try {
    run(["backlog", "init", "alpha"]);
    const input = path.join(root, "delivery.json");
    writeFileSync(input, JSON.stringify({ title: "Delivery links", goal: "Evidence", items: [{ key: "task", title: "Task", item_type: "task", priority: "P1", body: "Scope" }] }));
    run(["plan", "create", "alpha", "--input", input]);
    run(["plan", "approve", "alpha", "plan-delivery-links", "--review-note", "Fixture"]);
    run(["plan", "materialize", "alpha", "plan-delivery-links"]);
    run(["backlog", "update", "alpha", "ALP-001", "--status", "done"]);
    const read = () => {
      const result = getWorkbenchReadPages({ workspaceDir: root, projectId: "alpha" });
      assert.ok(result.ok);
      return result.data;
    };
    let data = read();
    assert.equal(data.plans[0]!.delivery_reports.length, 0);
    assert.match(renderReadPages("plans", data, { project: "alpha", status: "", task: "" }), /任务已完成，尚无交付报告/);
    const base: Report = {
      schema: "report/Report@1", id: "report-a", title: "Evidence", project: "alpha", created_at: "2026-09-05T12:00:00+09:00",
      outcome: "partial", plan: "project-ops:plans/plan-delivery-links.json", backlog: [{ id: "ALP-001", status: "todo" }],
      verification: ["Fixture"], deviations: [], workarounds: [], repo_docs: [], body: "Snapshot",
    };
    for (const report of [base,
      { ...base, id: "report-b", created_at: "2026-09-05T03:00:00Z" },
      { ...base, id: "report-c", outcome: "completed" as const, created_at: "2026-09-05T04:00:00Z" },
      { ...base, id: "report-foreign", project: "beta" },
      { ...base, id: "report-other", plan: "project-ops:plans/plan-other.json" },
    ]) writeFileSync(path.join(ops, `reports/${report.id}.md`), serializeReport(report));
    writeFileSync(path.join(ops, "reports/report-broken.md"), "broken");
    const before = snapshot(root);
    data = read();
    assert.deepEqual(data.plans[0]!.delivery_reports.map(report => report.id), ["report-c", "report-a", "report-b"]);
    const html = renderReadPages("plans", data, { project: "alpha", status: "", task: "" });
    for (const text of ["report-c", "partial", "completed", "2026-09-05", "report-broken", "ARTIFACT_INVALID"]) assert.ok(html.includes(text), text);
    assert.deepEqual(snapshot(root), before);
    run(["backlog", "update", "alpha", "ALP-001", "--status", "todo"]);
    const changed = snapshot(root);
    data = read();
    assert.equal(data.plans[0]!.execution.counts.done, 0);
    assert.equal(data.plans[0]!.delivery_reports[0]!.outcome, "completed");
    assert.equal(data.plans[0]!.delivery_reports[1]!.outcome, "partial");
    assert.equal(changed["ops/alpha/reports/report-a.md"], before["ops/alpha/reports/report-a.md"]);
    assert.equal(changed["ops/alpha/reports/report-c.md"], before["ops/alpha/reports/report-c.md"]);
    assert.deepEqual(snapshot(root), changed);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
