import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

function setupWorkspace(): string {
  const ws = freshDir();
  assert.equal(run(["init"], ws).code, 0);
  mkdirSync(path.join(ws, "repo-a"));
  mkdirSync(path.join(ws, "repo-b"));
  assert.equal(run(["project", "add", "repo-a"], ws).code, 0);
  assert.equal(run(["project", "add", "repo-b"], ws).code, 0);
  return ws;
}

test("project list reports registered projects as stable JSON", () => {
  const ws = setupWorkspace();

  const { code, stdout } = run(["project", "list", "--json"], ws);

  assert.equal(code, 0);
  const result = JSON.parse(stdout[0] ?? "null") as {
    ok: boolean;
    projects: { id: string; path: string }[];
  };
  assert.equal(result.ok, true);
  assert.deepEqual(result.projects, [
    { id: "repo-a", path: "repo-a" },
    { id: "repo-b", path: "repo-b" },
  ]);
});

test("project list shows an empty list for a fresh workspace", () => {
  const ws = freshDir();
  assert.equal(run(["init"], ws).code, 0);

  const { code, stdout } = run(["project", "list", "--json"], ws);

  assert.equal(code, 0);
  const result = JSON.parse(stdout[0] ?? "null") as { ok: boolean; projects: unknown[] };
  assert.deepEqual(result.projects, []);
});

test("project list works in human-readable mode", () => {
  const ws = setupWorkspace();

  const { code, stdout } = run(["project", "list"], ws);

  assert.equal(code, 0);
  assert.ok(stdout.some((line) => line.includes("repo-a")));
  assert.ok(stdout.some((line) => line.includes("repo-b")));
});

test("project doctor reports a healthy workspace", () => {
  const ws = setupWorkspace();

  const { code, stdout } = run(["project", "doctor", "--json"], ws);

  assert.equal(code, 0);
  const result = JSON.parse(stdout[0] ?? "null") as { ok: boolean; problems: unknown[] };
  assert.equal(result.ok, true);
  assert.deepEqual(result.problems, []);
});

test("project doctor detects missing artifact roots", () => {
  const ws = setupWorkspace();
  rmSync(path.join(ws, "ops", "repo-a", "backlog"), { recursive: true, force: true });

  const { code, stdout } = run(["project", "doctor", "--json"], ws);

  assert.equal(code, 1);
  const result = JSON.parse(stdout[0] ?? "null") as {
    ok: boolean;
    problems: { project: string; issue: string }[];
  };
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.project === "repo-a" && /backlog/.test(p.issue)));
});

test("project doctor detects a missing project directory", () => {
  const ws = setupWorkspace();
  rmSync(path.join(ws, "repo-b"), { recursive: true, force: true });

  const { code, stdout } = run(["project", "doctor", "--json"], ws);

  assert.equal(code, 1);
  const result = JSON.parse(stdout[0] ?? "null") as {
    ok: boolean;
    problems: { project: string; issue: string }[];
  };
  assert.ok(result.problems.some((p) => p.project === "repo-b"));
});

test("project doctor detects typed artifact mismatches", () => {
  const ws = setupWorkspace();
  const manifestFile = path.join(ws, ".pops", "workspace.json");
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as {
    artifact_layout: { roots: Record<string, string> };
  };
  manifest.artifact_layout.roots.backlog = "wrong/type@1";
  delete manifest.artifact_layout.roots.reports;
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const { code, stdout } = run(["project", "doctor", "--json"], ws);

  assert.equal(code, 1);
  const result = JSON.parse(stdout[0] ?? "null") as {
    ok: boolean;
    problems: { project: string; issue: string }[];
  };
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((problem) => /backlog.*type/i.test(problem.issue)));
  assert.ok(result.problems.some((problem) => /reports.*type/i.test(problem.issue)));
});

test("project doctor rejects artifact files in place of directories", () => {
  const ws = setupWorkspace();
  const backlogRoot = path.join(ws, "ops", "repo-a", "backlog");
  rmSync(backlogRoot, { recursive: true, force: true });
  writeFileSync(backlogRoot, "not a directory", "utf8");

  const { code, stdout } = run(["project", "doctor", "--json"], ws);

  assert.equal(code, 1);
  const result = JSON.parse(stdout[0] ?? "null") as {
    problems: { project: string; issue: string }[];
  };
  assert.ok(result.problems.some((problem) => /backlog.*not a directory/i.test(problem.issue)));
});

test("project list fails clearly on a broken manifest", () => {
  const ws = freshDir();
  assert.equal(run(["init"], ws).code, 0);
  writeFileSync(path.join(ws, ".pops", "workspace.json"), "{not json", "utf8");

  const { code, stderr } = run(["project", "list"], ws);

  assert.equal(code, 1);
  assert.match(stderr.join("\n"), /manifest/i);
});

test("project list fails clearly on a structurally incomplete manifest", () => {
  const ws = freshDir();
  assert.equal(run(["init"], ws).code, 0);
  writeFileSync(
    path.join(ws, ".pops", "workspace.json"),
    `${JSON.stringify({ schema: "workspace/Manifest@1", name: "broken" })}\n`,
    "utf8",
  );

  const { code, stderr } = run(["project", "list"], ws);

  assert.equal(code, 1);
  assert.match(stderr.join("\n"), /manifest/i);
});

test("project list fails clearly outside a workspace", () => {
  const outside = freshDir();

  const { code, stderr } = run(["project", "list"], outside);

  assert.equal(code, 1);
  assert.match(stderr.join("\n"), /workspace/i);
});
