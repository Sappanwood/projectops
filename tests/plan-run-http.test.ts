import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runCli } from "../src/app.js";
import { startWorkbenchServer } from "../src/server/workbenchServer.js";
import type { RunnerResult } from "../src/execution/runtime.js";

test("Plan run HTTP creates frozen run, guards mutations and pauses future dispatch", async () => {
  const workspaceDir = mkdtempSync(path.join(tmpdir(), "pops-plan-run-http-"));
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
  execFileSync("git", ["init", "-q"], { cwd: path.join(workspaceDir, "repo") });
  const draft = path.join(workspaceDir, "draft.json");
  writeFileSync(
    draft,
    JSON.stringify({
      title: "Serial HTTP",
      goal: "Run tasks in order",
      items: [1, 2].map((n) => ({
        key: `step${n}`,
        title: `Step ${n}`,
        item_type: "task",
        priority: "P1",
        body: "Implement and verify",
        depends_on: n === 1 ? [] : ["step1"],
      })),
    }),
  );
  const { plan } = cli("plan", "create", "repo", "--input", draft, "--json");
  cli("plan", "approve", "repo", plan.id, "--review-note", "Reviewed", "--json");
  cli("plan", "materialize", "repo", plan.id, "--json");
  let starts = 0,
    stops = 0;
  let finish!: (result: RunnerResult) => void;
  let server = await startWorkbenchServer({
    workspaceDir,
    port: 0,
    runner: {
      start() {
        starts++;
        return {
          completion: new Promise((resolve) => {
            finish = resolve;
          }),
          stop() {
            stops++;
          },
        };
      },
    },
  });
  let base = `${server.origin}/api/projects/repo/plan-runs`;
  const post = (suffix: string, body: unknown, origin = server.origin) =>
    fetch(`${base}${suffix}`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    const shown = await (await fetch(`${server.origin}/api/projects/repo/plans/${plan.id}`)).json();
    const input = {
      plan_id: plan.id,
      expected_revision: shown.data.revision,
      instructions: "Inspect existing implementation without changing code",
    };
    assert.equal((await post("", input, "https://example.com")).status, 403);
    assert.equal((await post("", { plan_id: plan.id })).status, 400);
    assert.equal((await post("", { ...input, workspace: "/tmp" })).status, 400);
    assert.equal((await post("", { ...input, expected_revision: "stale" })).status, 409);
    const created = await post("", input);
    assert.equal(created.status, 200);
    const run = (await created.json()).data.run;
    assert.equal(run.instructions, input.instructions);
    assert.equal(starts, 0);
    const advanced = await post(`/${run.id}/advance`, { expected_revision: run.revision });
    assert.equal(advanced.status, 200);
    assert.equal(starts, 1);
    const running = (await advanced.json()).data.run;
    assert.equal((await post(`/${run.id}/pause`, { expected_revision: "stale" })).status, 409);
    const paused = await post(`/${run.id}/pause`, { expected_revision: running.revision });
    assert.equal(paused.status, 200);
    assert.equal((await paused.json()).data.run.state, "paused");
    assert.equal(stops, 0);
    const list = await (await fetch(`${base}?plan_id=${plan.id}`)).json();
    assert.equal(list.data.runs.length, 1);
    assert.equal(list.data.runs[0].state, "paused");
    await server.close();
    server = await startWorkbenchServer({ workspaceDir, port: 0 });
    base = `${server.origin}/api/projects/repo/plan-runs`;
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const recovered = (await (await fetch(`${base}/${run.id}`)).json()).data.run;
    assert.equal(recovered.state, "paused");
    assert.equal(recovered.nodes[0].state, "unknown");
    assert.equal(starts, 1);
    assert.equal(
      (
        await post(`/${run.id}/resume`, {
          expected_revision: recovered.revision,
          note: "Cannot replay unknown work",
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await post(`/${run.id}/close-stopped`, {
          expected_revision: recovered.revision,
          note: "Cannot close unknown work",
        })
      ).status,
      409,
    );
    const attemptId = recovered.nodes[0].attempt_ids[0];
    const executionUrl = `${server.origin}/api/projects/repo/executions/${attemptId}`;
    const attempt = (await (await fetch(executionUrl)).json()).data.attempt;
    const confirmed = await fetch(`${executionUrl}/confirm-interrupted`, {
      method: "POST",
      headers: { origin: server.origin, "content-type": "application/json" },
      body: JSON.stringify({
        expected_revision: attempt.revision,
        note: "Inspected the old controlled runner and confirmed stopped",
      }),
    });
    assert.equal(confirmed.status, 200);
    const latest = (await (await fetch(`${base}/${run.id}`)).json()).data.run;
    const closed = await post(`/${run.id}/close-stopped`, {
      expected_revision: latest.revision,
      note: "End frozen scope after inspection",
    });
    assert.equal(closed.status, 200);
    assert.equal((await closed.json()).data.run.state, "stopped");
    const planFile = path.join(workspaceDir, "ops/repo/plans", `${plan.id}.json`);
    const revised = JSON.parse(readFileSync(planFile, "utf8"));
    revised.goal = "New scope after ending old run";
    writeFileSync(planFile, JSON.stringify(revised));
    const frozen = (await (await fetch(`${base}/${run.id}`)).json()).data.run;
    assert.equal(frozen.plan_snapshot.goal, "Run tasks in order");
    assert.equal(frozen.state, "stopped");
  } finally {
    finish?.({ outcome: "stopped", summary: "Cleanup" });
    await new Promise((resolve) => setImmediate(resolve));
    await server.close();
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});
