import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { runCli } from "../src/app.js";
import { showExecution } from "../src/application/executionApi.js";
import {
  ExecutionRuntime,
  type RunnerContext,
  type RunnerResult,
} from "../src/execution/runtime.js";
function setup() {
  const workspaceDir = mkdtempSync(path.join(tmpdir(), "progress-"));
  const run = (args: string[]) =>
    assert.equal(runCli(args, { stdout() {}, stderr() {} }, workspaceDir), 0);
  run(["init"]);
  mkdirSync(path.join(workspaceDir, "repo"));
  run(["project", "add", "repo"]);
  run(["backlog", "init", "repo"]);
  for (const title of ["First", "Second"])
    run([
      "backlog",
      "add",
      "repo",
      "-T",
      title,
      "-c",
      "feature",
      "--priority",
      "P1",
      "-b",
      "Acceptance",
    ]);
  execFileSync("git", ["init"], { cwd: path.join(workspaceDir, "repo"), stdio: "ignore" });
  return { workspaceDir, projectId: "repo", itemId: "REP-001" };
}
function data<T>(result: { ok: true; data: T } | { ok: false; error: unknown }): T {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw Error();
  return result.data;
}
test("runtime persists synchronous progress, resolves repo, steers with revisions and retains history", async () => {
  const q = setup();
  let context!: RunnerContext;
  let end!: (result: RunnerResult) => void;
  const messages: string[] = [];
  const runtime = new ExecutionRuntime({
    start(_attempt, c) {
      context = c;
      c.emit({ type: "session", text: "session-1" });
      c.emit({ type: "text", text: "Working" });
      return {
        completion: new Promise((resolve) => (end = resolve)),
        stop() {},
        steer(message) {
          messages.push(message);
          c.emit({ type: "text", text: "Understood" });
        },
      };
    },
  });
  let a = data(runtime.start(q)).attempt;
  assert.equal(context.repo, path.join(q.workspaceDir, "repo"));
  assert.equal(a.progress?.session_id, "session-1");
  assert.equal(a.progress?.events.at(-1)?.text, "Working");
  assert.equal(
    (await runtime.steer({ ...q, attemptId: a.id, expectedRevision: "stale", message: "wrong" }))
      .ok,
    false,
  );
  a = data(
    await runtime.steer({
      ...q,
      attemptId: a.id,
      expectedRevision: a.revision,
      message: "Focus on acceptance",
    }),
  ).attempt;
  assert.deepEqual(messages, ["Focus on acceptance"]);
  assert(a.progress?.events.some((e) => e.text.includes("Focus on acceptance")));
  assert.equal(a.progress?.events.at(-1)?.text, "Understood");
  end({ outcome: "succeeded", summary: "Finished" });
  await new Promise((resolve) => setImmediate(resolve));
  a = data(showExecution({ ...q, attemptId: a.id })).attempt;
  assert.equal(a.state, "succeeded");
  assert.equal(a.progress?.session_id, "session-1");
  assert.equal(
    (
      await runtime.steer({
        ...q,
        attemptId: a.id,
        expectedRevision: a.revision,
        message: "too late",
      })
    ).ok,
    false,
  );
});
test("another task cannot run in the same repo, including unconfirmed old work", () => {
  const q = setup();
  const runtime = new ExecutionRuntime({
    start() {
      return { completion: new Promise(() => {}), stop() {} };
    },
  });
  const a = data(runtime.start(q)).attempt;
  assert.equal(data(runtime.start(q)).attempt.id, a.id);
  assert.equal(runtime.start({ ...q, itemId: "REP-002" }).ok, false);
  const restarted = new ExecutionRuntime({
    start() {
      throw Error("must not start");
    },
  });
  restarted.recover(q);
  assert.equal(restarted.start({ ...q, itemId: "REP-002" }).ok, false);
});
test("progress is bounded and stale runner events cannot mutate ended attempts", async () => {
  const q = setup();
  let emit!: RunnerContext["emit"];
  let end!: (result: RunnerResult) => void;
  const runtime = new ExecutionRuntime({
    start(_a, c) {
      emit = c.emit;
      return { completion: new Promise((resolve) => (end = resolve)), stop() {} };
    },
  });
  const a = data(runtime.start(q)).attempt;
  for (let i = 0; i < 205; i++) emit({ type: "text", text: `${i}:` + "x".repeat(9000) });
  let latest = data(showExecution({ ...q, attemptId: a.id })).attempt;
  assert(latest.progress!.events.length <= 200);
  assert(latest.progress!.events.every((e) => e.text.length <= 8000));
  end({ outcome: "failed", summary: "Failed" });
  await new Promise((resolve) => setImmediate(resolve));
  latest = data(showExecution({ ...q, attemptId: a.id })).attempt;
  emit({ type: "text", text: "late" });
  assert.equal(data(showExecution({ ...q, attemptId: a.id })).attempt.revision, latest.revision);
});
test("instruction rejection and delivery failure do not report success", async () => {
  const q = setup();
  let deliveries = 0;
  const runtime = new ExecutionRuntime({
    start() {
      return {
        completion: new Promise(() => {}),
        stop() {},
        steer() {
          deliveries++;
          throw Error("delivery failed");
        },
      };
    },
  });
  const a = data(runtime.start(q)).attempt;
  for (const message of ["", " ".repeat(3), "x".repeat(8001)]) {
    assert.equal(
      (await runtime.steer({ ...q, attemptId: a.id, expectedRevision: a.revision, message })).ok,
      false,
    );
  }
  assert.equal(deliveries, 0);
  assert.equal(
    (
      await runtime.steer({
        ...q,
        attemptId: a.id,
        expectedRevision: a.revision,
        message: "Review first",
      })
    ).ok,
    false,
  );
  assert.equal(deliveries, 1);
  assert(
    data(showExecution({ ...q, attemptId: a.id })).attempt.progress?.events.some(
      (e) => e.text === "Instruction requested: Review first",
    ),
  );
  const restarted = new ExecutionRuntime();
  const current = data(showExecution({ ...q, attemptId: a.id })).attempt;
  assert.equal(
    (
      await restarted.steer({
        ...q,
        attemptId: a.id,
        expectedRevision: current.revision,
        message: "Lost handle",
      })
    ).ok,
    false,
  );
});
test("continuous progress keeps controls usable while instruction and lifecycle changes invalidate stale controls", async () => {
  const q = setup();
  let emit!: RunnerContext["emit"];
  const messages: string[] = [];
  let stops = 0;
  const runtime = new ExecutionRuntime({
    start(_a, c) {
      emit = c.emit;
      return {
        completion: new Promise(() => {}),
        stop() {
          stops++;
        },
        steer(message) {
          messages.push(message);
          emit({ type: "text", text: "Continuing" });
        },
      };
    },
  });
  const a = data(runtime.start(q)).attempt;
  for (let i = 0; i < 10; i++) emit({ type: "text", text: `Progress ${i}` });
  assert.equal(data(showExecution({ ...q, attemptId: a.id })).attempt.progress?.events.length, 1);
  assert.match(
    data(showExecution({ ...q, attemptId: a.id })).attempt.progress!.events[0]!.text,
    /Progress 0.*Progress 9/,
  );
  assert.equal(data(showExecution({ ...q, attemptId: a.id })).attempt.revision, a.revision);
  const steered = data(
    await runtime.steer({
      ...q,
      attemptId: a.id,
      expectedRevision: a.revision,
      message: "Keep scope",
    }),
  ).attempt;
  assert.notEqual(steered.revision, a.revision);
  assert.equal(
    (
      await runtime.steer({
        ...q,
        attemptId: a.id,
        expectedRevision: a.revision,
        message: "Stale instruction",
      })
    ).ok,
    false,
  );
  for (let i = 0; i < 10; i++) emit({ type: "tool", text: `Tool ${i}` });
  const stopped = data(
    runtime.stop({ ...q, attemptId: a.id, expectedRevision: steered.revision }),
  ).attempt;
  assert.equal(stopped.state, "stop_requested");
  assert.notEqual(stopped.revision, steered.revision);
  assert.equal(stops, 1);
  assert.deepEqual(messages, ["Keep scope"]);
  assert.equal(
    runtime.stop({ ...q, attemptId: a.id, expectedRevision: steered.revision }).ok,
    false,
  );
  assert.equal(
    (
      await runtime.steer({
        ...q,
        attemptId: a.id,
        expectedRevision: stopped.revision,
        message: "After stop",
      })
    ).ok,
    false,
  );
});
