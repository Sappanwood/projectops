import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { runCli } from "../src/app.js";

function freshDir(): string {
  return mkdtempSync(path.join(tmpdir(), "pops-"));
}

function run(args: string[], cwd: string): { code: number; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = runCli(
    args,
    {
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
    },
    cwd,
  );
  return { code, stdout, stderr };
}

function setupWorkspaceWithProject(): string {
  const ws = freshDir();
  assert.equal(run(["init"], ws).code, 0);
  mkdirSync(path.join(ws, "repo-a"));
  assert.equal(run(["project", "add", "repo-a"], ws).code, 0);
  return ws;
}

function storeDir(ws: string): string {
  return path.join(ws, "ops", "repo-a", "backlog");
}

test("backlog init bootstraps a store for a registered project", () => {
  const ws = setupWorkspaceWithProject();

  const { code, stderr } = run(["backlog", "init", "repo-a"], ws);

  assert.equal(code, 0);
  assert.deepEqual(stderr, []);
  const manifest = JSON.parse(readFileSync(path.join(storeDir(ws), "backlog.json"), "utf8")) as {
    schema: string;
    project_id: string;
    id_prefix: string;
  };
  assert.equal(manifest.schema, "backlog/Store@1");
  assert.equal(manifest.project_id, "repo-a");
  assert.equal(manifest.id_prefix, "REP");
  assert.ok(existsSync(path.join(storeDir(ws), "items")));
  assert.ok(existsSync(path.join(storeDir(ws), "INDEX.md")));
});

test("backlog init refuses to rebuild an existing store", () => {
  const ws = setupWorkspaceWithProject();
  assert.equal(run(["backlog", "init", "repo-a"], ws).code, 0);
  const before = readFileSync(path.join(storeDir(ws), "backlog.json"), "utf8");

  const { code, stderr } = run(["backlog", "init", "repo-a"], ws);

  assert.equal(code, 1);
  assert.match(stderr.join("\n"), /already/i);
  assert.equal(readFileSync(path.join(storeDir(ws), "backlog.json"), "utf8"), before);
});

test("backlog init rejects an unregistered project", () => {
  const ws = setupWorkspaceWithProject();

  const { code, stderr } = run(["backlog", "init", "nope"], ws);

  assert.equal(code, 1);
  assert.match(stderr.join("\n"), /not registered/i);
});

test("backlog init requires a workspace", () => {
  const outside = freshDir();

  const { code, stderr } = run(["backlog", "init", "repo-a"], outside);

  assert.equal(code, 1);
  assert.match(stderr.join("\n"), /workspace/i);
});

test("backlog init --json emits a stable machine-readable result", () => {
  const ws = setupWorkspaceWithProject();

  const { code, stdout } = run(["backlog", "init", "repo-a", "--json"], ws);

  assert.equal(code, 0);
  const result = JSON.parse(stdout[0] ?? "null") as {
    ok: boolean;
    store: { project_id: string; id_prefix: string; root: string };
  };
  assert.equal(result.ok, true);
  assert.equal(result.store.project_id, "repo-a");
  assert.equal(result.store.id_prefix, "REP");
  assert.equal(result.store.root, "ops/repo-a/backlog");
});
