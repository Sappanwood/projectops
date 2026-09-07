import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runCli } from "../src/app.js";
import { createParallelRun, ParallelRunRuntime } from "../src/application/parallelRunApi.js";
import { computePlanRevision } from "../src/application/planRevision.js";
import type { ApplicationResult } from "../src/application/result.js";
import { ExecutionRuntime } from "../src/execution/runtime.js";
import { readPlan } from "../src/plan/planFs.js";
import { nextParallelNode, type ParallelRun } from "../src/planRun/parallelRun.js";

function data<T>(result: ApplicationResult<T>): T {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw Error();
  return result.data;
}
function fixture(t: test.TestContext, done = true, localPrerequisite = false) {
  const workspaceDir = mkdtempSync(path.join(tmpdir(), "cross-parallel-"));
  t.after(() => rmSync(workspaceDir, { recursive: true, force: true }));
  const cli = (args: string[]) => {
    const output: string[] = [];
    assert.equal(
      runCli(
        [...args, "--json"],
        { stdout: (x) => output.push(x), stderr: (x) => output.push(x) },
        workspaceDir,
      ),
      0,
      output.join("\n"),
    );
    return JSON.parse(output[0]!);
  };
  cli(["init"]);
  for (const project of ["repo", "mochi"]) {
    mkdirSync(path.join(workspaceDir, project));
    cli(["project", "add", project]);
    cli(["backlog", "init", project]);
  }
  cli(["backlog", "add", "mochi", "-T", "API ready", "-c", "feature", "--priority", "P1"]);
  const status = (value: string) =>
    cli([
      "backlog",
      "update",
      "mochi",
      "MOC-001",
      "--status",
      value,
      "--expected-revision",
      cli(["backlog", "show", "mochi", "MOC-001"]).revision,
    ]);
  if (done) status("done");
  const repo = path.join(workspaceDir, "repo");
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  writeFileSync(path.join(repo, "base.txt"), "base");
  git("add", ".");
  git("commit", "-qm", "Base");
  if (localPrerequisite) {
    cli([
      "backlog",
      "add",
      "repo",
      "-T",
      "Existing prerequisite",
      "-c",
      "feature",
      "--priority",
      "P1",
    ]);
    cli([
      "backlog",
      "update",
      "repo",
      "REP-001",
      "--status",
      "done",
      "--expected-revision",
      cli(["backlog", "show", "repo", "REP-001"]).revision,
    ]);
  }
  const prerequisite = localPrerequisite ? "repo:REP-001" : "mochi:MOC-001";
  const planId = "plan-cross";
  const plans = path.join(workspaceDir, "ops/repo/plans");
  writeFileSync(
    path.join(plans, `${planId}.json`),
    JSON.stringify({
      schema: "plan/Plan@1",
      id: planId,
      title: "Cross project",
      goal: "Use shared API",
      status: "approved",
      approval: { approved_at: new Date().toISOString(), review_note: "Reviewed" },
      execution_policy: { max_parallel: 2 },
      items: ["a", "b"].map((key) => ({
        key,
        title: key,
        body: key,
        item_type: "task",
        priority: "P1",
        parallel: true,
        depends_on: key === "a" ? [prerequisite] : ["a", prerequisite],
      })),
    }),
  );
  cli(["plan", "materialize", "repo", planId]);
  const q = { workspaceDir, projectId: "repo", planId };
  const create = () =>
    createParallelRun({
      ...q,
      expectedRevision: computePlanRevision(readPlan(plans, planId)),
      baseCommit: git("rev-parse", "HEAD"),
      commands: [[process.execPath, "-e", "process.exit(0)"]],
    });
  const mutation = (run: ParallelRun) => ({ ...q, runId: run.id, expectedRevision: run.revision });
  return { workspaceDir, status, create, mutation, cli };
}

test("parallel mixed references freeze external done facts and retain local landed ordering", (t) => {
  const f = fixture(t);
  const file = path.join(f.workspaceDir, "ops/mochi/backlog/items/MOC-001.md");
  const before = readFileSync(file, "utf8");
  const run = data(f.create()).run;
  assert.equal(run.nodes.length, 2);
  assert.deepEqual(run.nodes[1]!.depends_on, ["REP-001", "mochi:MOC-001"]);
  assert.equal(nextParallelNode(run)?.key, "a");
  run.nodes[0]!.state = "awaiting_landing";
  assert.equal(nextParallelNode(run), undefined);
  run.nodes[0]!.state = "landed";
  assert.equal(nextParallelNode(run)?.key, "b");
  assert.equal(readFileSync(file, "utf8"), before);
});

test("parallel creation rejects unfinished external work; frozen reopen pauses dispatch and resume", (t) => {
  const f = fixture(t, false);
  assert.equal(f.create().ok, false);
  f.status("done");
  let run = data(f.create()).run;
  f.status("todo");
  const scheduler = new ParallelRunRuntime(new ExecutionRuntime());
  run = data(scheduler.advance(f.mutation(run))).run;
  assert.equal(run.state, "paused");
  assert.match(run.diagnostics.join(" "), /mochi:MOC-001/);
  assert.ok(run.nodes.every((node) => node.attempt_ids.length === 0));
  assert.equal(
    scheduler.resume({ ...f.mutation(run), note: "Cannot ignore reopened upstream" }).ok,
    false,
  );
});

