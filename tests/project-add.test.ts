import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { runCli } from "../src/app.js";

const ROOT_KEYS = ["backlog", "plans", "reports", "adr", "research"];

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

function initWorkspace(dir: string): void {
  assert.equal(run(["init"], dir).code, 0);
}

function readManifest(dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(dir, ".pops", "workspace.json"), "utf8")) as Record<
    string,
    unknown
  >;
}

test("project add registers a subdirectory and creates artifact roots", () => {
  const ws = freshDir();
  initWorkspace(ws);
  mkdirSync(path.join(ws, "repo-a"));

  const { code, stderr } = run(["project", "add", "repo-a"], ws);

  assert.equal(code, 0);
  assert.deepEqual(stderr, []);
  const manifest = readManifest(ws);
  assert.deepEqual(manifest.projects, { "repo-a": { path: "repo-a" } });
  for (const key of ROOT_KEYS) {
    assert.ok(existsSync(path.join(ws, "ops", "repo-a", key)));
  }
});

test("project add accepts absolute paths and non-git directories", () => {
  const ws = freshDir();
  initWorkspace(ws);
  const target = path.join(ws, "docs-only");
  mkdirSync(target);
  writeFileSync(path.join(target, "notes.md"), "# notes\n", "utf8");

  const { code } = run(["project", "add", target], ws);

  assert.equal(code, 0);
  const manifest = readManifest(ws);
  assert.deepEqual(manifest.projects, { "docs-only": { path: "docs-only" } });
});

test("project add rejects paths outside the workspace", () => {
  const ws = freshDir();
  initWorkspace(ws);
  const outside = freshDir();
  const before = readManifest(ws);

  const { code, stderr } = run(["project", "add", outside], ws);

  assert.equal(code, 1);
  assert.match(stderr.join("\n"), /outside/i);
  assert.deepEqual(readManifest(ws), before);
  assert.equal(existsSync(path.join(ws, "ops")), false);
});

test("project add rejects duplicate registration", () => {
  const ws = freshDir();
  initWorkspace(ws);
  mkdirSync(path.join(ws, "repo-a"));
  assert.equal(run(["project", "add", "repo-a"], ws).code, 0);
  const before = readManifest(ws);

  const { code, stderr } = run(["project", "add", path.join(ws, "repo-a")], ws);

  assert.equal(code, 1);
  assert.match(stderr.join("\n"), /already/i);
  assert.deepEqual(readManifest(ws), before);
});

test("project add rejects two different paths with the same basename", () => {
  const ws = freshDir();
  initWorkspace(ws);
  mkdirSync(path.join(ws, "group-a"));
  mkdirSync(path.join(ws, "group-b"));
  mkdirSync(path.join(ws, "group-a", "shared"));
  mkdirSync(path.join(ws, "group-b", "shared"));

  assert.equal(run(["project", "add", "group-a/shared"], ws).code, 0);
  const { code, stderr } = run(["project", "add", "group-b/shared"], ws);

  assert.equal(code, 1);
  assert.match(stderr.join("\n"), /already/i);
});

test("project add requires a workspace", () => {
  const outside = freshDir();
  mkdirSync(path.join(outside, "repo-a"));

  const { code, stderr } = run(["project", "add", "repo-a"], outside);

  assert.equal(code, 1);
  assert.match(stderr.join("\n"), /workspace/i);
});

test("project add works from a nested cwd and normalizes relative paths", () => {
  const ws = freshDir();
  initWorkspace(ws);
  mkdirSync(path.join(ws, "repo-a"));
  mkdirSync(path.join(ws, "repo-a", "deep"));

  const { code } = run(["project", "add", ".."], path.join(ws, "repo-a", "deep"));

  assert.equal(code, 0);
  const manifest = readManifest(ws);
  assert.deepEqual(manifest.projects, { "repo-a": { path: "repo-a" } });
});

test("project add cannot register the workspace root itself", () => {
  const ws = freshDir();
  initWorkspace(ws);

  const { code, stderr } = run(["project", "add", "."], ws);

  assert.equal(code, 1);
  assert.match(stderr.join("\n"), /workspace root/i);
});

test("project add --json emits a stable machine-readable result", () => {
  const ws = freshDir();
  initWorkspace(ws);
  mkdirSync(path.join(ws, "repo-a"));

  const { code, stdout } = run(["project", "add", "repo-a", "--json"], ws);

  assert.equal(code, 0);
  const result = JSON.parse(stdout[0] ?? "null") as {
    ok: boolean;
    project: { id: string; path: string; roots: Record<string, string> };
  };
  assert.equal(result.ok, true);
  assert.equal(result.project.id, "repo-a");
  assert.equal(result.project.path, "repo-a");
  assert.equal(result.project.roots.backlog, "ops/repo-a/backlog");
});
