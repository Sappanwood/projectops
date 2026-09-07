import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runCli } from "../src/app.js";
import {
  freezeDependency,
  validateFrozenDependency,
} from "../src/application/dependencyReadiness.js";
import {
  createExecution,
  finishExecution,
  verifyExecution,
  decideExecution,
  showExecution,
} from "../src/application/executionApi.js";
import { createParallelRun, ParallelRunRuntime } from "../src/application/parallelRunApi.js";
import { computePlanRevision } from "../src/application/planRevision.js";
import type { ApplicationResult } from "../src/application/result.js";
import type { ExecutionAttempt } from "../src/execution/attempt.js";
import { ExecutionRuntime, type RunnerResult } from "../src/execution/runtime.js";
import { readPlan } from "../src/plan/planFs.js";
import type { ParallelRun } from "../src/planRun/parallelRun.js";

function data<T>(result: ApplicationResult<T>): T {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw Error();
  return result.data;
}
const git = (repo: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
function fixture(t: test.TestContext, parallel = false) {
  const workspaceDir = mkdtempSync(path.join(tmpdir(), "dependency-evidence-"));
  t.after(() => rmSync(workspaceDir, { recursive: true, force: true }));
  const cli = (args: string[]) => {
    const output: string[] = [];
    assert.equal(
      runCli(
        [...args, "--json"],
        { stdout: (value) => output.push(value), stderr: (value) => output.push(value) },
        workspaceDir,
      ),
      0,
      output.join("\n"),
    );
    return JSON.parse(output[0]!);
  };
  cli(["init"]);
  const repo = path.join(workspaceDir, "mochi");
  mkdirSync(repo);
  cli(["project", "add", "mochi"]);
  cli(["backlog", "init", "mochi"]);
  git(repo, "init", "-q");
  git(repo, "config", "user.name", "Fixture");
  git(repo, "config", "user.email", "fixture@example.invalid");
  writeFileSync(path.join(repo, "base.txt"), "base");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "Base");
  if (!parallel) cli(["backlog", "add", "mochi", "-T", "API", "-c", "feature", "--priority", "P1"]);
  const q = { workspaceDir, projectId: "mochi", itemId: "MOC-001" };
  const reference = { project: "mochi", item: "MOC-001" };
  const verify = (attempt: ExecutionAttempt) =>
    data(
      verifyExecution({
        ...q,
        attemptId: attempt.id,
        expectedRevision: attempt.revision,
        command: "fixture check",
        outcome: "passed",
        evidence: "Checked submitted API",
      }),
    ).attempt;
  const accept = (attempt: ExecutionAttempt) =>
    data(
      decideExecution({
        ...q,
        attemptId: attempt.id,
        expectedRevision: attempt.revision,
        decision: "accepted",
        note: "Reviewed API",
      }),
    ).attempt;
  const succeed = () => {
    const attempt = data(createExecution(q)).attempt;
    return data(
      finishExecution({
        ...q,
        attemptId: attempt.id,
        expectedRevision: attempt.revision,
        outcome: "succeeded",
        summary: "Implemented API",
      }),
    ).attempt;
  };
  const freeze = () => freezeDependency(workspaceDir, reference);
  return { workspaceDir, repo, q, reference, cli, verify, accept, succeed, freeze };
}

test("succeeded attempt plus manual done cannot substitute for accepted durable evidence", (t) => {
  const f = fixture(t);
  f.succeed();
  const itemFile = path.join(f.workspaceDir, "ops/mochi/backlog/items/MOC-001.md");
  const source = readFileSync(itemFile, "utf8");
  assert.match(source, /status: todo/);
  writeFileSync(itemFile, source.replace("status: todo", "status: done"));
  assert.throws(f.freeze, /mochi:MOC-001.*accepted/);
});

test("accepted dependency survives unrelated upstream commits but rejects input and verification drift", (t) => {
  const f = fixture(t);
  const attempt = f.accept(f.verify(f.succeed()));
  const frozen = f.freeze();
  assert.equal(frozen.basis, "accepted");
  assert.equal(frozen.attempt_id, attempt.id);
  writeFileSync(path.join(f.repo, "unrelated.txt"), "unrelated feature");
  git(f.repo, "add", ".");
  git(f.repo, "commit", "-qm", "Unrelated feature");
  assert.doesNotThrow(() => validateFrozenDependency(f.workspaceDir, frozen));
  const itemFile = path.join(f.workspaceDir, "ops/mochi/backlog/items/MOC-001.md");
  const original = readFileSync(itemFile, "utf8");
  writeFileSync(itemFile, original + "\nChanged API contract\n");
  assert.throws(() => validateFrozenDependency(f.workspaceDir, frozen), /mochi:MOC-001/);
  writeFileSync(itemFile, original);
  const attemptFile = path.join(f.workspaceDir, "ops/mochi/executions", `${attempt.id}.json`);
  const originalAttempt = readFileSync(attemptFile, "utf8");
  writeFileSync(
    attemptFile,
    JSON.stringify({
      ...attempt,
      acceptance: { ...attempt.acceptance, note: "Replaced accepted basis" },
    }),
  );
  assert.throws(() => validateFrozenDependency(f.workspaceDir, frozen), /frozen evidence changed/);
  writeFileSync(attemptFile, originalAttempt);
  const evidence = path.join(
    f.workspaceDir,
    "ops/mochi/executions",
    attempt.verifications[0]!.evidence_ref,
  );
  writeFileSync(evidence, "Changed validation output");
  assert.throws(() => validateFrozenDependency(f.workspaceDir, frozen), /mochi:MOC-001/);
});