test("parallel dispatch starts only mapped local tasks", async (t) => {
  const f = fixture(t);
  const projects: string[] = [];
  const scheduler = new ParallelRunRuntime(
    new ExecutionRuntime({
      start(attempt) {
        projects.push(attempt.project_id);
        return {
          completion: Promise.resolve({ outcome: "stopped", summary: "Fixture stop" }),
          stop() {},
        };
      },
    }),
  );
  const run = data(scheduler.advance(f.mutation(data(f.create()).run))).run;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(projects, ["repo"]);
  assert.equal(run.nodes[1]!.attempt_ids.length, 0);
});

test("parallel qualified references to mapped local tasks still require local landing", (t) => {
  const f = fixture(t);
  const item = f.cli(["backlog", "show", "repo", "REP-002"]);
  f.cli([
    "backlog",
    "update",
    "repo",
    "REP-002",
    "--depends-on",
    "repo:REP-001,mochi:MOC-001",
    "--expected-revision",
    item.revision,
  ]);
  const run = data(f.create()).run;
  assert.deepEqual(run.nodes[1]!.depends_on, ["REP-001", "mochi:MOC-001"]);
  run.nodes[0]!.state = "awaiting_landing";
  assert.equal(nextParallelNode(run), undefined);
});

test("parallel unreadable frozen upstream pauses without dispatch", (t) => {
  const f = fixture(t);
  let run = data(f.create()).run;
  writeFileSync(path.join(f.workspaceDir, "ops/mochi/backlog/items/MOC-001.md"), "unreadable task");
  const scheduler = new ParallelRunRuntime(new ExecutionRuntime());
  run = data(scheduler.advance(f.mutation(run))).run;
  assert.equal(run.state, "paused");
  assert.match(run.diagnostics.join(" "), /mochi:MOC-001/);
  assert.ok(run.nodes.every((node) => node.attempt_ids.length === 0));
});

test("parallel rechecks external facts before each dispatch in a capacity batch", async (t) => {
  const f = fixture(t);
  const planFile = path.join(f.workspaceDir, "ops/repo/plans/plan-cross.json");
  const plan = JSON.parse(readFileSync(planFile, "utf8"));
  plan.items[1].depends_on = ["mochi:MOC-001"];
  writeFileSync(planFile, JSON.stringify(plan));
  f.cli([
    "backlog",
    "update",
    "repo",
    "REP-002",
    "--depends-on",
    "mochi:MOC-001",
    "--expected-revision",
    f.cli(["backlog", "show", "repo", "REP-002"]).revision,
  ]);
  const dispatched: string[] = [];
  const scheduler = new ParallelRunRuntime(
    new ExecutionRuntime({
      start(attempt) {
        dispatched.push(attempt.item_id);
        f.status("todo");
        return {
          completion: Promise.resolve({ outcome: "stopped", summary: "Fixture stopped" }),
          stop() {},
        };
      },
    }),
  );
  const run = data(scheduler.advance(f.mutation(data(f.create()).run))).run;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(dispatched.length, 1);
  assert.equal(run.state, "paused");
  assert.match(run.diagnostics.join(" "), /mochi:MOC-001/);
});

test("parallel freezes satisfied existing same-project prerequisites and dispatches only mapping", async (t) => {
  const f = fixture(t, true, true);
  const dispatched: string[] = [];
  const scheduler = new ParallelRunRuntime(
    new ExecutionRuntime({
      start(attempt) {
        dispatched.push(attempt.item_id);
        return {
          completion: Promise.resolve({ outcome: "stopped", summary: "Fixture stop" }),
          stop() {},
        };
      },
    }),
  );
  const run = data(f.create()).run;
  assert.deepEqual(
    run.nodes.map((node) => node.item_id),
    ["REP-002", "REP-003"],
  );
  assert.deepEqual(
    run.external_dependencies!.map((dependency) => dependency.reference),
    [{ project: "repo", item: "REP-001" }],
  );
  assert.equal(nextParallelNode(run)?.key, "a");
  data(scheduler.advance(f.mutation(run)));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(dispatched, ["REP-002"]);
});

test("parallel reopened existing same-project prerequisite pauses before dispatch", (t) => {
  const f = fixture(t, true, true);
  let run = data(f.create()).run;
  f.cli([
    "backlog",
    "update",
    "repo",
    "REP-001",
    "--status",
    "todo",
    "--expected-revision",
    f.cli(["backlog", "show", "repo", "REP-001"]).revision,
  ]);
  const scheduler = new ParallelRunRuntime(new ExecutionRuntime());
  run = data(scheduler.advance(f.mutation(run))).run;
  assert.equal(run.state, "paused");
  assert.match(run.diagnostics.join(" "), /repo:REP-001/);
  assert.ok(run.nodes.every((node) => node.attempt_ids.length === 0));
});
