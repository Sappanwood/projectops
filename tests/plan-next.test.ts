import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runCli } from "../src/app.js";
import { getWorkbenchReadPages } from "../src/application/workbenchReadModel.js";
import { getPlanNext } from "../src/application/planNext.js";

function setup() {
  const root = mkdtempSync(path.join(tmpdir(), "pops-plan-next-"));
  function call(args: string[]) {
    const out: string[] = [],
      err: string[] = [];
    const code = runCli(args, { stdout: (s) => out.push(s), stderr: (s) => err.push(s) }, root);
    return { code, stdout: out.join("\n"), stderr: err.join("\n") };
  }
  function run(args: string[]) {
    const result = call([...args, "--json"]);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    return JSON.parse(result.stdout);
  }
  run(["init"]);
  mkdirSync(path.join(root, "alpha"));
  run(["project", "add", "alpha"]);
  run(["backlog", "init", "alpha"]);
  const ops = path.join(root, "ops/alpha");
  function item(title: string, priority = "P1", extra: string[] = []) {
    return run([
      "backlog",
      "add",
      "alpha",
      "-T",
      title,
      "-c",
      "feature",
      "--priority",
      priority,
      ...extra,
    ]).item.id as string;
  }
  function plan(ids: string[], materialized = true) {
    const data = {
      schema: "plan/Plan@1",
      id: "plan-next",
      title: "Next",
      goal: "Read next tasks",
      status: materialized ? "approved" : "draft",
      ...(materialized
        ? {
            approval: { approved_at: "2026-09-05", review_note: "Fixture" },
            materialization: {
              materialized_at: "2026-09-05",
              mapping: Object.fromEntries(ids.map((id, i) => [`task-${i}`, id])),
            },
          }
        : {}),
      items: ids.map((id, i) => ({
        key: `task-${i}`,
        title: `Planned ${id}`,
        item_type: run(["backlog", "show", "alpha", id]).item_type,
        priority: "P1",
        body: "Scope",
        depends_on: [],
      })),
    };
    writeFileSync(path.join(ops, "plans/plan-next.json"), JSON.stringify(data));
  }
  return { root, ops, call, run, item, plan };
}
function snapshot(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory())
      for (const [key, value] of Object.entries(snapshot(file)))
        result[`${entry.name}/${key}`] = value;
    else result[entry.name] = readFileSync(file, "utf8");
  }
  return result;
}