test("parallel dependency requires actual landing and revalidates its durable evidence", async (t) => {
  const f = fixture(t, true);
  const planId = "plan-api";
  const plans = path.join(f.workspaceDir, "ops/mochi/plans");
  writeFileSync(
    path.join(plans, `${planId}.json`),
    JSON.stringify({
      schema: "plan/Plan@1",
      id: planId,
      title: "API",
      goal: "Deploy API",
      status: "approved",
      approval: { approved_at: new Date().toISOString(), review_note: "Reviewed" },
      execution_policy: { max_parallel: 2 },
      items: [
        {
          key: "api",
          title: "API",
          item_type: "task",
          priority: "P1",
          body: "Implement API",
          depends_on: [],
          parallel: true,
        },
      ],
    }),
  );
  f.cli(["plan", "materialize", "mochi", planId]);
  let finish!: (result: RunnerResult) => void;
  const execution = new ExecutionRuntime({
    start() {
      return {
        completion: new Promise((resolve) => {
          finish = resolve;
        }),
        stop() {},
      };
    },
  });
  const scheduler = new ParallelRunRuntime(execution);
  const mutation = (run: ParallelRun) => ({
    ...f.q,
    runId: run.id,
    expectedRevision: run.revision,
  });
  let run = data(
    createParallelRun({
      ...f.q,
      planId,
      expectedRevision: computePlanRevision(readPlan(plans, planId)),
      baseCommit: git(f.repo, "rev-parse", "HEAD"),
      commands: [[process.execPath, "-e", "process.exit(0)"]],
    }),
  ).run;
  run = data(scheduler.advance(mutation(run))).run;
  const node = run.nodes[0]!;
  const checkout = node.workspace!.dir;
  writeFileSync(path.join(checkout, "api.txt"), "API implemented");
  git(checkout, "add", ".");
  git(checkout, "commit", "-qm", "Implement API");
  finish({ outcome: "succeeded", summary: "API submitted" });
  await new Promise((resolve) => setImmediate(resolve));
  f.accept(f.verify(data(showExecution({ ...f.q, attemptId: node.attempt_ids[0]! })).attempt));
  run = data(scheduler.advance(mutation(run))).run;
  assert.equal(run.nodes[0]!.state, "awaiting_landing");
  assert.throws(f.freeze, /mochi:MOC-001.*landed/);
  run = data(await scheduler.land({ ...mutation(run), nodeKey: "api" })).run;
  assert.equal(run.nodes[0]!.state, "landed");
  const frozen = f.freeze();
  assert.equal(frozen.basis, "landed");
  assert.ok(frozen.landing_digest);
  assert.doesNotThrow(() => validateFrozenDependency(f.workspaceDir, frozen));
  const integrationRef = run.workspace.integrationRef;
  const tip = git(f.repo, "rev-parse", integrationRef);
  const beforeLanding = git(f.repo, "rev-parse", "HEAD");
  git(f.repo, "update-ref", integrationRef, beforeLanding);
  assert.throws(() => validateFrozenDependency(f.workspaceDir, frozen), /mochi:MOC-001/);
  git(f.repo, "update-ref", "-d", integrationRef);
  assert.throws(() => validateFrozenDependency(f.workspaceDir, frozen), /mochi:MOC-001/);
  const descendant = git(
    f.repo,
    "commit-tree",
    `${tip}^{tree}`,
    "-p",
    tip,
    "-m",
    "Later integration work",
  );
  git(f.repo, "update-ref", integrationRef, descendant);
  assert.doesNotThrow(() => validateFrozenDependency(f.workspaceDir, frozen));
  writeFileSync(path.join(f.repo, "unrelated-after-landing.txt"), "Unrelated branch work");
  git(f.repo, "add", ".");
  git(f.repo, "commit", "-qm", "Unrelated HEAD work");
  assert.doesNotThrow(() => validateFrozenDependency(f.workspaceDir, frozen));
  writeFileSync(run.nodes[0]!.landings[0]!.evidenceFile, "Changed landing evidence");
  assert.throws(() => validateFrozenDependency(f.workspaceDir, frozen), /mochi:MOC-001/);
});
