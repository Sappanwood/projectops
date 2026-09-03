import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
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

function setupItem(): { ws: string; revision: string } {
  const ws = freshDir();
  assert.equal(run(["init"], ws).code, 0);
  mkdirSync(path.join(ws, "repo-a"));
  assert.equal(run(["project", "add", "repo-a"], ws).code, 0);
  assert.equal(run(["backlog", "init", "repo-a"], ws).code, 0);
  const added = run(
    ["backlog", "add", "repo-a", "-T", "Task", "-c", "feature", "--priority", "P1", "--json"],
    ws,
  );
  assert.equal(added.code, 0);
  const item = JSON.parse(added.stdout[0] ?? "null") as { item: { revision: string } };
  return { ws, revision: item.item.revision };
}

function itemFile(ws: string, id: string): string {
  return path.join(ws, "ops", "repo-a", "backlog", "items", `${id}.md`);
}

test("backlog update transitions status and rewrites the item file", () => {
  const { ws, revision } = setupItem();

  const { code } = run(
    ["backlog", "update", "repo-a", "REP-001", "--status", "in_progress", "--expected-revision", revision],
    ws,
  );

  assert.equal(code, 0);
  const content = readFileSync(itemFile(ws, "REP-001"), "utf8");
  assert.match(content, /status: in_progress/);
});

test("backlog update --json returns a mutation receipt", () => {
  const { ws, revision } = setupItem();

  const { code, stdout } = run(
    ["backlog", "update", "repo-a", "REP-001", "--status", "in_progress", "--expected-revision", revision, "--json"],
    ws,
  );

  assert.equal(code, 0);
  const receipt = JSON.parse(stdout[0] ?? "null") as {
    ok: boolean;
    no_op: boolean;
    revision: string;
    changed_fields: string[];
    before: { status: string };
    result: { status: string; revision: string };
  };
  assert.equal(receipt.ok, true);
  assert.equal(receipt.no_op, false);
  assert.equal(receipt.before.status, "todo");
  assert.equal(receipt.result.status, "in_progress");
  assert.ok(receipt.changed_fields.includes("status"));
  assert.notEqual(receipt.revision, revision);
  assert.equal(receipt.result.revision, receipt.revision);
});

test("backlog update refuses a stale revision and does not write", () => {
  const { ws } = setupItem();
  const before = readFileSync(itemFile(ws, "REP-001"), "utf8");

  const { code, stderr } = run(
    ["backlog", "update", "repo-a", "REP-001", "--status", "in_progress", "--expected-revision", "deadbeef"],
    ws,
  );

  assert.equal(code, 1);
  assert.match(stderr.join("\n"), /revision/i);
  assert.equal(readFileSync(itemFile(ws, "REP-001"), "utf8"), before);
});

test("backlog update without --expected-revision applies directly", () => {
  const { ws } = setupItem();

  const { code } = run(["backlog", "update", "repo-a", "REP-001", "--status", "in_progress"], ws);

  assert.equal(code, 0);
  assert.match(readFileSync(itemFile(ws, "REP-001"), "utf8"), /status: in_progress/);
});

test("backlog update reports no_op for a redundant transition", () => {
  const { ws, revision } = setupItem();

  const { code, stdout } = run(
    ["backlog", "update", "repo-a", "REP-001", "--status", "todo", "--expected-revision", revision, "--json"],
    ws,
  );

  assert.equal(code, 0);
  const receipt = JSON.parse(stdout[0] ?? "null") as { no_op: boolean };
  assert.equal(receipt.no_op, true);
});

test("backlog update marks done items with a fixed date", () => {
  const { ws, revision } = setupItem();

  const { code, stdout } = run(
    ["backlog", "update", "repo-a", "REP-001", "--status", "done", "--expected-revision", revision, "--json"],
    ws,
  );

  assert.equal(code, 0);
  const receipt = JSON.parse(stdout[0] ?? "null") as { result: { fixed_at: string | null } };
  assert.match(receipt.result.fixed_at ?? "", /^\d{4}-\d{2}-\d{2}$/);
  const content = readFileSync(itemFile(ws, "REP-001"), "utf8");
  assert.match(content, /status: done/);
});

test("backlog update validates the new status", () => {
  const { ws, revision } = setupItem();

  const { code, stderr } = run(
    ["backlog", "update", "repo-a", "REP-001", "--status", "bogus", "--expected-revision", revision],
    ws,
  );

  assert.equal(code, 1);
  assert.match(stderr.join("\n"), /status/i);
});

test("backlog update fails clearly for a missing item", () => {
  const { ws } = setupItem();

  const { code, stderr } = run(["backlog", "update", "repo-a", "REP-099", "--status", "done"], ws);

  assert.equal(code, 1);
  assert.match(stderr.join("\n"), /REP-099/);
});
