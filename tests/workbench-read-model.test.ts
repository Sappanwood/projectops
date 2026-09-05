import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  getWorkbenchProjectOverview,
  getWorkbenchWorkspaceOverview,
} from "../src/application/workbenchReadModel.js";
import { runCli } from "../src/app.js";
import { createPlan } from "../src/plan/plan.js";
import { writePlan } from "../src/plan/planFs.js";
import { REPORT_SCHEMA } from "../src/report/report.js";
import { writeReport } from "../src/report/reportFs.js";
import { RETROSPECTIVE_SCHEMA } from "../src/retrospective/retrospective.js";
import { writeRetrospective } from "../src/retrospective/retrospectiveFs.js";

function freshDir(): string {
  return mkdtempSync(path.join(tmpdir(), "pops-read-model-"));
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
  const workspaceDir = freshDir();
  assert.equal(run(["init"], workspaceDir).code, 0);
  return workspaceDir;
}

function setupProject(): string {
  const workspaceDir = setupWorkspace();
  mkdirSync(path.join(workspaceDir, "repo-a"));
  assert.equal(run(["project", "add", "repo-a"], workspaceDir).code, 0);
  assert.equal(run(["backlog", "init", "repo-a"], workspaceDir).code, 0);
  assert.equal(
    run(["backlog", "add", "repo-a", "-T", "First", "-c", "feature", "--priority", "P1"], workspaceDir).code,
    0,
  );
  const added = run(
    ["backlog", "add", "repo-a", "-T", "Second", "-c", "docs", "--priority", "P2", "--json"],
    workspaceDir,
  );
  assert.equal(added.code, 0);
  const revision = (JSON.parse(added.stdout[0] ?? "null") as { item: { revision: string } }).item.revision;
  assert.equal(
    run([
      "backlog",
      "update",
      "repo-a",
      "REP-002",
      "--status",
      "done",
      "--expected-revision",
      revision,
    ], workspaceDir).code,
    0,
  );
  assert.equal(run(["docs", "scaffold", "repo-a"], workspaceDir).code, 0);

  const ops = path.join(workspaceDir, "ops", "repo-a");
  const plan = createPlan({
    title: "Workbench",
    goal: "Expose a stable summary",
    items: [{
      key: "summary",
      title: "Build summary",
      item_type: "task",
      priority: "P1",
      body: "",
      depends_on: [],
    }],
  });
  assert.notEqual(typeof plan, "string");
  if (typeof plan === "string") throw new Error(plan);
  writePlan(path.join(ops, "plans"), plan);
  writeReport(workspaceDir, path.join(ops, "reports"), {
    schema: REPORT_SCHEMA,
    id: "report-workbench",
    title: "Workbench delivery",
    project: "repo-a",
    created_at: "2026-09-04T12:00:00+09:00",
    outcome: "completed",
    plan: "project-ops:plans/plan-workbench.json",
    backlog: [{ id: "REP-002", status: "done" }],
    verification: ["npm test"],
    deviations: [],
    workarounds: [],
    repo_docs: ["README.md"],
    body: "## Summary\n\nComplete.",
  });
  writeRetrospective(workspaceDir, path.join(workspaceDir, "retrospectives"), {
    schema: RETROSPECTIVE_SCHEMA,
    id: "workbench-friction",
    created_at: "2026-09-04T12:30:00+09:00",
    project: "repo-a",
    task: "REP-002",
    trigger: "workflow-friction",
    status: "inbox",
    harness: "test",
    model: null,
    body: "## Evidence\n\nCaptured.",
  });
  return workspaceDir;
}

test("Workbench workspace overview handles an empty workspace", () => {
  const workspaceDir = setupWorkspace();

  const result = getWorkbenchWorkspaceOverview({ workspaceDir });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.data.workspace.name.length > 0);
  assert.deepEqual(result.data.projects, []);
  assert.deepEqual(result.data.diagnostics, []);
  assert.equal(JSON.stringify(result.data).includes(workspaceDir), false);
});

test("Workbench project overview combines stable domain summaries", () => {
  const workspaceDir = setupProject();

  const first = getWorkbenchProjectOverview({ workspaceDir, projectId: "repo-a" });
  const second = getWorkbenchProjectOverview({ workspaceDir, projectId: "repo-a" });

  assert.equal(first.ok, true);
  assert.deepEqual(second, first);
  if (!first.ok) return;
  assert.deepEqual(first.data.project, { id: "repo-a", path: "repo-a" });
  assert.deepEqual(first.data.backlog.counts, {
    todo: 1,
    in_progress: 0,
    done: 1,
    cancelled: 0,
    blocked: 0,
  });
  assert.deepEqual(first.data.backlog.recent.map((item) => item.id), ["REP-001", "REP-002"]);
  assert.deepEqual(first.data.plans, [{
    id: "plan-workbench",
    title: "Workbench",
    status: "draft",
    item_count: 1,
  }]);
  assert.deepEqual(first.data.reports, [{
    id: "report-workbench",
    title: "Workbench delivery",
    outcome: "completed",
    created_at: "2026-09-04T12:00:00+09:00",
  }]);
  assert.deepEqual(first.data.docs, { healthy: true, problems: [] });
  assert.deepEqual(first.data.retrospectives.counts, { inbox: 1, active: 0, archive: 0 });
  assert.deepEqual(first.data.retrospectives.recent, [{
    id: "workbench-friction",
    status: "inbox",
    created_at: "2026-09-04T12:30:00+09:00",
    path: "inbox/workbench-friction.md",
  }]);
  assert.deepEqual(first.data.diagnostics, []);
  assert.equal(JSON.stringify(first.data).includes(workspaceDir), false);
});

