import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { runCli } from "../src/app.js";

function freshDir(): string {
  return mkdtempSync(path.join(tmpdir(), "pops-"));
}

function run(
  args: string[],
  cwd: string,
  stdin = "",
): { code: number; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = runCli(
    args,
    {
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
      stdin: () => stdin,
    },
    cwd,
  );
  return { code, stdout, stderr };
}

function setupStore(): string {
  const ws = freshDir();
  assert.equal(run(["init"], ws).code, 0);
  mkdirSync(path.join(ws, "repo-a"));
  assert.equal(run(["project", "add", "repo-a"], ws).code, 0);
  assert.equal(run(["backlog", "init", "repo-a"], ws).code, 0);
  return ws;
}

const ADD_BASE = ["backlog", "add", "repo-a"];

test("backlog add creates an item file with frontmatter and body", () => {
  const ws = setupStore();

  const { code } = run(
    [...ADD_BASE, "-T", "First task", "-c", "feature", "--priority", "P1", "-b", "Body text"],
    ws,
  );

  assert.equal(code, 0);
  const itemFile = path.join(ws, "ops", "repo-a", "backlog", "items", "REP-001.md");
  assert.ok(existsSync(itemFile));
  const content = readFileSync(itemFile, "utf8");
  assert.match(content, /^---\n/);
  assert.match(content, /id: REP-001/);
  assert.match(content, /title: First task/);
  assert.match(content, /status: todo/);
  assert.match(content, /Body text/);
});

test("backlog add assigns sequential ids", () => {
  const ws = setupStore();
  assert.equal(run([...ADD_BASE, "-T", "One", "-c", "feature", "--priority", "P1"], ws).code, 0);
  assert.equal(run([...ADD_BASE, "-T", "Two", "-c", "feature", "--priority", "P1"], ws).code, 0);

  assert.ok(existsSync(path.join(ws, "ops", "repo-a", "backlog", "items", "REP-001.md")));
  assert.ok(existsSync(path.join(ws, "ops", "repo-a", "backlog", "items", "REP-002.md")));
});

test("backlog add reads a multi-line body from a file", () => {
  const ws = setupStore();
  const bodyFile = path.join(ws, "body.md");
  writeFileSync(bodyFile, "## Intent\n\nDo the thing.\n\n## Acceptance Criteria\n\n- works\n", "utf8");

  const { code } = run([...ADD_BASE, "-T", "Task", "-c", "feature", "--priority", "P1", "--body-file", bodyFile], ws);

  assert.equal(code, 0);
  const content = readFileSync(path.join(ws, "ops", "repo-a", "backlog", "items", "REP-001.md"), "utf8");
  assert.match(content, /## Acceptance Criteria/);
});

test("backlog add reads the body from stdin", () => {
  const ws = setupStore();

  const { code } = run(
    [...ADD_BASE, "-T", "Stdin task", "-c", "feature", "--priority", "P1", "--stdin"],
    ws,
    "Body from stdin\n",
  );

  assert.equal(code, 0);
  const content = readFileSync(path.join(ws, "ops", "repo-a", "backlog", "items", "REP-001.md"), "utf8");
  assert.match(content, /Body from stdin/);
});

test("backlog add requires title, category and priority", () => {
  const ws = setupStore();

  const missingTitle = run([...ADD_BASE, "-c", "feature", "--priority", "P1"], ws);
  assert.equal(missingTitle.code, 1);
  assert.match(missingTitle.stderr.join("\n"), /title/i);

  const missingCategory = run([...ADD_BASE, "-T", "T", "--priority", "P1"], ws);
  assert.equal(missingCategory.code, 1);
  assert.match(missingCategory.stderr.join("\n"), /category/i);

  const missingPriority = run([...ADD_BASE, "-T", "T", "-c", "feature"], ws);
  assert.equal(missingPriority.code, 1);
  assert.match(missingPriority.stderr.join("\n"), /priority/i);
});

test("backlog add supports epics and one-level parent links", () => {
  const ws = setupStore();
  assert.equal(
    run([...ADD_BASE, "-T", "Epic one", "-c", "feature", "--priority", "P1", "--item-type", "epic"], ws).code,
    0,
  );
  assert.equal(
    run([...ADD_BASE, "-T", "Child task", "-c", "feature", "--priority", "P1", "--parent-id", "REP-001"], ws).code,
    0,
  );

  const child = readFileSync(path.join(ws, "ops", "repo-a", "backlog", "items", "REP-002.md"), "utf8");
  assert.match(child, /parent_id: REP-001/);
  assert.match(child, /item_type: task/);
});

test("backlog add rejects invalid parent links", () => {
  const ws = setupStore();

  const missingParent = run(
    [...ADD_BASE, "-T", "T", "-c", "feature", "--priority", "P1", "--parent-id", "REP-099"],
    ws,
  );
  assert.equal(missingParent.code, 1);
  assert.match(missingParent.stderr.join("\n"), /parent/i);

  const taskAsParent = run(
    [...ADD_BASE, "-T", "T", "-c", "feature", "--priority", "P1"],
    ws,
  );
  assert.equal(taskAsParent.code, 0);
  const parentOnTask = run(
    [...ADD_BASE, "-T", "T2", "-c", "feature", "--priority", "P1", "--parent-id", "REP-001"],
    ws,
  );
  assert.equal(parentOnTask.code, 1);
  assert.match(parentOnTask.stderr.join("\n"), /epic/i);

  const epicWithParent = run(
    [...ADD_BASE, "-T", "E", "-c", "feature", "--priority", "P1", "--item-type", "epic", "--parent-id", "REP-001"],
    ws,
  );
  assert.equal(epicWithParent.code, 1);
});

test("backlog add rejects unknown dependency ids", () => {
  const ws = setupStore();

  const { code, stderr } = run(
    [...ADD_BASE, "-T", "T", "-c", "feature", "--priority", "P1", "--depends-on", "REP-099"],
    ws,
  );

  assert.equal(code, 1);
  assert.match(stderr.join("\n"), /depend/i);
});

test("backlog list shows items and filters by status", () => {
  const ws = setupStore();
  assert.equal(run([...ADD_BASE, "-T", "Alpha", "-c", "feature", "--priority", "P1"], ws).code, 0);
  assert.equal(run([...ADD_BASE, "-T", "Beta", "-c", "docs", "--priority", "P2"], ws).code, 0);

  const { code, stdout } = run(["backlog", "list", "repo-a", "--json"], ws);

  assert.equal(code, 0);
  const result = JSON.parse(stdout[0] ?? "null") as {
    ok: boolean;
    items: { id: string; title: string; status: string; priority: string }[];
  };
  assert.equal(result.ok, true);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0]?.id, "REP-001");
  assert.equal(result.items[0]?.title, "Alpha");
});

