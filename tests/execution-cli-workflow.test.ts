import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { runCli } from "../src/app.js";
import { createExecution } from "../src/application/executionApi.js";
import { createNodeWorkspace, createRunWorkspace } from "../src/planRun/worktrees.js";

function fixture(t: TestContext) {
  const workspace = mkdtempSync(path.join(tmpdir(), "pops-check-"));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  const cli = (...args: string[]) => {
    const stdout: string[] = [],
      stderr: string[] = [];
    const code = runCli(
      args,
      { stdout: (s) => stdout.push(s), stderr: (s) => stderr.push(s) },
      workspace,
    );
    const output = stdout.join("\n");
    return { code, output, stderr: stderr.join("\n"), value: output ? JSON.parse(output) : null };
  };
  const ok = (...args: string[]) => {
    const result = cli(...args, "--json");
    assert.equal(result.code, 0, result.output + result.stderr);
    return result.value;
  };
  ok("init");
  const repo = path.join(workspace, "repo");
  mkdirSync(repo);
  execFileSync("git", ["init", "-q"], { cwd: repo });
  writeFileSync(path.join(repo, "code.txt"), "initial\n".repeat(1000));
  ok("project", "add", "repo");
  ok("backlog", "init", "repo");
  const item = ok(
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
  const create = () => ok("execution", "create", "repo", item.id).data.attempt;
  const finish = (a: { id: string; revision: string }) =>
    ok(
      "execution",
      "finish",
      "repo",
      a.id,
      "--outcome",
      "succeeded",
      "--summary",
      "Implemented",
      "--expected-revision",
      a.revision,
    ).data.attempt;
  const check = (a: { id: string; revision: string }, argv: string[], extra: string[] = []) =>
    cli(
      "execution",
      "check",
      "repo",
      a.id,
      "--expected-revision",
      a.revision,
      "--view",
      "summary",
      "--json",
      ...extra,
      "--",
      ...argv,
    );
  const show = (id: string) => ok("execution", "show", "repo", id).data.attempt;
  const accept = (a: { id: string; revision: string }) =>
    cli(
      "execution",
      "accept",
      "repo",
      a.id,
      "--expected-revision",
      a.revision,
      "--note",
      "Reviewed",
      "--json",
    );
  const evidence = (ref: string) =>
    JSON.parse(readFileSync(path.join(workspace, "ops/repo/executions", ref), "utf8"));
  return { workspace, repo, cli, ok, item, create, finish, check, show, accept, evidence };
}

test("summary receipts retain revisions, diagnostics and evidence without repeating snapshots", (t) => {
  const f = fixture(t);
  let a = f.finish(f.create());
  const file = path.join(f.workspace, "output.txt");
  writeFileSync(file, "passed");
  const checked = f.ok(
    "execution",
    "verify",
    "repo",
    a.id,
    "--expected-revision",
    a.revision,
    "--command",
    "test",
    "--outcome",
    "passed",
    "--evidence-file",
    file,
    "--view",
    "summary",
  );
  assert.equal(checked.data.view, "summary");
  assert.equal(checked.data.attempt.input, undefined);
  assert.equal(checked.data.attempt.snapshot, undefined);
  assert.equal(checked.data.attempt.verification.total, 1);
  assert.equal(checked.data.attempt.verification.failed, 0);
  assert.ok(checked.data.attempt.verification.latest.evidence_ref);
  a = f.show(a.id);
  assert.equal(checked.data.attempt.revision, a.revision);
  assert.ok(a.snapshot.diff.includes("initial"));
  const summary = f.ok("execution", "show", "repo", a.id, "--view", "summary");
  assert.ok(
    JSON.stringify(summary).length <
      JSON.stringify({ ok: true, data: { attempt: a, diagnostics: [] } }).length / 4,
  );
  const listed = f.ok("execution", "list", "repo", "--view", "summary");
  assert.equal(listed.data.attempts[0].revision, a.revision);
  writeFileSync(
    path.join(f.workspace, "ops/repo/executions", a.verifications[0].evidence_ref),
    "tampered",
  );
  assert.equal(
    f.ok("execution", "show", "repo", a.id, "--view", "summary").data.diagnostics.length,
    1,
  );
  assert.equal(f.accept(a).code, 1);
});

test("check captures real argv, cwd, both streams and evidence, then permits separate acceptance", (t) => {
  const f = fixture(t);
  const a = f.finish(f.create());
  const script =
    "console.log(JSON.stringify({cwd:process.cwd(),args:process.argv.slice(1)}));console.error('diagnostic')";
  const argv = [
    process.execPath,
    "-e",
    script,
    "--",
    "--help",
    "--version",
    "--json",
    "$(echo untouched)",
  ];
  const checked = f.check(a, argv);
  assert.equal(checked.code, 0, checked.output);
  assert.equal(checked.value.data.check.outcome, "passed");
  assert.equal(checked.value.data.check.exit_code, 0);
  const body = f.evidence(checked.value.data.check.evidence_ref);
  assert.deepEqual(body.argv, argv);
  assert.equal(body.cwd, f.repo);
  assert.equal(JSON.parse(body.stdout).cwd, f.repo);
  assert.deepEqual(JSON.parse(body.stdout).args, argv.slice(4));
  assert.match(body.stderr, /diagnostic/);
  assert.equal(body.before_digest, body.after_digest);
  assert.equal(f.show(a.id).acceptance, null);
  assert.equal(f.accept(checked.value.data.attempt).code, 0);
});

test("check persists nonzero exits and spawn errors as failures, without accepting", (t) => {
  const f = fixture(t);
  let a = f.finish(f.create());
  for (const argv of [
    [process.execPath, "-e", "console.error('broken');process.exit(7)"],
    ["/missing/pops-check-program"],
  ]) {
    const r = f.check(a, argv);
    assert.equal(r.code, 1, r.output);
    assert.equal(r.value.ok, true);
    assert.equal(r.value.data.check.outcome, "failed");
    const body = f.evidence(r.value.data.check.evidence_ref);
    assert.ok(body.exit_code === 7 || body.error?.code === "ENOENT");
    a = f.show(a.id);
    assert.equal(f.accept(a).code, 1);
  }
});

test("stale revisions, active attempts and invalid options reject before executing argv", (t) => {
  const f = fixture(t);
  const active = f.create();
  const marker = path.join(f.repo, "ran");
  const argv = [process.execPath, "-e", "require('node:fs').writeFileSync('ran','yes')"];
  assert.equal(f.check(active, argv).code, 1);
  const a = f.finish(active);
  for (const extra of [
    ["--view", "invalid"],
    ["--timeout-ms", "0"],
    ["--outcome", "passed"],
    ["--command", "fake"],
  ]) {
    assert.equal(f.check(a, argv, extra).code, 1);
  }
  assert.equal(f.check({ ...a, revision: "stale" }, argv).value.error.code, "REVISION_MISMATCH");
  assert.equal(existsSync(marker), false);
  assert.equal(f.show(a.id).revision, a.revision);
});

test("code changes during a check are recorded as failed even if the command exits zero", (t) => {
  const f = fixture(t);
  const a = f.finish(f.create());
  const r = f.check(a, [
    process.execPath,
    "-e",
    "require('node:fs').writeFileSync('code.txt','changed')",
  ]);
  assert.equal(r.code, 1, r.output);
  assert.equal(r.value.data.check.snapshot_changed, true);
  assert.equal(r.value.data.check.exit_code, 0);
  assert.equal(f.accept(f.show(a.id)).code, 1);
});

test("timeouts and output overflow are failures with durable diagnostics", (t) => {
  const f = fixture(t);
  let a = f.finish(f.create());
  const timeout = f.check(
    a,
    [process.execPath, "-e", "setInterval(()=>{},1000)"],
    ["--timeout-ms", "100"],
  );
  assert.equal(timeout.code, 1, timeout.output);
  assert.equal(f.evidence(timeout.value.data.check.evidence_ref).error.code, "ETIMEDOUT");
  a = f.show(a.id);
  const overflow = f.check(a, [
    process.execPath,
    "-e",
    "process.stdout.write('x'.repeat(20*1024*1024))",
  ]);
  assert.equal(overflow.code, 1, overflow.output);
  assert.equal(f.evidence(overflow.value.data.check.evidence_ref).output_incomplete, true);
});

test("revision changes during execution preserve detached evidence and do not overwrite the newer attempt", (t) => {
  const f = fixture(t);
  const a = f.finish(f.create());
  const record = path.join(f.workspace, "ops/repo/executions", `${a.id}.json`);
  const script =
    "const fs=require('node:fs');const p=process.argv[1];const a=JSON.parse(fs.readFileSync(p));a.revision='0123456789abcdef';a.summary='concurrent';fs.writeFileSync(p,JSON.stringify(a));console.log('completed')";
  const result = f.check(a, [process.execPath, "-e", script, record]);
  assert.equal(result.code, 1, result.output);
  assert.equal(result.value.error.code, "REVISION_MISMATCH");
  assert.match(result.value.error.message, /evidence\//);
  assert.equal(f.show(a.id).summary, "concurrent");
  assert.equal(f.show(a.id).verifications.length, 0);
});

test("check resolves managed checkout and later code changes still invalidate acceptance", (t) => {
  const f = fixture(t);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: f.repo, encoding: "utf8" }).trim();
  git("config", "user.name", "Check Fixture");
  git("config", "user.email", "check@example.invalid");
  git("add", ".");
  git("commit", "-qm", "Base");
  const runId = "run-00000000-0000-4000-8000-000000000001";
  const run = createRunWorkspace({
    workspaceDir: f.workspace,
    repo: f.repo,
    runId,
    baseCommit: git("rev-parse", "HEAD"),
  });
  const node = createNodeWorkspace(run, "check");
  const created = createExecution(
    { workspaceDir: f.workspace, projectId: "repo", itemId: f.item.id },
    { run_id: runId, node_id: "check" },
  );
  assert.ok(created.ok);
  const a = f.finish(created.data.attempt);
  const checked = f.check(a, [process.execPath, "-e", "console.log(process.cwd())"]);
  assert.equal(checked.code, 0, checked.output);
  assert.equal(f.evidence(checked.value.data.check.evidence_ref).cwd, node.dir);
  writeFileSync(path.join(node.dir, "code.txt"), "changed after verification");
  assert.equal(f.accept(f.show(a.id)).code, 1);
});
