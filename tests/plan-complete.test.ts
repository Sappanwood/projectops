import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runCli } from "../src/app.js";
import { showPlanRevision, revisePlan } from "../src/application/planRevision.js";
import { updateBacklogItemStatus } from "../src/application/backlogApi.js";

function setup(t: test.TestContext, epicOnly = false) {
  const workspaceDir = mkdtempSync(path.join(tmpdir(), "pops-plan-complete-"));
  t.after(() => rmSync(workspaceDir, { recursive: true, force: true }));
  const call = (args: string[]) => {
    const out: string[] = [],
      err: string[] = [];
    const code = runCli(
      [...args, "--json"],
      { stdout: (v) => out.push(v), stderr: (v) => err.push(v) },
      workspaceDir,
    );
    return { code, value: out.length ? JSON.parse(out.join("")) : null, error: err.join("") };
  };
  const run = (args: string[]) => {
    const r = call(args);
    assert.equal(r.code, 0, JSON.stringify(r));
    return r.value;
  };
  run(["init"]);
  mkdirSync(path.join(workspaceDir, "repo"));
  run(["project", "add", "repo"]);
  run(["backlog", "init", "repo"]);
  const draft = {
    title: "Complete work",
    goal: "Deliver",
    items: [
      { key: "epic", title: "Scope", item_type: "epic", priority: "P1", body: "Scope" },
      ...(!epicOnly
        ? [
            {
              key: "task",
              title: "Task",
              item_type: "task",
              parent: "epic",
              priority: "P1",
              body: "Acceptance",
            },
          ]
        : []),
    ],
  };
  const file = path.join(workspaceDir, "draft.json");
  writeFileSync(file, JSON.stringify(draft));
  const planId = run(["plan", "create", "repo", "--input", file]).plan.id;
  const q = { workspaceDir, projectId: "repo", planId };
  const revision = () => {
    const r = showPlanRevision(q);
    assert.ok(r.ok);
    return r.data.revision;
  };
  const complete = (rev = revision()) =>
    call(["plan", "complete", "repo", planId, "--expected-revision", rev]);
  const materialize = () => {
    run(["plan", "approve", "repo", planId, "--review-note", "Reviewed"]);
    return run(["plan", "materialize", "repo", planId]).mapping;
  };
  return {
    ...q,
    draft,
    call,
    run,
    revision,
    complete,
    materialize,
    file: path.join(workspaceDir, "ops", "repo", "plans", `${planId}.json`),
  };
}

test("explicit CLI completion preserves plan records, is revision protected, and supports reports", (t) => {
  const c = setup(t);
  const mapping = c.materialize();
  assert.ok(updateBacklogItemStatus({ ...c, itemId: mapping.task, status: "done" }).ok);
  assert.equal(c.run(["plan", "show", "repo", c.planId]).status, "approved");
  const before = readFileSync(c.file, "utf8");
  assert.equal(c.complete("stale").code, 1);
  assert.equal(readFileSync(c.file, "utf8"), before);
  const oldRevision = c.revision();
  const done = c.complete();
  assert.equal(done.code, 0, JSON.stringify(done));
  assert.equal(done.value.data.plan.status, "done");
  const shown = c.run(["plan", "show", "repo", c.planId]);
  const { revision: ignored, ...stored } = shown;
  assert.deepEqual(stored, { ...JSON.parse(before), status: "done" });
  assert.equal(c.complete(oldRevision).code, 1);
  assert.equal(c.complete().value.data.no_op, true);
  assert.equal(c.run(["plan", "materialize", "repo", c.planId]).no_op, true);
  assert.equal(c.call(["plan", "approve", "repo", c.planId, "--review-note", "Again"]).code, 1);
  assert.equal(
    revisePlan({ ...c, draft: { ...c.draft, goal: "Revised" }, expectedRevision: c.revision() }).ok,
    false,
  );
  const report = c.run([
    "report",
    "create",
    "repo",
    c.planId,
    "--verification",
    "Fixture verified",
  ]);
  assert.equal(report.report.outcome, "completed");
});

test("completion rejects draft, unmaterialized, unfinished, unreadable and zero-task plans without writes", (t) => {
  const c = setup(t);
  const rejected = () => {
    const before = readFileSync(c.file, "utf8");
    assert.equal(c.complete().code, 1);
    assert.equal(readFileSync(c.file, "utf8"), before);
  };
  rejected();
  c.run(["plan", "approve", "repo", c.planId, "--review-note", "Reviewed"]);
  rejected();
  const mapping = c.run(["plan", "materialize", "repo", c.planId]).mapping;
  for (const status of ["todo", "in_progress", "blocked", "cancelled"]) {
    assert.ok(updateBacklogItemStatus({ ...c, itemId: mapping.task, status }).ok);
    rejected();
  }
  writeFileSync(
    path.join(c.workspaceDir, "ops", "repo", "backlog", "items", `${mapping.task}.md`),
    "broken",
  );
  rejected();
  const empty = setup(t, true);
  empty.materialize();
  assert.equal(empty.complete().code, 1);
  assert.equal(c.call(["plan", "complete", "repo", c.planId]).code, 1);
});

test("HTTP completion requires origin and revision, and read pages expose the saved done status", async (t) => {
  const { startWorkbenchServer } = await import("../src/server/workbenchServer.js");
  const c = setup(t);
  const mapping = c.materialize();
  const server = await startWorkbenchServer({ workspaceDir: c.workspaceDir, port: 0 });
  try {
    const url = `${server.origin}/api/projects/repo/plans/${c.planId}/complete`;
    const post = (body: unknown, origin = server.origin) =>
      fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify(body),
      });
    assert.equal((await post({ expected_revision: c.revision() })).status, 422);
    assert.ok(updateBacklogItemStatus({ ...c, itemId: mapping.task, status: "done" }).ok);
    assert.equal(
      (await post({ expected_revision: c.revision() }, "https://example.com")).status,
      403,
    );
    assert.equal((await post({})).status, 400);
    assert.equal((await post({ expected_revision: "stale" })).status, 409);
    const response = await post({ expected_revision: c.revision() });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.plan.status, "done");
    const pages = await (await fetch(`${server.origin}/api/projects/repo/read-pages`)).json();
    assert.equal(pages.data.plans[0].status, "done");
    assert.equal(pages.data.plans[0].revision, c.revision());
  } finally {
    await server.close();
  }
});