test("backlog list works in human-readable mode and for empty stores", () => {
  const empty = setupStore();
  const emptyResult = run(["backlog", "list", "repo-a"], empty);
  assert.equal(emptyResult.code, 0);

  const ws = setupStore();
  assert.equal(run([...ADD_BASE, "-T", "Alpha", "-c", "feature", "--priority", "P1"], ws).code, 0);
  const { code, stdout } = run(["backlog", "list", "repo-a"], ws);
  assert.equal(code, 0);
  assert.ok(stdout.some((line) => line.includes("Alpha")));
});

test("backlog show prints the full item including body", () => {
  const ws = setupStore();
  assert.equal(
    run([...ADD_BASE, "-T", "Show me", "-c", "feature", "--priority", "P1", "-b", "Detail body"], ws).code,
    0,
  );

  const { code, stdout } = run(["backlog", "show", "repo-a", "REP-001"], ws);

  assert.equal(code, 0);
  const out = stdout.join("\n");
  assert.match(out, /Show me/);
  assert.match(out, /Detail body/);
});

test("backlog show --json returns the full item as JSON", () => {
  const ws = setupStore();
  assert.equal(run([...ADD_BASE, "-T", "Json item", "-c", "feature", "--priority", "P1"], ws).code, 0);

  const { code, stdout } = run(["backlog", "show", "repo-a", "REP-001", "--json"], ws);

  assert.equal(code, 0);
  const item = JSON.parse(stdout[0] ?? "null") as Record<string, unknown>;
  assert.equal(item.id, "REP-001");
  assert.equal(item.title, "Json item");
  assert.equal(item.status, "todo");
  assert.ok(typeof item.revision === "string");
});

test("item files round-trip through show without corruption", () => {
  const ws = setupStore();
  assert.equal(run([...ADD_BASE, "-T", "Round trip", "-c", "feature", "--priority", "P1"], ws).code, 0);
  const onDisk = readFileSync(path.join(ws, "ops", "repo-a", "backlog", "items", "REP-001.md"), "utf8");

  const { code, stdout } = run(["backlog", "show", "repo-a", "REP-001", "--json"], ws);

  assert.equal(code, 0);
  const item = JSON.parse(stdout[0] ?? "null") as Record<string, unknown>;
  assert.equal(item.source, "");
  assert.deepEqual(item.tags, []);
  assert.deepEqual(item.depends_on, []);
  assert.equal(item.parent_id, null);
  assert.match(onDisk, /source: ''/);
});

test("backlog show fails clearly for a missing item", () => {
  const ws = setupStore();

  const { code, stderr } = run(["backlog", "show", "repo-a", "REP-099"], ws);

  assert.equal(code, 1);
  assert.match(stderr.join("\n"), /REP-099/);
});

test("backlog add fails clearly when the store is not initialized", () => {
  const ws = freshDir();
  assert.equal(run(["init"], ws).code, 0);
  mkdirSync(path.join(ws, "repo-a"));
  assert.equal(run(["project", "add", "repo-a"], ws).code, 0);

  const { code, stderr } = run([...ADD_BASE, "-T", "T", "-c", "feature", "--priority", "P1"], ws);

  assert.equal(code, 1);
  assert.match(stderr.join("\n"), /backlog init/i);
});