test("plan next uses current priorities and direct dependencies within one project, read-only", () => {
  const f = setup();
  try {
    const external = f.item("External done", "P0");
    f.run(["backlog", "update", "alpha", external, "--status", "done"]);
    const low = f.item("Low", "P3");
    const first = f.item("First", "P0", ["--depends-on", external]);
    const second = f.item("Second", "P0");
    const middle = f.item("Middle", "P2");
    const high = f.item("High", "P1");
    const running = f.item("Running");
    f.run(["backlog", "update", "alpha", running, "--status", "in_progress"]);
    const blocked = f.item("Blocked", "P0", ["--depends-on", running]);
    const done = f.item("Done");
    f.run(["backlog", "update", "alpha", done, "--status", "done"]);
    const epic = f.item("Epic", "P0", ["--item-type", "epic"]);
    f.plan([low, second, middle, high, first, running, blocked, done, epic]);
    const before = snapshot(f.root);
    const data = f.run(["plan", "next", "alpha", "plan-next"]);
    assert.deepEqual(
      Object.keys(data).sort(),
      ["ok", "plan_id", "ready", "in_progress", "blocked", "next", "diagnostics"].sort(),
    );
    assert.deepEqual(
      data.ready.map((i: any) => i.id),
      [first, second, high, middle, low],
    );
    assert.equal(data.next.id, first);
    assert.equal(data.next.title, "First");
    assert.equal(data.next.priority, "P0");
    assert.equal(data.next.status, "todo");
    assert.deepEqual(
      data.in_progress.map((i: any) => i.id),
      [running],
    );
    assert.equal(data.blocked[0].id, blocked);
    assert.equal(data.blocked[0].reasons[0].id, running);
    assert.equal(data.blocked[0].reasons[0].code, "DEPENDENCY_NOT_DONE");
    assert.deepEqual(data.diagnostics, []);
    const shared = getPlanNext({ workspaceDir: f.root, projectId: "alpha", planId: "plan-next" });
    assert.ok(shared.ok);
    assert.deepEqual({ ok: true, ...shared.data }, data);
    const pages = getWorkbenchReadPages({ workspaceDir: f.root, projectId: "alpha" });
    assert.ok(pages.ok);
    assert.deepEqual(pages.data.plans[0]!.next_tasks, shared.data);
    assert.deepEqual(snapshot(f.root), before);
    const text = f.call(["plan", "next", "alpha", "plan-next"]);
    assert.equal(text.code, 0);
    for (const token of [first, running, blocked, "in_progress", "P0"])
      assert.ok(text.stdout.includes(token), token);
    assert.deepEqual(snapshot(f.root), before);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("plan next isolates missing, corrupt and foreign dependencies and unreadable mapped tasks", () => {
  const f = setup();
  try {
    const missing = f.item("Missing");
    const corrupt = f.item("Corrupt");
    const dependent = f.item("Dependent", "P1", ["--depends-on", `${missing},${corrupt}`]);
    const unreadable = f.item("Unreadable mapped");
    const foreign = f.item("Foreign dependency");
    const ready = f.item("Healthy");
    f.plan([dependent, unreadable, foreign, ready]);
    rmSync(path.join(f.ops, `backlog/items/${missing}.md`));
    writeFileSync(path.join(f.ops, `backlog/items/${corrupt}.md`), "broken");
    writeFileSync(path.join(f.ops, `backlog/items/${unreadable}.md`), "broken");
    const file = path.join(f.ops, `backlog/items/${foreign}.md`);
    writeFileSync(
      file,
      readFileSync(file, "utf8").replace("depends_on: []", 'depends_on: ["BET-001"]'),
    );
    const before = snapshot(f.root);
    const data = f.run(["plan", "next", "alpha", "plan-next"]);
    assert.deepEqual(
      data.ready.map((i: any) => i.id),
      [ready],
    );
    assert.deepEqual(
      data.blocked[0].reasons.map((r: any) => [r.id, r.code]),
      [
        [missing, "ITEM_NOT_FOUND"],
        [corrupt, "ITEM_INVALID"],
      ],
    );
    assert.equal(data.blocked[1].reasons[0].id, "BET-001");
    assert.equal(data.blocked[1].reasons[0].code, "INVALID_ITEM_ID");
    assert.equal(data.diagnostics[0].id, unreadable);
    assert.equal(data.diagnostics[0].code, "ITEM_INVALID");
    assert.equal(JSON.stringify(data).includes(f.root), false);
    assert.deepEqual(snapshot(f.root), before);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("plan next handles unmaterialized, all-done and blocked-only Plans as successful empty recommendations", () => {
  const f = setup();
  try {
    const id = f.item("Task");
    f.plan([id], false);
    let data = f.run(["plan", "next", "alpha", "plan-next"]);
    assert.equal(data.next, null);
    assert.deepEqual(data.ready, []);
    assert.equal(data.diagnostics[0].code, "PLAN_NOT_MATERIALIZED");
    f.plan([id]);
    f.run(["backlog", "update", "alpha", id, "--status", "done"]);
    data = f.run(["plan", "next", "alpha", "plan-next"]);
    assert.equal(data.next, null);
    assert.deepEqual(
      [data.ready, data.in_progress, data.blocked, data.diagnostics],
      [[], [], [], []],
    );
    const dep = f.item("Pending outside Plan");
    const blocked = f.item("Blocked", "P1", ["--depends-on", dep]);
    f.plan([blocked]);
    data = f.run(["plan", "next", "alpha", "plan-next"]);
    assert.equal(data.next, null);
    assert.equal(data.blocked.length, 1);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("built plan next CLI exposes text/JSON, structured failures and preserves authority", () => {
  const f = setup();
  const cli = path.resolve("dist/cli.js");
  const invoke = (args: string[], cwd = f.root) =>
    spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });
  try {
    const id = f.item("Built task");
    f.plan([id]);
    const before = snapshot(f.root);
    const result = invoke(["plan", "next", "alpha", "plan-next", "--json"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).next.id, id);
    assert.equal(result.stderr, "");
    assert.match(invoke(["plan", "next", "alpha", "plan-next"]).stdout, /Built task/);
    assert.match(invoke(["--help"]).stdout, /plan next/);
    for (const args of [
      ["alpha", "plan-missing"],
      ["missing", "plan-next"],
      ["alpha"],
      ["alpha", "../invalid"],
      ["alpha", "plan-next", "--unknown"],
    ]) {
      const failed = invoke(["plan", "next", ...args, "--json"]);
      assert.notEqual(failed.status, 0);
      assert.equal(JSON.parse(failed.stdout).ok, false);
      assert.ok(JSON.parse(failed.stdout).error);
      assert.equal(failed.stderr, "");
    }
    assert.deepEqual(snapshot(f.root), before);
    writeFileSync(path.join(f.ops, "plans/plan-next.json"), "{");
    assert.equal(
      JSON.parse(invoke(["plan", "next", "alpha", "plan-next", "--json"]).stdout).ok,
      false,
    );
    writeFileSync(path.join(f.root, ".pops/workspace.json"), "{");
    assert.equal(
      JSON.parse(invoke(["plan", "next", "alpha", "plan-next", "--json"]).stdout).ok,
      false,
    );
    const absent = mkdtempSync(path.join(tmpdir(), "pops-no-workspace-"));
    try {
      const result = invoke(["plan", "next", "alpha", "plan-next", "--json"], absent);
      assert.notEqual(result.status, 0);
      assert.equal(JSON.parse(result.stdout).ok, false);
    } finally {
      rmSync(absent, { recursive: true, force: true });
    }
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
