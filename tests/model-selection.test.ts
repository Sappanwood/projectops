import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runCli } from "../src/app.js";
import { startWorkbenchServer } from "../src/server/workbenchServer.js";
import type { Runner, RunnerResult } from "../src/execution/runtime.js";

test("model catalog and task starts validate and freeze selection without changing active work", async () => {
  const workspaceDir = mkdtempSync(path.join(tmpdir(), "pops-models-"));
  const cli = (...args: string[]) => {
    const output: string[] = [];
    assert.equal(
      runCli(
        [...args, "--json"],
        { stdout: (s) => output.push(s), stderr: (s) => output.push(s) },
        workspaceDir,
      ),
      0,
    );
    return JSON.parse(output.join(""));
  };
  cli("init");
  mkdirSync(path.join(workspaceDir, "repo"));
  cli("project", "add", "repo");
  cli("backlog", "init", "repo");
  execFileSync("git", ["init", "-q"], { cwd: path.join(workspaceDir, "repo") });
  const { item } = cli(
    "backlog",
    "add",
    "repo",
    "-T",
    "Select model",
    "-c",
    "feature",
    "--priority",
    "P1",
  );
  const models = [
    { provider: "fixture", id: "one", name: "One" },
    { provider: "fixture", id: "two", name: "Two" },
  ];
  const received: unknown[] = [];
  let finish: ((result: RunnerResult) => void) | undefined;
  const runner: Runner = {
    async listModels() {
      return models;
    },
    async resolveModel(_repo, selected) {
      return selected ?? { provider: "fixture", id: "one" };
    },
    start(attempt) {
      received.push(attempt.input.model);
      return {
        completion: new Promise((resolve) => {
          finish = resolve;
        }),
        stop() {},
      };
    },
  };
  const server = await startWorkbenchServer({ workspaceDir, port: 0, runner });
  const post = (model: unknown, retryOf?: string) =>
    fetch(`${server.origin}/api/projects/repo/executions/start`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: server.origin },
      body: JSON.stringify({
        item_id: item.id,
        expected_revision: item.revision,
        model,
        ...(retryOf ? { retry_of: retryOf } : {}),
      }),
    });
  try {
    const catalog = await (await fetch(`${server.origin}/api/models`)).json();
    assert.deepEqual(catalog.data, { available: true, models });
    assert.equal((await post({ provider: "fixture", id: "missing" })).status, 400);
    assert.equal((await post({ provider: "fixture", id: "one", apiKey: "secret" })).status, 400);
    const first = await (await post(null)).json();
    assert.deepEqual(first.data.attempt.input.model, { provider: "fixture", id: "one" });
    const again = await (await post({ provider: "fixture", id: "two" })).json();
    assert.equal(again.data.attempt.id, first.data.attempt.id);
    assert.deepEqual(received, [{ provider: "fixture", id: "one" }]);
    finish?.({ outcome: "stopped", summary: "first ended" });
    await new Promise((resolve) => setImmediate(resolve));
    const next = await (
      await post({ provider: "fixture", id: "two" }, first.data.attempt.id)
    ).json();
    assert.deepEqual(next.data.attempt.input.model, { provider: "fixture", id: "two" });
    assert.deepEqual(received, [
      { provider: "fixture", id: "one" },
      { provider: "fixture", id: "two" },
    ]);
  } finally {
    finish?.({ outcome: "stopped", summary: "cleanup" });
    await new Promise((resolve) => setImmediate(resolve));
    await server.close();
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});
