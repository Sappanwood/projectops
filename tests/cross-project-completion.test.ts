import { ExecutionRuntime } from "../src/execution/runtime.js";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runCli } from "../src/app.js";
import {
  listExecutions,
  createExecution,
  finishExecution,
  verifyExecution,
  decideExecution,
} from "../src/application/executionApi.js";
import { createPlanRun, PlanRunRuntime } from "../src/application/planRunApi.js";
import { createParallelRun, ParallelRunRuntime } from "../src/application/parallelRunApi.js";
import { computePlanRevision } from "../src/application/planRevision.js";
import type { Plan } from "../src/plan/plan.js";
import { readPlan } from "../src/plan/planFs.js";
import { readReport } from "../src/report/reportFs.js";

function fixture(t: test.TestContext, remote = true) {
  const workspaceDir = mkdtempSync(path.join(tmpdir(), "cross-completion-"));
  t.after(() => rmSync(workspaceDir, { recursive: true, force: true }));
  const call = (args: string[]) => {
    const out: string[] = [];
    const code = runCli(
      [...args, "--json"],
      { stdout: (x) => out.push(x), stderr: (x) => out.push(x) },
      workspaceDir,
    );
    return { code, output: out.join("\n") };
  };
  const cli = (args: string[]) => {
    const result = call(args);
    assert.equal(result.code, 0, result.output);
    return JSON.parse(result.output);
  };
  cli(["init"]);
  for (const project of ["owner", "remote"]) {
    const repo = path.join(workspaceDir, project);
    mkdirSync(repo);
    cli(["project", "add", project]);
    cli(["backlog", "init", project]);
    for (const args of [
      ["init", "-q"],
      ["config", "user.name", "Fixture"],
      ["config", "user.email", "fixture@example.invalid"],
    ])
      execFileSync("git", args, { cwd: repo });
    writeFileSync(path.join(repo, "base.txt"), project);
    execFileSync("git", ["add", "."], { cwd: repo });
    execFileSync("git", ["commit", "-qm", "Base"], { cwd: repo });
  }
  const plans = path.join(workspaceDir, "ops/owner/plans");
  const planId = "plan-delivery";
  writeFileSync(
    path.join(plans, `${planId}.json`),
    JSON.stringify({
      schema: "plan/Plan@1",
      id: planId,
      title: "Delivery",
      goal: "Deliver",
      status: "approved",
      approval: { approved_at: new Date().toISOString(), review_note: "Reviewed" },
      execution_policy: { max_parallel: 2 },
      items: ["local", "remote"].map((key) => ({
        key,
        title: key,
        body: key,
        item_type: "task",
        priority: "P1",
        parallel: true,
        ...(remote && key === "remote" ? { project: "remote" } : {}),
      })),
    }),
  );
  cli(["plan", "materialize", "owner", planId]);
  const q = { workspaceDir, projectId: "owner", planId };
  const revision = () => computePlanRevision(readPlan(plans, planId));
  const status = (project: string, id: string) =>
    cli([
      "backlog",
      "update",
      project,
      id,
      "--status",
      "done",
      "--expected-revision",
      cli(["backlog", "show", project, id]).revision,
    ]);
  return { ...q, plans, cli, call, revision, status };
}

test("independent task executions resolve the owner Plan while preserving actual project", (t) => {
  const f = fixture(t);
  for (const [projectId, itemId] of [
    ["owner", "OWN-001"],
    ["remote", "REM-001"],
  ]) {
    const result = createExecution({ ...f, projectId: projectId!, itemId: itemId! });
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.data.attempt.project_id, projectId);
    assert.equal(result.data.attempt.input.item.project, projectId);
    assert.equal((result.data.attempt.input.plan?.snapshot as Plan)?.id, f.planId);
    assert.equal((result.data.attempt.input.plan?.snapshot as Plan)?.items.length, 2);
  }
});

test("cross-project done tasks complete and report preserves project identity through Markdown", (t) => {
  const f = fixture(t);
  f.status("owner", "OWN-001");
  assert.equal(
    f.call(["plan", "complete", "owner", f.planId, "--expected-revision", f.revision()]).code,
    1,
  );
  const partial = f.cli([
    "report",
    "create",
    "owner",
    f.planId,
    "--report-id",
    "report-partial",
    "--verification",
    "Checked",
    "--partial-acceptance",
    "Accept local scope only",
  ]);
  assert.equal(partial.report.outcome, "partial");
  f.status("remote", "REM-001");
  f.cli(["plan", "complete", "owner", f.planId, "--expected-revision", f.revision()]);
  const report = f.cli(["report", "create", "owner", f.planId, "--verification", "Checked"]).report;
  assert.equal(report.outcome, "completed");
  assert.deepEqual(
    report.backlog.map((i: { project: string; id: string }) => [i.project, i.id]),
    [
      ["owner", "OWN-001"],
      ["remote", "REM-001"],
    ],
  );
  assert.deepEqual(
    readReport(f.workspaceDir, path.join(f.workspaceDir, "ops/owner/reports"), report.id).backlog,
    report.backlog,
  );
});

test("cross-project automatic run creation rejects before run or checkout writes", (t) => {
  const f = fixture(t);
  const serial = createPlanRun({ ...f, expectedRevision: f.revision() });
  const parallel = createParallelRun({
    ...f,
    expectedRevision: f.revision(),
    baseCommit: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: path.join(f.workspaceDir, "owner"),
      encoding: "utf8",
    }).trim(),
    commands: [[process.execPath, "-e", "process.exit(0)"]],
  });
  for (const result of [serial, parallel]) {
    assert.equal(result.ok, false);
    if (!result.ok)
      assert.match(result.error.message, /cross-project.*individual|individual.*project/i);
  }
  for (const dir of [
    "ops/owner/executions/plan-runs",
    "ops/owner/executions/parallel-runs",
    ".pops/runtime/plan-runs",
  ])
    assert.equal(existsSync(path.join(f.workspaceDir, dir)), false);
});

