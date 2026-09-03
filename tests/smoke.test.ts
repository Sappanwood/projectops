import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

// Runs the built CLI as a real subprocess: the closest thing to a user invocation.
const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const CLI = path.join(REPO_ROOT, "dist", "cli.js");

function pops(cwd: string, args: string[]): { code: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

test("end-to-end smoke: init, register, backlog bootstrap and CRUD", () => {
  const ws = mkdtempSync(path.join(tmpdir(), "pops-smoke-"));

  let r = pops(ws, ["init"]);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(existsSync(path.join(ws, ".pops", "workspace.json")));

  mkdirSync(path.join(ws, "app"));
  r = pops(ws, ["project", "add", "app"]);
  assert.equal(r.code, 0, r.stderr);

  r = pops(ws, ["project", "list", "--json"]);
  assert.equal(r.code, 0, r.stderr);
  const projects = JSON.parse(r.stdout) as { projects: { id: string }[] };
  assert.deepEqual(projects.projects, [{ id: "app", path: "app" }]);

  r = pops(ws, ["backlog", "init", "app"]);
  assert.equal(r.code, 0, r.stderr);

  r = pops(ws, [
    "backlog", "add", "app",
    "-T", "Smoke task", "-c", "feature", "--priority", "P1", "-b", "smoke body",
  ]);
  assert.equal(r.code, 0, r.stderr);

  r = pops(ws, ["backlog", "show", "app", "APP-001", "--json"]);
  assert.equal(r.code, 0, r.stderr);
  const item = JSON.parse(r.stdout) as { title: string; revision: string };
  assert.equal(item.title, "Smoke task");

  r = pops(ws, [
    "backlog", "update", "app", "APP-001",
    "--status", "done", "--expected-revision", item.revision,
  ]);
  assert.equal(r.code, 0, r.stderr);

  r = pops(ws, ["backlog", "list", "app", "--status", "done", "--json"]);
  assert.equal(r.code, 0, r.stderr);
  const done = JSON.parse(r.stdout) as { items: unknown[] };
  assert.equal(done.items.length, 1);

  r = pops(ws, ["project", "doctor", "--json"]);
  assert.equal(r.code, 0, r.stderr);
  const doctor = JSON.parse(r.stdout) as { ok: boolean; problems: unknown[] };
  assert.equal(doctor.ok, true);
  assert.deepEqual(doctor.problems, []);

  const itemFile = readFileSync(path.join(ws, "ops", "app", "backlog", "items", "APP-001.md"), "utf8");
  assert.match(itemFile, /status: done/);
});
