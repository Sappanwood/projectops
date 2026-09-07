import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runCli } from "../src/app.js";
import { readPlanExecution } from "../src/application/planExecution.js";
import { readPlanNext } from "../src/application/planNext.js";
import { revisePlan, showPlanRevision } from "../src/application/planRevision.js";
function fixture(t: test.TestContext) {
  const workspaceDir = mkdtempSync(path.join(tmpdir(), "pops-cross-lifecycle-"));
  t.after(() => rmSync(workspaceDir, { recursive: true, force: true }));
  const run = (args: string[]) => {
    const out: string[] = [];
    const code = runCli(
      [...args, "--json"],
      { stdout: (s) => out.push(s), stderr: (s) => out.push(s) },
      workspaceDir,
    );
    assert.equal(code, 0, out.join("\n"));
    return JSON.parse(out[0]!);
  };
  run(["init"]);
  for (const p of ["owner", "remote"]) {
    mkdirSync(path.join(workspaceDir, p));
    run(["project", "add", p]);
    run(["backlog", "init", p]);
  }
  const external = run([
    "backlog",
    "add",
    "remote",
    "-T",
    "External",
    "-c",
    "feature",
    "--priority",
    "P1",
  ]).item.id;
  run(["backlog", "update", "remote", external, "--status", "done"]);
  const draft = {
    title: "Cross lifecycle",
    goal: "Deliver",
    items: [
      { key: "first", title: "First", item_type: "task", priority: "P1", body: "", depends_on: [] },
      {
        key: "second",
        project: "remote",
        title: "Second",
        item_type: "task",
        priority: "P1",
        body: "",
        depends_on: ["first", `remote:${external}`],
      },
    ],
  };
  const file = path.join(workspaceDir, "draft.json");
  writeFileSync(file, JSON.stringify(draft));
  run(["plan", "create", "owner", "--input", file]);
  const request = { workspaceDir, projectId: "owner", planId: "plan-cross-lifecycle" };
  run(["plan", "approve", "owner", request.planId, "--review-note", "fixture"]);
  const mapping = run(["plan", "materialize", "owner", request.planId]).mapping;
  const shown = () => {
    const r = showPlanRevision(request);
    assert.ok(r.ok);
    return r.data;
  };
  return { run, draft, request, mapping, shown };
}
test("cross-project progress and next use task ownership and exclude existing prerequisites", (t) => {
  const f = fixture(t);
  const plan = f.shown().plan;
  const remoteId = f.mapping.second.split(":")[1];
  const remote = f.run(["backlog", "show", "remote", remoteId]);
  f.run([
    "backlog",
    "update",
    "remote",
    remoteId,
    "--depends-on",
    remote.depends_on.map((d: string) => d.replace(/^remote:/, "")).join(","),
    "--expected-revision",
    remote.revision,
  ]);
  let execution = readPlanExecution(f.request, plan);
  assert.equal(execution.counts.total, 2);
  assert.equal(execution.counts.unreadable, 0);
  assert.equal(execution.prerequisites.evidence.length, 1);
  assert.equal(execution.prerequisites.diagnostics.length, 0);
  assert.equal(readPlanNext(f.request, plan).blocked.length, 1);
  f.run(["backlog", "update", "owner", f.mapping.first, "--status", "done"]);
  execution = readPlanExecution(f.request, plan);
  assert.equal(execution.completion_percent, 50);
  const next = readPlanNext(f.request, plan).next!;
  assert.equal(next.project, "remote");
  assert.equal(next.id, f.mapping.second.split(":")[1]);
  f.run(["backlog", "update", "remote", next.id, "--status", "done"]);
  assert.equal(readPlanExecution(f.request, plan).completion_percent, 100);
  plan.materialization!.state = "partial";
  delete plan.materialization!.mapping.second;
  execution = readPlanExecution(f.request, plan);
  assert.equal(execution.materialized, false);
  assert.equal(execution.completion_percent, null);
  assert.equal(execution.counts.done, 1);
  assert.equal(readPlanNext(f.request, plan).next, null);
  assert.ok(
    readPlanNext(f.request, plan).diagnostics.some((d) => d.code === "PLAN_PARTIALLY_MATERIALIZED"),
  );
});
test("revision previews and updates both stores with project identities and protects stale or started work", (t) => {
  const f = fixture(t);
  const shown = f.shown();
  const draft = {
    ...f.draft,
    items: f.draft.items.map((i) => ({ ...i, title: `${i.title} revised` })),
  };
  const request = { ...f.request, expectedRevision: shown.revision, draft };
  const preview = revisePlan(request);
  assert.ok(preview.ok, JSON.stringify(preview));
  assert.deepEqual(
    preview.data.affected_items.map((i) => i.project),
    ["owner", "remote"],
  );
  const applied = revisePlan({ ...request, confirm: preview.data.confirmation_token });
  assert.ok(applied.ok, JSON.stringify(applied));
  for (const [project, id] of [["owner", f.mapping.first], f.mapping.second.split(":")])
    assert.match(f.run(["backlog", "show", project!, id!]).title, /revised/);
  assert.equal(revisePlan(request).ok, false);
  f.run(["backlog", "update", "remote", f.mapping.second.split(":")[1], "--status", "in_progress"]);
  const protectedResult = revisePlan({
    ...request,
    expectedRevision: f.shown().revision,
    draft: { ...draft, items: draft.items.map((i) => ({ ...i, body: "changed" })) },
  });
  assert.ok(!protectedResult.ok);
  assert.match(protectedResult.error.message, /TASK_PROTECTED/);
});
