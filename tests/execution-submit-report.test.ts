import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { runCli } from "../src/app.js";
import { context, readAttempt } from "../src/execution/store.js";
import { getExecutionEvidence } from "../src/application/executionEvidence.js";

function fixture(t: TestContext) {
  const workspace = mkdtempSync(path.join(tmpdir(), "pops-submit-report-"));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  const cli = (...args: string[]) => {
    const stdout: string[] = [],
      stderr: string[] = [];
    const code = runCli(
      [...args, "--json"],
      { stdout: (s) => stdout.push(s), stderr: (s) => stderr.push(s) },
      workspace,
    );
    const output = stdout.join("\n");
    return { code, output, error: stderr.join("\n"), value: output ? JSON.parse(output) : null };
  };
  const ok = (...args: string[]) => {
    const r = cli(...args);
    assert.equal(r.code, 0, r.output + r.error);
    return r.value;
  };
  ok("init");
  for (const project of ["repo", "other"]) {
    const repo = path.join(workspace, project);
    mkdirSync(repo);
    execFileSync("git", ["init", "-q"], { cwd: repo });
    writeFileSync(path.join(repo, "code.txt"), "code\n".repeat(200));
    ok("project", "add", project);
    ok("backlog", "init", project);
  }
  const task = () =>
    ok(
      "backlog",
      "add",
      "repo",
      "-T",
      "Task",
      "-c",
      "feature",
      "--priority",
      "P1",
      "-b",
      "Acceptance",
    ).item;
  const create = (item: string, project = "repo") =>
    ok("execution", "create", project, item).data.attempt;
  const submit = (
    a: { id: string; revision: string },
    steps: unknown[],
    extra: string[] = [],
    project = "repo",
  ) => {
    const file = path.join(workspace, "submission.json");
    writeFileSync(file, JSON.stringify({ steps }));
    return cli(
      "execution",
      "submit",
      project,
      a.id,
      "--file",
      file,
      "--expected-revision",
      a.revision,
      "--view",
      "summary",
      ...extra,
    );
  };
  const show = (id: string, project = "repo") => ok("execution", "show", project, id).data.attempt;
  const plan = (cross = false) => {
    const draft = path.join(workspace, "draft.json");
    writeFileSync(
      draft,
      JSON.stringify({
        title: "Delivery",
        goal: "Fixture",
        items: [
          { key: "a", title: "A", item_type: "task", priority: "P1", body: "A", depends_on: [] },
          ...(cross
            ? [
                {
                  key: "b",
                  project: "other",
                  title: "B",
                  item_type: "task",
                  priority: "P1",
                  body: "B",
                  depends_on: [],
                },
              ]
            : []),
        ],
      }),
    );
    let p = ok("plan", "create", "repo", "--input", draft).plan;
    p = ok("plan", "approve", "repo", p.id, "--review-note", "fixture-only").plan;
    const materialized = ok("plan", "materialize", "repo", p.id);
    return { id: p.id, mapping: materialized.mapping };
  };
  return { workspace, cli, ok, task, create, submit, show, plan };
}
const finish = { kind: "finish", outcome: "succeeded", summary: "Implemented" };
const check = { kind: "check", argv: [process.execPath, "-e", 'console.log("verified")'] };
const accept = { kind: "accept", note: "fixture-only reviewed and authorized" };

test("submit composes independent facts and returns compact per-step receipts", (t) => {
  const f = fixture(t),
    item = f.task(),
    a = f.create(item.id);
  const r = f.submit(a, [finish, check, accept], ["--accept"]);
  assert.equal(r.code, 0, r.output);
  assert.equal(r.value.data.next_step, null);
  assert.deepEqual(
    r.value.data.receipts.map((s: { kind: string }) => s.kind),
    ["finish", "check", "accept"],
  );
  const saved = f.show(a.id);
  assert.equal(saved.state, "succeeded");
  assert.equal(saved.verifications.length, 1);
  assert.equal(saved.acceptance.decision, "accepted");
  assert.equal(r.value.data.attempt.snapshot, undefined);
  assert.equal(f.ok("backlog", "show", "repo", item.id).status, "done");
  const proof = getExecutionEvidence({
    workspaceDir: f.workspace,
    projectId: "repo",
    attemptId: a.id,
    ref: saved.verifications[0].evidence_ref,
  });
  assert.equal(proof.ok, true);
  if (proof.ok) assert.match(proof.data.body, /verified/);
  assert.equal(f.submit(a, [finish, check, accept], ["--accept"]).code, 1);
  assert.equal(f.show(a.id).verifications.length, 1);
});

