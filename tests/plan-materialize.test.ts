import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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
  const code = runCli(args, {
    stdout: (message) => stdout.push(message),
    stderr: (message) => stderr.push(message),
  }, cwd);
  return { code, stdout, stderr };
}

function setupWorkspace(plan: Record<string, unknown>, initializeBacklog = true): string {
  const ws = freshDir();
  assert.equal(run(["init"], ws).code, 0);
  mkdirSync(path.join(ws, "repo-a"));
  assert.equal(run(["project", "add", "repo-a"], ws).code, 0);
  if (initializeBacklog) assert.equal(run(["backlog", "init", "repo-a"], ws).code, 0);
  const planPath = path.join(ws, "ops", "repo-a", "plans", "plan-release-workflow.json");
  mkdirSync(path.dirname(planPath), { recursive: true });
  writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  return ws;
}

function approvedPlan(): Record<string, unknown> {
  return {
    schema: "plan/Plan@1",
    id: "plan-release-workflow",
    title: "Release workflow",
    goal: "Publish a repeatable release.",
    items: [
      {
        key: "release",
        title: "Release",
        item_type: "epic",
        priority: "P1",
        body: "Release work.",
        depends_on: [],
      },
      {
        key: "prepare",
        title: "Prepare release",
        item_type: "task",
        priority: "P1",
        body: "Update release notes.",
        parent: "release",
        depends_on: [],
      },
      {
        key: "publish",
        title: "Publish release",
        item_type: "task",
        priority: "P1",
        body: "Publish the package.",
        parent: "release",
        depends_on: ["prepare"],
      },
    ],
    status: "approved",
    approval: {
      approved_at: "2026-09-04T00:00:00.000Z",
      review_note: "Reviewed.",
    },
  };
}

test("plan materialize creates mapped backlog items and resolves local links", () => {
  const ws = setupWorkspace(approvedPlan());

  const result = run(["plan", "materialize", "repo-a", "plan-release-workflow", "--json"], ws);

  assert.equal(result.code, 0);
  const receipt = JSON.parse(result.stdout[0] ?? "null") as {
    ok: boolean;
    no_op: boolean;
    plan_id: string;
    mapping: Record<string, string>;
    items: { key: string; id: string; disposition: string }[];
  };
  assert.equal(receipt.ok, true);
  assert.equal(receipt.no_op, false);
  assert.equal(receipt.plan_id, "plan-release-workflow");
  assert.deepEqual(receipt.mapping, {
    release: "REP-001",
    prepare: "REP-002",
    publish: "REP-003",
  });
  assert.deepEqual(receipt.items.map(({ key, id, disposition }) => ({ key, id, disposition })), [
    { key: "release", id: "REP-001", disposition: "created" },
    { key: "prepare", id: "REP-002", disposition: "created" },
    { key: "publish", id: "REP-003", disposition: "created" },
  ]);

  const epic = JSON.parse(run(["backlog", "show", "repo-a", "REP-001", "--json"], ws).stdout[0] ?? "null") as Record<string, unknown>;
  const task = JSON.parse(run(["backlog", "show", "repo-a", "REP-003", "--json"], ws).stdout[0] ?? "null") as Record<string, unknown>;
  assert.equal(epic.item_type, "epic");
  assert.equal(task.parent_id, "REP-001");
  assert.deepEqual(task.depends_on, ["REP-002"]);

  const storedPlan = JSON.parse(readFileSync(path.join(ws, "ops", "repo-a", "plans", "plan-release-workflow.json"), "utf8")) as {
    materialization: { mapping: Record<string, string> };
  };
  assert.deepEqual(storedPlan.materialization.mapping, receipt.mapping);
});

test("plan materialize rejects draft plans and invalid plans without writing backlog", () => {
  const draft = approvedPlan();
  delete draft.status;
  delete draft.approval;
  const ws = setupWorkspace(draft);
  const result = run(["plan", "materialize", "repo-a", "plan-release-workflow", "--json"], ws);

  assert.equal(result.code, 1);
  assert.match(result.stderr.join("\n"), /approved|draft/i);
  assert.equal(existsSync(path.join(ws, "ops", "repo-a", "backlog", "items", "REP-001.md")), false);

  const invalid = approvedPlan();
  (invalid.items as Record<string, unknown>[])[2]!.depends_on = ["missing"];
  const invalidWs = setupWorkspace(invalid);
  const invalidResult = run(["plan", "materialize", "repo-a", "plan-release-workflow"], invalidWs);
  assert.equal(invalidResult.code, 1);
  assert.match(invalidResult.stderr.join("\n"), /dependency not found/i);
  assert.equal(existsSync(path.join(invalidWs, "ops", "repo-a", "backlog", "items", "REP-001.md")), false);
});

