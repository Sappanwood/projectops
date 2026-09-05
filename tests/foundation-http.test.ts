import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import type { RunnerResult } from "../src/execution/runtime.js";
import { runCli } from "../src/app.js";
import { startWorkbenchServer } from "../src/server/workbenchServer.js";

function setup() {
  const workspaceDir = mkdtempSync(path.join(tmpdir(), "pops-foundation-http-"));
  const cli = (...args: string[]) => {
    const stdout: string[] = [],
      stderr: string[] = [];
    assert.equal(
      runCli(args, { stdout: (s) => stdout.push(s), stderr: (s) => stderr.push(s) }, workspaceDir),
      0,
      stderr.join("\n"),
    );
    return JSON.parse(stdout.join("\n"));
  };
  cli("init", "--json");
  mkdirSync(path.join(workspaceDir, "repo"));
  cli("project", "add", "repo", "--json");
  cli("backlog", "init", "repo", "--json");
  const { item } = cli(
    "backlog",
    "add",
    "repo",
    "-T",
    "Original",
    "-c",
    "feature",
    "--priority",
    "P1",
    "-b",
    "Original requirements",
    "--json",
  );
  return { workspaceDir, cli, item };
}

test("HTTP task content editing preserves stale input and rejects mixed mutations", async () => {
  const { workspaceDir, item } = setup();
  const server = await startWorkbenchServer({ workspaceDir, port: 0 });
  const url = `${server.origin}/api/projects/repo/backlog/${item.id}`;
  const patch = (body: unknown, origin = server.origin) =>
    fetch(url, {
      method: "PATCH",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify(body),
    });
  try {
    const updated = await patch({
      title: "Revised",
      body: "New acceptance criteria",
      expected_revision: item.revision,
    });
    assert.equal(updated.status, 200);
    assert.equal((await updated.json()).data.result.title, "Revised");
    assert.equal((await patch({ body: "Stale", expected_revision: item.revision })).status, 409);
    assert.equal(
      (await patch({ title: "Mixed", status: "done", expected_revision: item.revision })).status,
      400,
    );
    assert.equal(
      (
        await patch(
          { title: "Wrong origin", expected_revision: item.revision },
          "https://example.com",
        )
      ).status,
      403,
    );
    assert.equal((await patch({ body: "Missing revision" })).status, 400);
    const current = await (await fetch(url)).json();
    assert.equal(current.data.item.body.trim(), "New acceptance criteria");
  } finally {
    await server.close();
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("HTTP execution control survives reconnect, blocks duplicate starts and confirms interruption", async () => {
  const { workspaceDir, item } = setup();
  const repo = path.join(workspaceDir, "repo");
  execFileSync("git", ["init", "-q"], { cwd: repo });
  writeFileSync(path.join(repo, "work.txt"), "Initial work");
  let starts = 0,
    stops = 0;
  let finish!: (result: RunnerResult) => void;
  const runner = {
    start() {
      starts++;
      return {
        completion: new Promise<RunnerResult>((resolve) => {
          finish = resolve;
        }),
        stop() {
          stops++;
        },
      };
    },
  };
  let server = await startWorkbenchServer({ workspaceDir, port: 0, runner });
  const endpoint = () => `${server.origin}/api/projects/repo/executions`;
  const post = (suffix: string, body: unknown) =>
    fetch(`${endpoint()}${suffix}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: server.origin },
      body: JSON.stringify(body),
    });
  try {
    const input = {
      item_id: item.id,
      expected_revision: item.revision,
      instructions: "Controlled test",
    };
    const started = await post("/start", input);
    assert.equal(started.status, 200);
    const attempt = (await started.json()).data.attempt;
    assert.equal((await (await post("/start", input)).json()).data.attempt.id, attempt.id);
    assert.equal(starts, 1);
    const list = await (await fetch(`${endpoint()}?item_id=${item.id}`)).json();
    assert.equal(list.data.attempts[0].id, attempt.id);
    assert.equal(list.data.runner_available, true);
    const stopped = await post(`/${attempt.id}/stop`, { expected_revision: attempt.revision });
    assert.equal(stopped.status, 200);
    assert.equal((await stopped.json()).data.attempt.state, "stop_requested");
    assert.equal(stops, 1);
    finish({ outcome: "stopped", summary: "Stop confirmed" });
    await new Promise((resolve) => setImmediate(resolve));
    const shown = await (await fetch(`${endpoint()}/${attempt.id}`)).json();
    assert.equal(shown.data.attempt.state, "stopped");
    assert.equal((await post("/start", { ...input, retry_of: attempt.id })).status, 200);
    await server.close();
    server = await startWorkbenchServer({ workspaceDir, port: 0 });
    const recovered = await (await fetch(`${endpoint()}?item_id=${item.id}`)).json();
    const unknown = recovered.data.attempts.find((a: { state: string }) => a.state === "unknown");
    assert.ok(unknown);
    assert.equal(recovered.data.runner_available, false);
    assert.equal(
      (
        await post(`/${unknown.id}/confirm-interrupted`, {
          expected_revision: unknown.revision,
          note: "Runner inspected and stopped",
        })
      ).status,
      200,
    );
    assert.equal((await post("/start", { ...input, retry_of: unknown.id })).status, 503);
  } finally {
    await server.close();
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("HTTP Plan revision previews without writing and requires exact confirmation", async () => {
  const { workspaceDir, cli } = setup();
  const draft = {
    title: "Revision HTTP",
    goal: "Before",
    items: [
      {
        key: "work",
        title: "Work",
        item_type: "task",
        priority: "P1",
        body: "Do work",
        depends_on: [],
      },
    ],
  };
  const input = path.join(workspaceDir, "draft.json");
  writeFileSync(input, JSON.stringify(draft));
  const { plan } = cli("plan", "create", "repo", "--input", input, "--json");
  const server = await startWorkbenchServer({ workspaceDir, port: 0 });
  const url = `${server.origin}/api/projects/repo/plans/${plan.id}`;
  const post = (body: unknown) =>
    fetch(`${url}/revision`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: server.origin },
      body: JSON.stringify(body),
    });
  try {
    const shown = await fetch(url);
    assert.equal(shown.status, 200);
    const before = (await shown.json()).data;
    const changed = { ...draft, goal: "After" };
    const preview = await post({ draft: changed, expected_revision: before.revision });
    assert.equal(preview.status, 200);
    const receipt = (await preview.json()).data;
    assert.equal(receipt.applied, false);
    assert.equal((await (await fetch(url)).json()).data.plan.goal, "Before");
    const applied = await post({
      draft: changed,
      expected_revision: before.revision,
      confirm: receipt.confirmation_token,
    });
    assert.equal(applied.status, 200);
    assert.equal((await applied.json()).data.applied, true);
    assert.equal(
      (
        await post({
          draft: changed,
          expected_revision: before.revision,
          confirm: receipt.confirmation_token,
        })
      ).status,
      409,
    );
    assert.equal(
      (await post({ draft: changed, expected_revision: before.revision, workspace: "/tmp/other" }))
        .status,
      400,
    );
  } finally {
    await server.close();
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});
