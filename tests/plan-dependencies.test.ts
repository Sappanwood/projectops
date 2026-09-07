import { readPlanExecution } from "../src/application/planExecution.js";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runCli } from "../src/app.js";
import { revisePlan, showPlanRevision } from "../src/application/planRevision.js";
function fixture(t: test.TestContext) {
  const ws = mkdtempSync(path.join(tmpdir(), "pops-deps-"));
  t.after(() => rmSync(ws, { recursive: true, force: true }));
  const run = (args: string[]) => {
    const out: string[] = [],
      err: string[] = [];
    const code = runCli(
      [...args, "--json"],
      { stdout: (v) => out.push(v), stderr: (v) => err.push(v) },
      ws,
    );
    return { code, value: out.length ? JSON.parse(out[0]!) : null, error: err.join("\n") };
  };
  assert.equal(run(["init"]).code, 0);
  for (const project of ["ccp", "mochi", "write"]) {
    mkdirSync(path.join(ws, project));
    assert.equal(run(["project", "add", project]).code, 0);
    assert.equal(run(["backlog", "init", project]).code, 0);
  }
  const add = (project: string, deps?: string) =>
    run([
      "backlog",
      "add",
      project,
      "-T",
      "Task",
      "-c",
      "feature",
      "--priority",
      "P1",
      ...(deps === undefined ? [] : ["--depends-on", deps]),
    ]);
  const show = (project: string, id: string) => run(["backlog", "show", project, id]).value;
  const edit = (project: string, id: string, deps: string, rev = show(project, id).revision) =>
    run(["backlog", "update", project, id, "--depends-on", deps, "--expected-revision", rev]);
  const file = (project: string, id: string) =>
    path.join(ws, "ops", project, "backlog", "items", `${id}.md`);
  return { ws, run, add, show, edit, file };
}

