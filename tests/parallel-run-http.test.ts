import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runCli } from "../src/app.js";
import { startWorkbenchServer } from "../src/server/workbenchServer.js";
import type { RunnerResult } from "../src/execution/runtime.js";

test("parallel HTTP freezes server-selected base and commands, rejects browser commands and dispatches isolated tasks", async () => {
  const workspaceDir = mkdtempSync(path.join(tmpdir(), "pops-parallel-http-"));
  const cli = (...args: string[]) => {
    const output: string[] = [];
    assert.equal(
      runCli(args, { stdout: (s) => output.push(s), stderr: (s) => output.push(s) }, workspaceDir),
      0,
      output.join(""),
    );
    return JSON.parse(output.join(""));
  };
  cli("init", "--json");
  mkdirSync(path.join(workspaceDir, "repo"));
  cli("project", "add", "repo", "--json");
  cli("backlog", "init", "repo", "--json");
  const repo = path.join(workspaceDir, "repo");
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.com",
      "commit",
      "--allow-empty",
      "-qm",
      "Initial",
    ],
    { cwd: repo },
  );
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
  const draft = path.join(workspaceDir, "draft.json");
  writeFileSync(
    draft,
    JSON.stringify({
      title: "Parallel HTTP",
      goal: "Run isolated tasks",
      execution_policy: { max_parallel: 2 },
      items: [1, 2].map((n) => ({
        key: `step${n}`,
        title: `Step ${n}`,
        item_type: "task",
        priority: "P1",
        body: "Implement and verify",
        depends_on: [],
        parallel: true,
        resources: [`module${n}`],
      })),
    }),
  );
  const { plan } = cli("plan", "create", "repo", "--input", draft, "--json");
  cli("plan", "approve", "repo", plan.id, "--review-note", "Reviewed", "--json");
  cli("plan", "materialize", "repo", plan.id, "--json");
  const checkouts: string[] = [],
    finishes: ((result: RunnerResult) => void)[] = [];
  const commands = [[process.execPath, "-e", "process.exit(0)"]];
  let server = await startWorkbenchServer({
    workspaceDir,
    port: 0,
    parallelCommands: commands,
    runner: {
      start(_attempt, context) {
        checkouts.push(context.repo);
        return { completion: new Promise((resolve) => finishes.push(resolve)), stop() {} };
      },
    },
  });
  let base = `${server.origin}/api/projects/repo/parallel-runs`;
  const post = (suffix: string, body: unknown, origin = server.origin) =>
    fetch(`${base}${suffix}`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    const shown = await (await fetch(`${server.origin}/api/projects/repo/plans/${plan.id}`)).json();
    const input = { plan_id: plan.id, expected_revision: shown.data.revision };
    assert.equal((await post("", input, "https://example.com")).status, 403);
    assert.equal(
      (await post("", { ...input, commands: [["sh", "-c", "echo unsafe"]] })).status,
      400,
    );
    assert.equal((await post("", { ...input, base_commit: head })).status, 400);
    assert.equal((await post("", { ...input, expected_revision: "stale" })).status, 409);
    const created = await post("", input);
    assert.equal(created.status, 200);
    const run = (await created.json()).data.run;
    assert.equal(checkouts.length, 0);
    assert.equal(run.workspace.baseCommit, head);
    assert.deepEqual(run.commands, commands);
    const advanced = await post(`/${run.id}/advance`, { expected_revision: run.revision });
    assert.equal(advanced.status, 200);
    assert.equal(checkouts.length, 2);
    assert.notEqual(checkouts[0], checkouts[1]);
    assert.ok(
      checkouts.every((checkout) => checkout !== repo && checkout.startsWith(workspaceDir)),
    );
    const running = (await advanced.json()).data.run;
    const paused = await post(`/${run.id}/pause`, { expected_revision: running.revision });
    assert.equal(paused.status, 200);
    const after = (await paused.json()).data.run;
    assert.equal(after.state, "paused");
    assert.equal(
      (await post(`/${run.id}/rework`, { expected_revision: after.revision, node_key: "step1" }))
        .status,
      400,
    );
    assert.equal(
      (
        await post(`/${run.id}/rework`, {
          expected_revision: after.revision,
          node_key: "step1",
          note: "Do not rework active attempts",
        })
      ).status,
      409,
    );
    const list = await (await fetch(`${base}?plan_id=${plan.id}`)).json();
    assert.equal(list.data.runs.length, 1);
    assert.equal(
      (
        await post(`/${run.id}/land`, {
          expected_revision: after.revision,
          node_key: "step1",
          command: "anything",
        })
      ).status,
      400,
    );
    assert.equal(
      (await post(`/${run.id}/land`, { expected_revision: after.revision, node_key: "step1" }))
        .status,
      409,
    );
    await server.close();
    server = await startWorkbenchServer({ workspaceDir, port: 0 });
    base = `${server.origin}/api/projects/repo/parallel-runs`;
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const recovered = (await (await fetch(`${base}/${run.id}`)).json()).data.run;
    assert.equal(recovered.state, "paused");
    assert.equal(
      recovered.nodes.filter((node: { state: string }) => node.state === "unknown").length,
      2,
    );
    assert.equal(checkouts.length, 2);
    assert.equal(
      (
        await post(`/${run.id}/resume`, {
          expected_revision: recovered.revision,
          note: "Unknown attempts must not replay",
        })
      ).status,
      409,
    );
    assert.deepEqual(recovered.commands, commands);
  } finally {
    for (const finish of finishes) finish({ outcome: "stopped", summary: "Cleanup" });
    await new Promise((resolve) => setImmediate(resolve));
    await server.close();
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});