test("submission preflight rejects absent authorization, malformed later steps and stale revisions before writing", (t) => {
  const f = fixture(t),
    a = f.create(f.task().id);
  for (const r of [
    f.submit(a, [finish, check, accept]),
    f.submit(a, [finish, { ...check, timeout_ms: -1 }]),
    f.submit(a, [
      finish,
      { kind: "verify", command: "test", outcome: ["passed"], evidence: "output" },
    ]),
    f.submit(a, [finish, { kind: "accept", note: "" }], ["--accept"]),
    f.submit({ ...a, revision: "stale" }, [finish, check]),
  ])
    assert.equal(r.code, 1, r.output);
  assert.equal(f.show(a.id).revision, a.revision);
});

test("failed check stops submission and explicit resume does not replay earlier work", (t) => {
  const f = fixture(t),
    a = f.create(f.task().id);
  const count = path.join(f.workspace, "count"),
    ready = path.join(f.workspace, "ready");
  const steps = [
    finish,
    {
      kind: "check",
      argv: [process.execPath, "-e", `require('fs').appendFileSync(${JSON.stringify(count)}, 'x')`],
    },
    {
      kind: "check",
      argv: [
        process.execPath,
        "-e",
        `process.exit(require('fs').existsSync(${JSON.stringify(ready)}) ? 0 : 7)`,
      ],
    },
    accept,
  ];
  const first = f.submit(a, steps, ["--accept"]);
  assert.equal(first.code, 1);
  assert.equal(first.value.data.next_step, 2);
  assert.equal(first.value.data.receipts.at(-1).outcome, "failed");
  assert.equal(f.show(a.id).acceptance, null);
  writeFileSync(ready, "ready");
  const resumed = f.submit(first.value.data.attempt, steps, ["--accept", "--from-step", "2"]);
  assert.equal(resumed.code, 0, resumed.output);
  assert.equal(readFileSync(count, "utf8"), "x");
  assert.equal(f.show(a.id).verifications.length, 3);
  assert.equal(f.show(a.id).acceptance.decision, "accepted");
});

test("submit can register existing output and accept separately without replaying verification", (t) => {
  const f = fixture(t),
    a = f.create(f.task().id);
  const actual = execFileSync(process.execPath, ["-e", 'console.log("actual output")'], {
    encoding: "utf8",
  });
  const r = f.submit(a, [
    finish,
    { kind: "verify", command: "node fixture", outcome: "passed", evidence: actual },
  ]);
  assert.equal(r.code, 0, r.output);
  assert.equal(f.show(a.id).acceptance, null);
  const completed = f.submit(r.value.data.attempt, [accept], ["--accept"]);
  assert.equal(completed.code, 0, completed.output);
  assert.equal(f.show(a.id).verifications.length, 1);
});

test("submit preserves task, code, evidence and successor acceptance guards", (t) => {
  const f = fixture(t);
  for (const change of ["task", "code", "evidence", "successor"]) {
    const item = f.task(),
      a = f.create(item.id);
    const r = f.submit(a, [finish, check]);
    assert.equal(r.code, 0, r.output);
    const ended = f.show(a.id);
    if (change === "task")
      f.ok(
        "backlog",
        "update",
        "repo",
        item.id,
        "--title",
        "Changed",
        "--expected-revision",
        item.revision,
      );
    if (change === "code") writeFileSync(path.join(f.workspace, "repo", "code.txt"), "changed");
    if (change === "evidence")
      writeFileSync(
        path.join(context(f.workspace, "repo").root, ended.verifications[0].evidence_ref),
        "tampered",
      );
    if (change === "successor") f.ok("execution", "create", "repo", item.id, "--retry-of", a.id);
    const decision = f.submit(ended, [accept], ["--accept"]);
    assert.equal(decision.code, 1, change);
    assert.equal(decision.value.data.next_step, 0);
    assert.equal(f.show(a.id).acceptance, null);
  }
});