function draft(deps = ["prepare", "ccp:CCP-001"]) {
  return {
    title: "Mixed plan",
    goal: "Deliver",
    items: [
      {
        key: "prepare",
        title: "Prepare",
        item_type: "task",
        priority: "P1",
        body: "",
        depends_on: ["ccp:CCP-001"],
      },
      { key: "ship", title: "Ship", item_type: "task", priority: "P1", body: "", depends_on: deps },
    ],
  };
}
function create(c: ReturnType<typeof fixture>, value = draft()) {
  const input = path.join(c.ws, "draft.json");
  writeFileSync(input, JSON.stringify(value));
  return c.run(["plan", "create", "write", "--input", input]);
}
function materialize(c: ReturnType<typeof fixture>) {
  assert.equal(create(c).code, 0);
  assert.equal(c.run(["plan", "validate", "write", "plan-mixed-plan"]).code, 0);
  assert.equal(
    c.run(["plan", "approve", "write", "plan-mixed-plan", "--review-note", "fixture"]).code,
    0,
  );
  return c.run(["plan", "materialize", "write", "plan-mixed-plan"]);
}
test("mixed dependencies preserve external todo tasks and only own local mapping", (t) => {
  const c = fixture(t);
  c.add("ccp");
  const external = readFileSync(c.file("ccp", "CCP-001"), "utf8");
  const result = materialize(c);
  assert.equal(result.code, 0, result.error);
  assert.deepEqual(result.value.mapping, { prepare: "WRI-001", ship: "WRI-002" });
  assert.deepEqual(c.show("write", "WRI-002").depends_on, ["WRI-001", "ccp:CCP-001"]);
  assert.equal(readFileSync(c.file("ccp", "CCP-001"), "utf8"), external);
  const plan = c.run(["plan", "show", "write", "plan-mixed-plan"]).value;
  const projection = readPlanExecution({ workspaceDir: c.ws, projectId: "write" }, plan);
  assert.equal(projection.counts.total, 2);
  assert.equal(projection.items.length, 2);
  assert.equal(projection.completion_percent, 0);
  writeFileSync(c.file("ccp", "CCP-001"), "unreadable external");
  const retry = c.run(["plan", "materialize", "write", "plan-mixed-plan"]);
  assert.equal(retry.code, 0);
  assert.equal(retry.value.no_op, true);
  assert.deepEqual(c.run(["plan", "show", "write", "plan-mixed-plan"]).value, plan);
});
test("invalid references fail and approval/materialization recheck external reads", (t) => {
  const c = fixture(t);
  c.add("ccp");
  for (const deps of [["missing"], ["ccp:CCP-999"], ["ccp:CCP-001", "ccp:CCP-001"]])
    assert.equal(create(c, draft(deps)).code, 1);
  assert.equal(create(c).code, 0);
  const external = readFileSync(c.file("ccp", "CCP-001"), "utf8");
  writeFileSync(c.file("ccp", "CCP-001"), "corrupt");
  assert.equal(
    c.run(["plan", "approve", "write", "plan-mixed-plan", "--review-note", "fixture"]).code,
    1,
  );
  writeFileSync(c.file("ccp", "CCP-001"), external);
  assert.equal(
    c.run(["plan", "approve", "write", "plan-mixed-plan", "--review-note", "fixture"]).code,
    0,
  );
  writeFileSync(c.file("ccp", "CCP-001"), "corrupt");
  assert.equal(c.run(["plan", "materialize", "write", "plan-mixed-plan"]).code, 1);
  assert.equal(c.run(["backlog", "list", "write"]).value.items.length, 0);
});
test("revision preserves references and rejects external cycles and stale confirmation", (t) => {
  const c = fixture(t);
  c.add("ccp");
  c.add("mochi");
  assert.equal(materialize(c).code, 0);
  const request = { workspaceDir: c.ws, projectId: "write", planId: "plan-mixed-plan" };
  const shown = showPlanRevision(request);
  assert.ok(shown.ok);
  const changed = draft(["prepare", "mochi:MOC-001"]);
  const preview = revisePlan({ ...request, expectedRevision: shown.data.revision, draft: changed });
  assert.ok(preview.ok);
  assert.equal(c.edit("mochi", "MOC-001", "write:WRI-002").code, 0);
  const cycle = revisePlan({
    ...request,
    expectedRevision: shown.data.revision,
    draft: changed,
    confirm: preview.data.confirmation_token,
  });
  assert.equal(cycle.ok, false);
  if (!cycle.ok) assert.match(cycle.error.message, /cycle/i);
  c.edit("mochi", "MOC-001", "");
  const applied = revisePlan({
    ...request,
    expectedRevision: shown.data.revision,
    draft: changed,
    confirm: preview.data.confirmation_token,
  });
  assert.ok(applied.ok);
  assert.deepEqual(c.show("write", "WRI-002").depends_on, ["WRI-001", "mochi:MOC-001"]);
  assert.equal(
    revisePlan({ ...request, expectedRevision: shown.data.revision, draft: changed }).ok,
    false,
  );
});

test("same-project qualified references stay explicit and alias duplicates fail on revision", (t) => {
  const c = fixture(t);
  c.add("ccp");
  c.add("write");
  const value = draft(["prepare", "write:WRI-001"]);
  assert.equal(create(c, value).code, 0);
  c.run(["plan", "approve", "write", "plan-mixed-plan", "--review-note", "fixture"]);
  assert.equal(c.run(["plan", "materialize", "write", "plan-mixed-plan"]).code, 0);
  assert.deepEqual(c.show("write", "WRI-003").depends_on, ["WRI-002", "write:WRI-001"]);
  const request = { workspaceDir: c.ws, projectId: "write", planId: "plan-mixed-plan" };
  const shown = showPlanRevision(request);
  assert.ok(shown.ok);
  const invalid = revisePlan({
    ...request,
    expectedRevision: shown.data.revision,
    draft: draft(["prepare", "write:WRI-002"]),
  });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.match(invalid.error.message, /duplicate/i);
  value.items[1]!.title = "New title";
  const preview = revisePlan({ ...request, expectedRevision: shown.data.revision, draft: value });
  assert.ok(preview.ok);
  const applied = revisePlan({
    ...request,
    expectedRevision: shown.data.revision,
    draft: value,
    confirm: preview.data.confirmation_token,
  });
  assert.ok(applied.ok);
  assert.deepEqual(c.show("write", "WRI-003").depends_on, ["WRI-002", "write:WRI-001"]);
});

