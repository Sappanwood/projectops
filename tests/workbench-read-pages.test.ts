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
  const pages = (title: string): WorkbenchReadPages => ({ plans: [{ schema: "plan/Plan@1", id: "plan-test", title, goal: title, status: "draft", items: [] }], reports: [], documents: [], retrospectives: [], diagnostics: [] });
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