test("qualified owner mapping still creates single-project serial and parallel runs", (t) => {
  for (const parallel of [false, true]) {
    const f = fixture(t, false);
    const plan = readPlan(f.plans, f.planId);
    for (const key of Object.keys(plan.materialization!.mapping))
      plan.materialization!.mapping[key] = `owner:${plan.materialization!.mapping[key]}`;
    writeFileSync(path.join(f.plans, `${f.planId}.json`), JSON.stringify(plan));
    const result = parallel
      ? createParallelRun({
          ...f,
          expectedRevision: f.revision(),
          baseCommit: execFileSync("git", ["rev-parse", "HEAD"], {
            cwd: path.join(f.workspaceDir, "owner"),
            encoding: "utf8",
          }).trim(),
          commands: [[process.execPath, "-e", "process.exit(0)"]],
        })
      : createPlanRun({ ...f, expectedRevision: f.revision() });
    assert.ok(result.ok, JSON.stringify(result));
    assert.deepEqual(
      result.data.run.nodes.map((n) => n.item_id),
      ["OWN-001", "OWN-002"],
    );
  }
});

test("cross-project completion checks accepted evidence from each real task project", (t) => {
  const f = fixture(t);
  for (const [projectId, itemId] of [
    ["owner", "OWN-001"],
    ["remote", "REM-001"],
  ]) {
    const q = { ...f, projectId: projectId!, itemId: itemId! };
    const created = createExecution(q);
    assert.ok(created.ok);
    const ended = finishExecution({
      ...q,
      attemptId: created.data.attempt.id,
      expectedRevision: created.data.attempt.revision,
      outcome: "succeeded",
      summary: "Complete",
    });
    assert.ok(ended.ok);
    const checked = verifyExecution({
      ...q,
      attemptId: ended.data.attempt.id,
      expectedRevision: ended.data.attempt.revision,
      command: "fixture check",
      outcome: "passed",
      evidence: "fixture passed",
    });
    assert.ok(checked.ok);
    const accepted = decideExecution({
      ...q,
      attemptId: checked.data.attempt.id,
      expectedRevision: checked.data.attempt.revision,
      decision: "accepted",
      note: "Checked",
    });
    assert.ok(accepted.ok);
  }
  const report = f.cli([
    "report",
    "create",
    "owner",
    f.planId,
    "--verification",
    "Both accepted",
  ]).report;
  assert.ok(
    report.verification.some((v: string) => v.includes("Task remote:REM-001; basis: accepted")),
  );
  f.cli(["plan", "complete", "owner", f.planId, "--expected-revision", f.revision()]);
  const evidenceDir = path.join(f.workspaceDir, "ops/remote/executions");
  const remoteAttempts = listExecutions({ ...f, projectId: "remote", itemId: "REM-001" });
  assert.ok(remoteAttempts.ok);
  const attempt = remoteAttempts.data.attempts[0]!;
  writeFileSync(path.join(evidenceDir, attempt.verifications[0]!.evidence_ref), "changed evidence");
  assert.equal(
    f.call(["plan", "complete", "owner", f.planId, "--expected-revision", f.revision()]).code,
    1,
  );
  assert.equal(
    f.call([
      "report",
      "create",
      "owner",
      f.planId,
      "--report-id",
      "report-invalid",
      "--verification",
      "Check",
    ]).code,
    1,
  );
});

test("automatic dispatch rejects changed cross-project Plan without writing run or starting attempt", (t) => {
  for (const parallel of [false, true]) {
    const f = fixture(t, false);
    const q = { ...f, expectedRevision: f.revision() };
    const created = parallel
      ? createParallelRun({
          ...q,
          baseCommit: execFileSync("git", ["rev-parse", "HEAD"], {
            cwd: path.join(f.workspaceDir, "owner"),
            encoding: "utf8",
          }).trim(),
          commands: [[process.execPath, "-e", "process.exit(0)"]],
        })
      : createPlanRun(q);
    assert.ok(created.ok);
    const run = created.data.run;
    const file = path.join(f.plans, `${f.planId}.json`);
    const plan = readPlan(f.plans, f.planId);
    plan.items[1]!.project = "remote";
    writeFileSync(file, JSON.stringify(plan));
    const runFile = path.join(
      f.workspaceDir,
      "ops/owner/executions",
      parallel ? "parallel-runs" : "plan-runs",
      `${run.id}.json`,
    );
    const before = readFileSync(runFile, "utf8");
    const runtime = new ExecutionRuntime();
    const result = (
      parallel ? new ParallelRunRuntime(runtime) : new PlanRunRuntime(runtime)
    ).advance({ ...f, runId: run.id, expectedRevision: run.revision });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error.message, /Cross-project/);
    assert.equal(readFileSync(runFile, "utf8"), before);
  }
});

test("partial materialization cannot complete or publish even with partial acceptance", (t) => {
  const f = fixture(t);
  f.status("owner", "OWN-001");
  f.status("remote", "REM-001");
  const plan = readPlan(f.plans, f.planId);
  plan.materialization!.state = "partial";
  writeFileSync(path.join(f.plans, `${f.planId}.json`), JSON.stringify(plan));
  assert.equal(
    f.call(["plan", "complete", "owner", f.planId, "--expected-revision", f.revision()]).code,
    1,
  );
  assert.equal(
    f.call([
      "report",
      "create",
      "owner",
      f.planId,
      "--verification",
      "Checked",
      "--partial-acceptance",
      "Accept current result",
    ]).code,
    1,
  );
});