test("plan materialize retries a complete materialization as a no-op", () => {
  const ws = setupWorkspace(approvedPlan());
  const first = run(["plan", "materialize", "repo-a", "plan-release-workflow", "--json"], ws);
  assert.equal(first.code, 0);
  const planPath = path.join(ws, "ops", "repo-a", "plans", "plan-release-workflow.json");
  const planBeforeRetry = readFileSync(planPath, "utf8");

  const second = run(["plan", "materialize", "repo-a", "plan-release-workflow", "--json"], ws);

  assert.equal(second.code, 0);
  const receipt = JSON.parse(second.stdout[0] ?? "null") as {
    ok: boolean;
    no_op: boolean;
    mapping: Record<string, string>;
    items: { key: string; id: string; disposition: string }[];
  };
  assert.equal(receipt.ok, true);
  assert.equal(receipt.no_op, true);
  assert.deepEqual(receipt.mapping, JSON.parse(first.stdout[0] ?? "null").mapping);
  assert.deepEqual(receipt.items.map(({ key, id, disposition }) => ({ key, id, disposition })), [
    { key: "release", id: "REP-001", disposition: "reused" },
    { key: "prepare", id: "REP-002", disposition: "reused" },
    { key: "publish", id: "REP-003", disposition: "reused" },
  ]);
  assert.equal(readFileSync(planPath, "utf8"), planBeforeRetry);
  assert.equal(run(["backlog", "list", "repo-a", "--json"], ws).code, 0);
  const items = JSON.parse(run(["backlog", "list", "repo-a", "--json"], ws).stdout[0] ?? "null") as { items: unknown[] };
  assert.equal(items.items.length, 3);
});

function writeExternalStore(storeRoot: string): { itemsRoot: string; indexPath: string } {
  const itemsRoot = path.join(storeRoot, "items");
  const indexPath = path.join(storeRoot, "INDEX.md");
  mkdirSync(itemsRoot, { recursive: true });
  writeFileSync(path.join(storeRoot, "backlog.json"), `${JSON.stringify({
    schema: "backlog/Store@1",
    project_id: "repo-a",
    id_prefix: "REP",
  }, null, 2)}\n`, "utf8");
  writeFileSync(indexPath, "external index\n", "utf8");
  return { itemsRoot, indexPath };
}

function planArtifactPath(ws: string): string {
  return path.join(ws, "ops", "repo-a", "plans", "plan-release-workflow.json");
}

function assertRejectedWithoutMutation(ws: string, planBefore: string): void {
  const result = run(["plan", "materialize", "repo-a", "plan-release-workflow", "--json"], ws);

  assert.equal(result.code, 1);
  assert.equal(existsSync(path.join(ws, "ops", "repo-a", "backlog", "items", "REP-001.md")), false);
  assert.equal(readFileSync(planArtifactPath(ws), "utf8"), planBefore);
}

test("plan materialize rejects a backlog root symlink escaping the workspace", () => {
  const ws = setupWorkspace(approvedPlan());
  const planPath = planArtifactPath(ws);
  const planBefore = readFileSync(planPath, "utf8");
  const outside = freshDir();
  const outsideStore = path.join(outside, "store");
  writeExternalStore(outsideStore);
  const backlogRoot = path.join(ws, "ops", "repo-a", "backlog");

  try {
    rmSync(backlogRoot, { recursive: true, force: true });
    symlinkSync(outsideStore, backlogRoot, "dir");
    const outsideBefore = readFileSync(path.join(outsideStore, "INDEX.md"), "utf8");

    assertRejectedWithoutMutation(ws, planBefore);

    assert.equal(readFileSync(path.join(outsideStore, "INDEX.md"), "utf8"), outsideBefore);
    assert.deepEqual(readdirSync(path.join(outsideStore, "items")), []);
  } finally {
    rmSync(ws, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("plan materialize rejects an items symlink escaping the backlog store", () => {
  const ws = setupWorkspace(approvedPlan());
  const planPath = planArtifactPath(ws);
  const planBefore = readFileSync(planPath, "utf8");
  const outside = freshDir();
  const outsideItems = path.join(outside, "items");
  mkdirSync(outsideItems);
  const markerPath = path.join(outsideItems, "marker.txt");
  writeFileSync(markerPath, "outside marker\n", "utf8");
  const backlogRoot = path.join(ws, "ops", "repo-a", "backlog");
  const itemsRoot = path.join(backlogRoot, "items");

  try {
    rmSync(itemsRoot, { recursive: true, force: true });
    symlinkSync(outsideItems, itemsRoot, "dir");
    const outsideBefore = readFileSync(markerPath, "utf8");

    assertRejectedWithoutMutation(ws, planBefore);

    assert.equal(readFileSync(markerPath, "utf8"), outsideBefore);
    assert.deepEqual(readdirSync(outsideItems), ["marker.txt"]);
  } finally {
    rmSync(ws, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("plan materialize rejects an INDEX.md symlink escaping the backlog store", () => {
  const ws = setupWorkspace(approvedPlan());
  const planPath = planArtifactPath(ws);
  const planBefore = readFileSync(planPath, "utf8");
  const outside = freshDir();
  const outsideIndex = path.join(outside, "INDEX.md");
  writeFileSync(outsideIndex, "outside index\n", "utf8");
  const backlogRoot = path.join(ws, "ops", "repo-a", "backlog");
  const indexPath = path.join(backlogRoot, "INDEX.md");

  try {
    rmSync(indexPath, { force: true });
    symlinkSync(outsideIndex, indexPath, "file");
    const outsideBefore = readFileSync(outsideIndex, "utf8");

    assertRejectedWithoutMutation(ws, planBefore);

    assert.equal(readFileSync(outsideIndex, "utf8"), outsideBefore);
    assert.equal(existsSync(path.join(backlogRoot, "items", "REP-001.md")), false);
  } finally {
    rmSync(ws, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