test("revision evaluates the proposed batch graph instead of stale mapped inputs", (t) => {
  const c = fixture(t);
  c.add("ccp");
  assert.equal(materialize(c).code, 0);
  const request = { workspaceDir: c.ws, projectId: "write", planId: "plan-mixed-plan" };
  const shown = showPlanRevision(request);
  assert.ok(shown.ok);
  const value = draft([]);
  value.items[0]!.depends_on = ["write:WRI-002"];
  const preview = revisePlan({ ...request, expectedRevision: shown.data.revision, draft: value });
  assert.ok(preview.ok);
  const applied = revisePlan({
    ...request,
    expectedRevision: shown.data.revision,
    draft: value,
    confirm: preview.data.confirmation_token,
  });
  assert.ok(applied.ok);
  assert.deepEqual(c.show("write", "WRI-001").depends_on, ["write:WRI-002"]);
  assert.deepEqual(c.show("write", "WRI-002").depends_on, []);
  const updated = showPlanRevision(request);
  assert.ok(updated.ok);
  value.items[1]!.depends_on = ["write:WRI-001"];
  const cycle = revisePlan({ ...request, expectedRevision: updated.data.revision, draft: value });
  assert.equal(cycle.ok, false);
  if (!cycle.ok) assert.match(cycle.error.message, /cycle/i);
});

test("built CLI preserves mixed references through show and materialize", (t) => {
  const c = fixture(t);
  c.add("ccp");
  const input = path.join(c.ws, "draft.json");
  writeFileSync(input, JSON.stringify(draft()));
  const invoke = (args: string[]) =>
    JSON.parse(
      execFileSync(process.execPath, [path.resolve("dist/cli.js"), ...args, "--json"], {
        cwd: c.ws,
        encoding: "utf8",
      }),
    );
  const created = invoke(["plan", "create", "write", "--input", input]);
  const id = created.plan.id;
  invoke(["plan", "validate", "write", id]);
  invoke(["plan", "approve", "write", id, "--review-note", "fixture"]);
  const receipt = invoke(["plan", "materialize", "write", id]);
  assert.equal(Object.keys(receipt.mapping).length, 2);
  assert.deepEqual(invoke(["plan", "show", "write", id]).items[1].depends_on, [
    "prepare",
    "ccp:CCP-001",
  ]);
  assert.deepEqual(invoke(["backlog", "show", "write", receipt.mapping.ship]).depends_on, [
    receipt.mapping.prepare,
    "ccp:CCP-001",
  ]);
});

test("revision rejects pending epic dependency targets before or after root traversal without writes", (t) => {
  for (const epicFirst of [true, false]) {
    const c = fixture(t);
    const epic = {
      key: "release",
      title: "Release",
      item_type: "epic",
      priority: "P1",
      body: "",
      depends_on: [] as string[],
    };
    const task = {
      key: "ship",
      title: "Ship",
      item_type: "task",
      priority: "P1",
      body: "",
      depends_on: [] as string[],
    };
    const value = {
      title: "Mixed plan",
      goal: "Deliver",
      items: epicFirst ? [epic, task] : [task, epic],
    };
    assert.equal(create(c, value).code, 0);
    assert.equal(
      c.run(["plan", "approve", "write", "plan-mixed-plan", "--review-note", "fixture"]).code,
      0,
    );
    const receipt = c.run(["plan", "materialize", "write", "plan-mixed-plan"]);
    assert.equal(receipt.code, 0);
    const request = { workspaceDir: c.ws, projectId: "write", planId: "plan-mixed-plan" };
    const shown = showPlanRevision(request);
    assert.ok(shown.ok);
    const files = [
      path.join(c.ws, "ops", "write", "plans", "plan-mixed-plan.json"),
      path.join(c.ws, "ops", "write", "backlog", "INDEX.md"),
      ...Object.values(receipt.value.mapping).map((id) => c.file("write", String(id))),
    ];
    const before = files.map((file) => readFileSync(file, "utf8"));
    epic.title = "Revised release";
    task.depends_on = [`write:${receipt.value.mapping.release}`];
    for (const confirm of [undefined, "explicit-confirmation"]) {
      const result = revisePlan({
        ...request,
        expectedRevision: shown.data.revision,
        draft: value,
        ...(confirm === undefined ? {} : { confirm }),
      });
      assert.equal(result.ok, false, `epicFirst=${epicFirst}`);
      if (!result.ok) assert.match(result.error.message, /expected a task|must be a task/i);
      assert.deepEqual(
        files.map((file) => readFileSync(file, "utf8")),
        before,
      );
    }
  }
});
