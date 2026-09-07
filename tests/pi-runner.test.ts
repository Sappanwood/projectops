import assert from "node:assert/strict";
import test from "node:test";
import { createPiRunner, type PiSession } from "../src/execution/piRunner.js";
import type { ExecutionAttempt } from "../src/execution/attempt.js";

test("Pi runner freezes task instructions, emits session events and waits for full prompt completion", async () => {
  let settle!: () => void;
  let listener!: (event: unknown) => void;
  let input = "";
  let disposed = false;
  const session: PiSession = {
    sessionId: "session-fixture",
    model: { provider: "fixture", id: "test" },
    subscribe(fn) {
      listener = fn;
      return () => {};
    },
    prompt: async (text) => {
      input = text;
      await new Promise<void>((r) => (settle = r));
    },
    steer: async () => {},
    clearQueue() {},
    abort: async () => {},
    dispose() {
      disposed = true;
    },
    messages: [
      { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Complete" }] },
    ],
  };
  const events: { type: string; text: string }[] = [];
  const runner = createPiRunner(async () => session);
  const attempt = {
    id: "exe-fixture",
    input: { item: { id: "PRO-021", title: "Task", body: "Acceptance" }, instructions: "Extra" },
  } as ExecutionAttempt;
  const handle = runner.start(attempt, {
    repo: "/tmp/repo",
    workspaceDir: "/tmp",
    emit: (e) => events.push(e),
  });
  await new Promise((r) => setImmediate(r));
  assert.match(input, /Acceptance/);
  assert.match(input, /Extra/);
  listener({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "Progress" },
  });
  listener({ type: "agent_end", messages: [] });
  assert.equal(disposed, false);
  assert.ok(events.some((e) => e.type === "session"));
  settle();
  assert.equal((await handle.completion).outcome, "succeeded");
  assert.equal(disposed, true);
  assert.ok(events.some((e) => e.text === "Progress"));
});

test("truncated or absent assistant result fails instead of authorizing success", async () => {
  for (const messages of [[], [{ role: "assistant", stopReason: "length" }]]) {
    const session: PiSession = {
      sessionId: "fixture",
      messages,
      subscribe() {
        return () => {};
      },
      prompt: async () => {},
      steer: async () => {},
      clearQueue() {},
      abort: async () => {},
      dispose() {},
    };
    const attempt = {
      id: "exe-fixture",
      input: { item: { id: "PRO-021", title: "Task", body: "Acceptance" }, instructions: "" },
    } as ExecutionAttempt;
    const result = await createPiRunner(async () => session).start(attempt, {
      repo: "/tmp/repo",
      workspaceDir: "/tmp",
      emit() {},
    }).completion;
    assert.equal(result.outcome, "failed");
  }
});

test("Pi stop clears queued work before abort, and failure never becomes success", async () => {
  const calls: string[] = [];
  let settle!: () => void;
  const session: PiSession = {
    sessionId: "fixture",
    messages: [],
    subscribe() {
      return () => {};
    },
    prompt: async () => new Promise<void>((r) => (settle = r)),
    steer: async (m) => {
      calls.push(m);
    },
    clearQueue() {
      calls.push("clear");
    },
    abort: async () => {
      calls.push("abort");
      settle();
    },
    dispose() {},
  };
  const runner = createPiRunner(async () => session);
  const attempt = {
    id: "exe-fixture",
    input: { item: { id: "PRO-021", title: "Task", body: "Acceptance" }, instructions: "" },
  } as ExecutionAttempt;
  const handle = runner.start(attempt, { repo: "/tmp/repo", workspaceDir: "/tmp", emit() {} });
  await new Promise((r) => setImmediate(r));
  await handle.steer!("More");
  await handle.stop();
  assert.deepEqual(calls, ["More", "clear", "abort"]);
  assert.equal((await handle.completion).outcome, "stopped");
  const broken = createPiRunner(async () => {
    throw Error("private credential text");
  }).start(attempt, { repo: "/tmp/repo", workspaceDir: "/tmp", emit() {} });
  const result = await broken.completion;
  assert.equal(result.outcome, "failed");
  assert.doesNotMatch(result.summary, /private credential/);
});

test("Pi records only marked tool results and fails when evidence cannot be saved", async () => {
  for (const scenario of ["passed", "failed", "unmarked", "missing", "write-failed"] as const) {
    let listener!: (event: unknown) => void;
    const checks: { command: string; outcome: string; evidence: string }[] = [];
    const session: PiSession = {
      sessionId: "verification",
      messages: [
        {
          role: "assistant",
          stopReason: "stop",
          content: [{ type: "text", text: "All tests passed" }],
        },
      ],
      subscribe(fn) {
        listener = fn;
        return () => {};
      },
      async prompt(input) {
        assert.match(input, /projectops-verify/);
        listener({
          type: "tool_execution_start",
          toolName: "bash",
          toolCallId: "t",
          args: { command: scenario === "unmarked" ? "pwd" : "# projectops-verify\nnpm test" },
        });
        if (scenario !== "missing")
          listener({
            type: "tool_execution_end",
            toolName: "bash",
            toolCallId: "t",
            isError: scenario === "failed",
            result: { content: [{ type: "text", text: "actual tool output" }] },
          });
      },
      async steer() {},
      clearQueue() {},
      async abort() {},
      dispose() {},
    };
    const attempt = {
      id: "exe-fixture",
      input: { item: { id: "PRO-064", title: "Task", body: "Acceptance" }, instructions: "" },
    } as ExecutionAttempt;
    const result = await createPiRunner(async () => session).start(attempt, {
      repo: "/tmp/repo",
      workspaceDir: "/tmp",
      emit() {},
      recordVerification(check) {
        if (scenario === "write-failed") throw Error("unavailable");
        checks.push(check);
      },
    }).completion;
    assert.equal(
      result.outcome,
      ["missing", "write-failed"].includes(scenario) ? "failed" : "succeeded",
    );
    assert.equal(checks.length, ["passed", "failed"].includes(scenario) ? 1 : 0);
    if (checks[0]) {
      assert.equal(checks[0].outcome, scenario);
      assert.match(checks[0].evidence, /actual tool output/);
      assert.doesNotMatch(checks[0].evidence, /All tests passed/);
    }
  }
});