test("Workbench project overview isolates malformed and missing domain data", () => {
  const workspaceDir = setupProject();
  const ops = path.join(workspaceDir, "ops", "repo-a");
  rmSync(path.join(ops, "plans", "plan-workbench.json"));
  writeFileSync(path.join(ops, "plans", "plan-broken.json"), "{invalid", "utf8");
  rmSync(path.join(ops, "reports"), { recursive: true });
  writeFileSync(path.join(workspaceDir, "retrospectives", "inbox", "broken.md"), "not frontmatter\n", "utf8");
  writeFileSync(path.join(ops, "backlog", "items", "REP-001.md"), "not frontmatter\n", "utf8");

  const result = getWorkbenchProjectOverview({ workspaceDir, projectId: "repo-a" });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.backlog.counts.todo, 0);
  assert.deepEqual(result.data.plans, []);
  assert.deepEqual(result.data.reports, []);
  assert.ok(result.data.diagnostics.some((entry) => entry.source === "backlog" && entry.code === "ITEM_INVALID"));
  assert.ok(result.data.diagnostics.some((entry) => entry.source === "plans" && entry.reference === "plans/plan-broken.json"));
  assert.ok(result.data.diagnostics.some((entry) => entry.source === "reports"));
  assert.ok(result.data.diagnostics.some((entry) => entry.source === "retrospectives" && entry.reference === "inbox/broken.md"));
  assert.equal(JSON.stringify(result.data).includes(workspaceDir), false);
});

test("Workbench read model returns a stable unknown-project error", () => {
  const workspaceDir = setupWorkspace();

  const result = getWorkbenchProjectOverview({ workspaceDir, projectId: "missing" });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "PROJECT_NOT_FOUND");
  assert.equal(JSON.stringify(result.error).includes(workspaceDir), false);
});

test("Workbench project overview isolates unreadable backlog items as domain diagnostic", () => {
  const workspaceDir = setupProject();
  const itemsPath = path.join(workspaceDir, "ops", "repo-a", "backlog", "items");
  rmSync(itemsPath, { recursive: true });
  writeFileSync(itemsPath, "corrupt-file", "utf8");

  const result = getWorkbenchProjectOverview({ workspaceDir, projectId: "repo-a" });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.backlog.counts.todo, 0);
  assert.deepEqual(result.data.backlog.recent, []);
  assert.ok(result.data.diagnostics.some((entry) => entry.source === "backlog" && entry.code === "BACKLOG_STORE_INVALID"));
  assert.equal(JSON.stringify(result.data).includes(workspaceDir), false);
});

test("Workbench read model rejects inherited prototype properties as unknown projects", () => {
  const workspaceDir = setupWorkspace();

  for (const prototypeKey of ["constructor", "toString", "valueOf", "__proto__"]) {
    const result = getWorkbenchProjectOverview({ workspaceDir, projectId: prototypeKey });
    assert.equal(result.ok, false);
    if (result.ok) continue;
    assert.equal(result.error.code, "PROJECT_NOT_FOUND");
  }
});

test("Workbench project overview treats Plan with ID mismatch as ARTIFACT_INVALID", () => {
  const workspaceDir = setupProject();
  const plansDir = path.join(workspaceDir, "ops", "repo-a", "plans");
  const planFile = path.join(plansDir, "plan-workbench.json");
  const parsed = JSON.parse(readFileSync(planFile, "utf8"));
  parsed.id = "plan-different";
  writeFileSync(planFile, JSON.stringify(parsed), "utf8");

  const result = getWorkbenchProjectOverview({ workspaceDir, projectId: "repo-a" });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.data.plans, []);
  assert.ok(result.data.diagnostics.some((entry) =>
    entry.source === "plans" &&
    entry.code === "ARTIFACT_INVALID" &&
    entry.reference === "plans/plan-workbench.json",
  ));
});

test("Workbench project overview isolates backlog item ID mismatch as ITEM_ID_MISMATCH diagnostic", () => {
  const workspaceDir = setupProject();
  const file = path.join(workspaceDir, "ops", "repo-a", "backlog", "items", "REP-001.md");
  const content = readFileSync(file, "utf8").replace("id: REP-001", "id: REP-999");
  writeFileSync(file, content, "utf8");

  const result = getWorkbenchProjectOverview({ workspaceDir, projectId: "repo-a" });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.backlog.counts.todo, 0);
  assert.deepEqual(result.data.backlog.recent, []);
  assert.ok(result.data.diagnostics.some((entry) =>
    entry.source === "backlog" &&
    entry.code === "ITEM_ID_MISMATCH",
  ));
});