test("Report automatically references accepted checks across projects and preserves readable evidence", (t) => {
  const f = fixture(t),
    p = f.plan(true);
  for (const [project, item] of [
    ["repo", p.mapping.a],
    ["other", p.mapping.b.split(":")[1]],
  ]) {
    const a = f.create(item, project);
    assert.equal(f.submit(a, [finish, check, accept], ["--accept"], project).code, 0);
  }
  const r = f.ok("report", "create", "repo", p.id);
  assert.equal(r.report.outcome, "completed");
  assert.equal(r.report.backlog.length, 2);
  for (const row of r.report.backlog) {
    const lines = r.report.verification.filter((s: string) =>
      s.startsWith(`Task ${row.project}:${row.id};`),
    );
    assert.equal(lines.length, 2);
    assert.match(lines[0], /acceptance: accepted/);
    const attemptId = /attempt: (exe-[a-f0-9-]+)/.exec(lines[0])![1]!;
    const ref = /evidence: project-ops:executions\/(evidence\/[^;]+)/.exec(lines[1])![1]!;
    assert.equal(
      getExecutionEvidence({ workspaceDir: f.workspace, projectId: row.project, attemptId, ref })
        .ok,
      true,
    );
    assert.match(lines[1], /check 1: passed/);
    assert.equal(lines[1].includes(f.workspace), false);
  }
});

test("Report rejects missing manual proof for done-only work and still permits verified lightweight delivery", (t) => {
  const f = fixture(t),
    p = f.plan();
  const item = f.ok("backlog", "show", "repo", p.mapping.a);
  f.ok(
    "backlog",
    "update",
    "repo",
    item.id,
    "--status",
    "done",
    "--expected-revision",
    item.revision,
  );
  const missing = f.cli("report", "create", "repo", p.id);
  assert.equal(missing.code, 1);
  assert.match(missing.value.error, /--verification.*repo:/);
  const report = f.ok(
    "report",
    "create",
    "repo",
    p.id,
    "--verification",
    "Fixture content inspected: code.txt exists",
  ).report;
  assert.equal(report.outcome, "completed");
});

test("Report refuses changed evidence, requires explicit partial acceptance and never presents damaged checks as passing", (t) => {
  const f = fixture(t),
    p = f.plan(),
    a = f.create(p.mapping.a);
  assert.equal(f.submit(a, [finish, check, accept], ["--accept"]).code, 0);
  const c = context(f.workspace, "repo"),
    saved = readAttempt(c.root, a.id, "repo");
  writeFileSync(path.join(c.root, saved.verifications[0]!.evidence_ref), "changed");
  assert.equal(f.cli("report", "create", "repo", p.id).code, 1);
  assert.equal(existsSync(path.join(f.workspace, "ops/repo/reports/report-delivery.md")), false);
  assert.equal(
    f.cli(
      "report",
      "create",
      "repo",
      p.id,
      "--partial-acceptance",
      "fixture accepts damaged evidence",
    ).code,
    1,
  );
  const partial = f.ok(
    "report",
    "create",
    "repo",
    p.id,
    "--partial-acceptance",
    "fixture accepts damaged evidence",
    "--verification",
    "Inspection found changed evidence; delivery remains partial",
  ).report;
  assert.equal(partial.outcome, "partial");
  assert.equal(
    partial.verification.some((s: string) => s.includes("check 1: passed")),
    false,
  );
  assert.ok(partial.deviations.some((s: string) => s.includes("repo:")));
});
