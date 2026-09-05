import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
  renameSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { runCli } from "../src/app.js";
import {
  createExecution,
  finishExecution,
  verifyExecution,
  decideExecution,
  showExecution,
  listExecutions,
} from "../src/application/executionApi.js";
import { ExecutionRuntime, type Runner } from "../src/execution/runtime.js";
function setup() {
  const workspaceDir = mkdtempSync(path.join(tmpdir(), "execution-"));
  const run = (args: string[]) =>
    assert.equal(runCli(args, { stdout() {}, stderr() {} }, workspaceDir), 0);
  run(["init"]);
  mkdirSync(path.join(workspaceDir, "repo"));
  run(["project", "add", "repo"]);
  run(["backlog", "init", "repo"]);
  run([
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
  ]);
  execFileSync("git", ["init"], { cwd: path.join(workspaceDir, "repo"), stdio: "ignore" });
  writeFileSync(path.join(workspaceDir, "repo", "code.txt"), "initial");
  return { workspaceDir, projectId: "repo", itemId: "REP-001" };
}
function data<T>(
  r:
    | {
        ok: true;
        data: T;
      }
    | {
        ok: false;
        error: unknown;
      },
): T {
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) throw Error();
  return r.data;
}
test("execution freezes input, retains retry history, verifies and explicitly accepts current snapshot", () => {
  const q = setup();
  const first = data(createExecution(q)).attempt;
  assert.equal(first.input.item.body.trim(), "Acceptance");
  const failed = data(
    finishExecution({
      ...q,
      attemptId: first.id,
      expectedRevision: first.revision,
      outcome: "failed",
      summary: "failure",
    }),
  ).attempt;
  const next = data(createExecution({ ...q, retryOf: failed.id })).attempt;
  assert.equal(next.execution_id, first.execution_id);
  assert.equal(next.retry_of, first.id);
  const ended = data(
    finishExecution({
      ...q,
      attemptId: next.id,
      expectedRevision: next.revision,
      outcome: "succeeded",
      summary: "implemented",
    }),
  ).attempt;
  const checked = data(
    verifyExecution({
      ...q,
      attemptId: ended.id,
      expectedRevision: ended.revision,
      command: "fixture check",
      outcome: "passed",
      evidence: "passed assertions",
    }),
  ).attempt;
  writeFileSync(path.join(q.workspaceDir, "repo", "code.txt"), "changed");
  assert.equal(
    decideExecution({
      ...q,
      attemptId: checked.id,
      expectedRevision: checked.revision,
      decision: "accepted",
      note: "",
    }).ok,
    false,
  );
  const rechecked = data(
    verifyExecution({
      ...q,
      attemptId: checked.id,
      expectedRevision: checked.revision,
      command: "fixture check",
      outcome: "passed",
      evidence: "passed again",
    }),
  ).attempt;
  const accepted = data(
    decideExecution({
      ...q,
      attemptId: checked.id,
      expectedRevision: rechecked.revision,
      decision: "accepted",
      note: "reviewed",
    }),
  ).attempt;
  assert.equal(accepted.acceptance?.decision, "accepted");
  assert.equal(data(listExecutions(q)).attempts.length, 2);
});
test("missing evidence and failed verification cannot be accepted; rework remains recorded", () => {
  const q = setup();
  let a = data(createExecution(q)).attempt;
  a = data(
    finishExecution({
      ...q,
      attemptId: a.id,
      expectedRevision: a.revision,
      outcome: "succeeded",
      summary: "done",
    }),
  ).attempt;
  a = data(
    verifyExecution({
      ...q,
      attemptId: a.id,
      expectedRevision: a.revision,
      command: "check",
      outcome: "failed",
      evidence: "failed",
    }),
  ).attempt;
  assert.equal(
    decideExecution({
      ...q,
      attemptId: a.id,
      expectedRevision: a.revision,
      decision: "accepted",
      note: "",
    }).ok,
    false,
  );
  a = data(
    verifyExecution({
      ...q,
      attemptId: a.id,
      expectedRevision: a.revision,
      command: "check",
      outcome: "passed",
      evidence: "passed",
    }),
  ).attempt;
  rmSync(
    path.join(q.workspaceDir, "ops", "repo", "executions", a.verifications.at(-1)!.evidence_ref),
  );
  assert.equal(data(showExecution({ ...q, attemptId: a.id })).diagnostics.length, 1);
  assert.equal(
    decideExecution({
      ...q,
      attemptId: a.id,
      expectedRevision: a.revision,
      decision: "accepted",
      note: "",
    }).ok,
    false,
  );
  a = data(
    decideExecution({
      ...q,
      attemptId: a.id,
      expectedRevision: a.revision,
      decision: "rework",
      note: "fix",
    }),
  ).attempt;
  assert.equal(a.acceptance?.decision, "rework");
  assert.equal(createExecution({ ...q, retryOf: a.id }).ok, true);
});
test("runtime owns work across reconnect, duplicate start, stop confirmation and restart uncertainty", async () => {
  const q = setup();
  let resolve!: (r: { outcome: "stopped"; summary: string }) => void;
  let stopped = false;
  const runner: Runner = {
    start() {
      return {
        completion: new Promise((r) => (resolve = r)),
        stop() {
          stopped = true;
        },
      };
    },
  };
  const runtime = new ExecutionRuntime(runner);
  const a = data(runtime.start(q)).attempt;
  assert.equal(data(runtime.start(q)).attempt.id, a.id);
  assert.equal(data(showExecution({ ...q, attemptId: a.id })).attempt.state, "running");
  assert.equal(
    data(runtime.stop({ ...q, attemptId: a.id, expectedRevision: a.revision })).attempt.state,
    "stop_requested",
  );
  assert.equal(stopped, true);
  resolve({ outcome: "stopped", summary: "confirmed" });
  await new Promise((r) => setImmediate(r));
  assert.equal(data(showExecution({ ...q, attemptId: a.id })).attempt.state, "stopped");
  const b = data(runtime.start({ ...q, retryOf: a.id })).attempt;
  const restarted = new ExecutionRuntime(runner);
  restarted.recover(q);
  assert.equal(data(showExecution({ ...q, attemptId: b.id })).attempt.state, "unknown");
  assert.equal(restarted.start({ ...q, retryOf: b.id }).ok, false);
  assert.equal(
    restarted.confirmInterrupted({
      ...q,
      attemptId: b.id,
      expectedRevision: data(showExecution({ ...q, attemptId: b.id })).attempt.revision,
      note: "checked process stopped",
    }).ok,
    true,
  );
  assert.equal(new ExecutionRuntime().start(q).ok, false);
});
test("verification cannot hide failed checks and task revision must match start", () => {
  const q = setup();
  assert.equal(createExecution({ ...q, expectedRevision: "stale" }).ok, false);
  let a = data(createExecution(q)).attempt;
  a = data(
    finishExecution({
      ...q,
      attemptId: a.id,
      expectedRevision: a.revision,
      outcome: "succeeded",
      summary: "done",
    }),
  ).attempt;
  a = data(
    verifyExecution({
      ...q,
      attemptId: a.id,
      expectedRevision: a.revision,
      command: "test",
      outcome: "failed",
      evidence: "failure",
    }),
  ).attempt;
  a = data(
    verifyExecution({
      ...q,
      attemptId: a.id,
      expectedRevision: a.revision,
      command: "build",
      outcome: "passed",
      evidence: "success",
    }),
  ).attempt;
  assert.equal(
    decideExecution({
      ...q,
      attemptId: a.id,
      expectedRevision: a.revision,
      decision: "accepted",
      note: "",
    }).ok,
    false,
  );
  a = data(
    verifyExecution({
      ...q,
      attemptId: a.id,
      expectedRevision: a.revision,
      command: "test",
      outcome: "passed",
      evidence: "fixed",
    }),
  ).attempt;
  const accepted = data(
    decideExecution({
      ...q,
      attemptId: a.id,
      expectedRevision: a.revision,
      decision: "accepted",
      note: "",
    }),
  ).attempt;
  assert.equal(
    decideExecution({
      ...q,
      attemptId: a.id,
      expectedRevision: accepted.revision,
      decision: "rework",
      note: "",
    }).ok,
    false,
  );
});
test("acceptance keeps empty-evidence diagnostics and ignores checks from older snapshots", (t) => {
  const q = setup();
  t.after(() => rmSync(q.workspaceDir, { recursive: true, force: true }));
  let attempt = data(createExecution(q)).attempt;
  attempt = data(
    finishExecution({
      ...q,
      attemptId: attempt.id,
      expectedRevision: attempt.revision,
      outcome: "succeeded",
      summary: "done",
    }),
  ).attempt;
  const accept = () =>
    decideExecution({
      ...q,
      attemptId: attempt.id,
      expectedRevision: attempt.revision,
      decision: "accepted",
      note: "reviewed",
    });
  assert.deepEqual(accept(), {
    ok: false,
    error: {
      code: "EXECUTION_CONFLICT",
      message: "Acceptance requires successful execution and readable passing evidence.",
    },
  });
  attempt = data(
    verifyExecution({
      ...q,
      attemptId: attempt.id,
      expectedRevision: attempt.revision,
      command: "old check",
      outcome: "failed",
      evidence: "old failure",
    }),
  ).attempt;
  assert.deepEqual(accept(), {
    ok: false,
    error: {
      code: "EXECUTION_CONFLICT",
      message: "All current verification commands must pass with readable evidence.",
    },
  });
  writeFileSync(path.join(q.workspaceDir, "repo", "code.txt"), "new snapshot");
  attempt = data(
    verifyExecution({
      ...q,
      attemptId: attempt.id,
      expectedRevision: attempt.revision,
      command: "new check",
      outcome: "passed",
      evidence: "new snapshot passed",
    }),
  ).attempt;
  assert.equal(data(accept()).attempt.acceptance?.decision, "accepted");
});
test("runner failure is durable and external work is not recovered by a service owner", async () => {
  const q = setup();
  const runtime = new ExecutionRuntime({
    start() {
      return { completion: Promise.reject(Error("fixture")), stop() {} };
    },
  });
  const a = data(runtime.start(q)).attempt;
  await new Promise((r) => setImmediate(r));
  assert.equal(data(showExecution({ ...q, attemptId: a.id })).attempt.state, "failed");
  const external = data(createExecution({ ...q, retryOf: a.id })).attempt;
  runtime.recover(q);
  assert.equal(data(showExecution({ ...q, attemptId: external.id })).attempt.state, "running");
});
test("CLI creation rejects stale task revisions", () => {
  const q = setup();
  const output: string[] = [];
  assert.equal(
    runCli(
      ["execution", "create", q.projectId, q.itemId, "--expected-revision", "stale", "--json"],
      { stdout: (m) => output.push(m), stderr: (m) => output.push(m) },
      q.workspaceDir,
    ),
    1,
  );
  assert.match(output.join("\n"), /REVISION_MISMATCH/);
  assert.equal(data(listExecutions(q)).attempts.length, 0);
});
test("attempt scope and state corruption are rejected by reads and mutations", () => {
  const q = setup();
  const a = data(createExecution(q)).attempt;
  const file = path.join(q.workspaceDir, "ops", "repo", "executions", `${a.id}.json`);
  for (const broken of [
    { ...a, project_id: "other" },
    { ...a, input: { ...a.input, item: { ...a.input.item, id: "REP-999" } } },
    { ...a, state: "typo" },
    { ...a, revision: null },
    { ...a, started_at: 0 },
    { ...a, acceptance: { decision: "maybe" } },
  ]) {
    writeFileSync(file, JSON.stringify(broken));
    assert.equal(showExecution({ ...q, attemptId: a.id }).ok, false);
    assert.equal(listExecutions(q).ok, false);
    assert.equal(
      finishExecution({
        ...q,
        attemptId: a.id,
        expectedRevision: a.revision,
        outcome: "succeeded",
        summary: "done",
      }).ok,
      false,
    );
  }
});
test("changed evidence is diagnosed and cannot authorize acceptance", () => {
  const q = setup();
  let a = data(createExecution(q)).attempt;
  a = data(
    finishExecution({
      ...q,
      attemptId: a.id,
      expectedRevision: a.revision,
      outcome: "succeeded",
      summary: "done",
    }),
  ).attempt;
  a = data(
    verifyExecution({
      ...q,
      attemptId: a.id,
      expectedRevision: a.revision,
      command: "check",
      outcome: "passed",
      evidence: "original output",
    }),
  ).attempt;
  writeFileSync(
    path.join(q.workspaceDir, "ops", "repo", "executions", a.verifications[0]!.evidence_ref),
    "replacement output",
  );
  assert.equal(data(showExecution({ ...q, attemptId: a.id })).diagnostics.length, 1);
  assert.equal(
    decideExecution({
      ...q,
      attemptId: a.id,
      expectedRevision: a.revision,
      decision: "accepted",
      note: "",
    }).ok,
    false,
  );
});
test("a retried attempt cannot complete the task while successor work exists", () => {
  const q = setup();
  let a = data(createExecution(q)).attempt;
  a = data(
    finishExecution({
      ...q,
      attemptId: a.id,
      expectedRevision: a.revision,
      outcome: "succeeded",
      summary: "done",
    }),
  ).attempt;
  a = data(
    verifyExecution({
      ...q,
      attemptId: a.id,
      expectedRevision: a.revision,
      command: "check",
      outcome: "passed",
      evidence: "passed",
    }),
  ).attempt;
  data(createExecution({ ...q, retryOf: a.id }));
  assert.equal(
    decideExecution({
      ...q,
      attemptId: a.id,
      expectedRevision: a.revision,
      decision: "accepted",
      note: "",
    }).ok,
    false,
  );
});
test("acceptance rejects backlog root, item and index symlinks outside declared workspace", () => {
  for (const target of ["backlog", "item", "index"]) {
    const q = setup();
    let a = data(createExecution(q)).attempt;
    a = data(
      finishExecution({
        ...q,
        attemptId: a.id,
        expectedRevision: a.revision,
        outcome: "succeeded",
        summary: "done",
      }),
    ).attempt;
    a = data(
      verifyExecution({
        ...q,
        attemptId: a.id,
        expectedRevision: a.revision,
        command: "check",
        outcome: "passed",
        evidence: "passed",
      }),
    ).attempt;
    const root = path.join(q.workspaceDir, "ops", "repo", "backlog");
    const source =
      target === "backlog"
        ? root
        : target === "item"
          ? path.join(root, "items", `${q.itemId}.md`)
          : path.join(root, "INDEX.md");
    const outside = path.join(mkdtempSync(path.join(tmpdir(), "execution-outside-")), "target");
    renameSync(source, outside);
    symlinkSync(outside, source);
    const item =
      target === "backlog"
        ? path.join(outside, "items", `${q.itemId}.md`)
        : target === "item"
          ? outside
          : path.join(root, "items", `${q.itemId}.md`);
    const before = readFileSync(item, "utf8");
    assert.equal(
      decideExecution({
        ...q,
        attemptId: a.id,
        expectedRevision: a.revision,
        decision: "accepted",
        note: "",
      }).ok,
      false,
      target,
    );
    assert.equal(readFileSync(item, "utf8"), before);
  }
});
test("code snapshots refuse a repository symlink outside workspace", () => {
  const q = setup();
  const a = data(createExecution(q)).attempt;
  const repo = path.join(q.workspaceDir, "repo");
  const outside = path.join(mkdtempSync(path.join(tmpdir(), "execution-repo-outside-")), "repo");
  renameSync(repo, outside);
  symlinkSync(outside, repo);
  assert.equal(
    finishExecution({
      ...q,
      attemptId: a.id,
      expectedRevision: a.revision,
      outcome: "succeeded",
      summary: "done",
    }).ok,
    false,
  );
});
