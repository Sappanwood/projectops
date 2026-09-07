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
    run(
      ["backlog", "add", "repo-a", "-T", "First", "-c", "feature", "--priority", "P1"],
      workspaceDir,
    ).code,
    0,
  );
  const added = run(
    ["backlog", "add", "repo-a", "-T", "Second", "-c", "docs", "--priority", "P2", "--json"],
    workspaceDir,
  );
  assert.equal(added.code, 0);
  const revision = (JSON.parse(added.stdout[0] ?? "null") as { item: { revision: string } }).item
    .revision;
  assert.equal(
    run(
      [
        "backlog",
        "update",
        "repo-a",
        "REP-002",
        "--status",
        "done",
        "--expected-revision",
        revision,
      ],
      workspaceDir,
    ).code,
    0,
  );
  assert.equal(run(["docs", "scaffold", "repo-a"], workspaceDir).code, 0);

  const ops = path.join(workspaceDir, "ops", "repo-a");
  const plan = createPlan({
    title: "Workbench",
    goal: "Expose a stable summary",
    items: [
      {
        key: "summary",
        title: "Build summary",
        item_type: "task",
        priority: "P1",
        body: "",
        depends_on: [],
      },
    ],
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

test("Overview prioritizes active work, caps previews and falls back to recent updates", () => {
  const workspaceDir = setupProject();
  try {
    for (let i = 0; i < 6; i++)
      assert.equal(
        run(
          [
            "backlog",
            "add",
            "repo-a",
            "-T",
            `Task ${i}`,
            "-c",
            "feature",
            "--priority",
            i === 5 ? "P0" : "P2",
          ],
          workspaceDir,
        ).code,
        0,
      );
    assert.equal(
      run(["backlog", "update", "repo-a", "REP-003", "--status", "in_progress"], workspaceDir).code,
      0,
    );
    const result = getWorkbenchProjectOverview({ workspaceDir, projectId: "repo-a" });
    assert.ok(result.ok);
    assert.equal(result.data.backlog.mode, "active");
    assert.equal(result.data.backlog.counts.todo, 6);
    assert.deepEqual(
      result.data.backlog.recent.map((item) => item.id),
      ["REP-003", "REP-008", "REP-001", "REP-004", "REP-005"],
    );
    for (let i = 1; i <= 8; i++)
      assert.equal(
        run(
          ["backlog", "update", "repo-a", `REP-${String(i).padStart(3, "0")}`, "--status", "done"],
          workspaceDir,
        ).code,
        0,
      );
    const file = path.join(workspaceDir, "ops/repo-a/backlog/items/REP-008.md");
    writeFileSync(file, readFileSync(file, "utf8").replace(/updated: .*/, "updated: 2099-01-01"));
    const recent = getWorkbenchProjectOverview({ workspaceDir, projectId: "repo-a" });
    assert.ok(recent.ok);
    assert.equal(recent.data.backlog.mode, "recent");
    assert.deepEqual(
      recent.data.backlog.recent.map((item) => item.id),
      ["REP-008", "REP-001", "REP-002", "REP-003", "REP-004"],
    );
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("Overview separates Plan approval, live task progress and historical report outcomes", () => {
  const workspaceDir = setupProject();
  try {
    const root = path.join(workspaceDir, "ops/repo-a/plans");
    const base = JSON.parse(readFileSync(path.join(root, "plan-workbench.json"), "utf8"));
    for (const [name, mapping, itemType] of [
      ["completed", "REP-002", "task"],
      ["running", "REP-001", "task"],
      ["missing", "REP-999", "task"],
      ["zero", "REP-998", "epic"],
    ]) {
      writeFileSync(
        path.join(root, `plan-${name}.json`),
        JSON.stringify({
          ...base,
          id: `plan-${name}`,
          title: name,
          status: "approved",
          approval: { approved_at: "2026-09-05", review_note: "Fixture" },
          items: [{ ...base.items[0], item_type: itemType }],
          materialization: { materialized_at: "2026-09-05", mapping: { summary: mapping } },
        }),
      );
    }
    writeFileSync(
      path.join(root, "plan-unmaterialized.json"),
      JSON.stringify({
        ...base,
        id: "plan-unmaterialized",
        status: "approved",
        approval: { approved_at: "2026-09-05", review_note: "Fixture" },
      }),
    );
    writeFileSync(path.join(root, "plan-invalid.json"), "{bad");
    const result = getWorkbenchProjectOverview({ workspaceDir, projectId: "repo-a" });
    assert.ok(result.ok);
    assert.equal(result.data.plans.at(-1)!.id, "plan-completed");
    assert.equal(result.data.plans.length, 6);
    const plan = (id: string) => result.data.plans.find((p) => p.id === `plan-${id}`)!;
    assert.equal(plan("workbench").execution.completion_percent, null);
    assert.equal(plan("unmaterialized").execution.materialized, false);
    assert.equal(plan("zero").execution.counts.total, 0);
    assert.equal(plan("zero").execution.completion_percent, null);
    assert.equal(plan("completed").status, "approved");
    assert.equal(plan("completed").execution.completion_percent, 100);
    assert.equal(plan("running").execution.counts.todo, 1);
    assert.equal(plan("missing").execution.counts.total, 1);
    assert.equal(plan("missing").execution.counts.unreadable, 1);
    assert.equal(plan("missing").execution.diagnostics[0]!.id, "REP-999");
    assert.ok(result.data.diagnostics.some((d) => d.source === "plans"));
    assert.equal(result.data.reports[0]!.outcome, "completed");
    assert.equal(
      run(["backlog", "update", "repo-a", "REP-002", "--status", "todo"], workspaceDir).code,
      0,
    );
    const refreshed = getWorkbenchProjectOverview({ workspaceDir, projectId: "repo-a" });
    assert.ok(refreshed.ok);
    assert.equal(
      refreshed.data.plans.find((p) => p.id === "plan-completed")!.execution.completion_percent,
      0,
    );
    assert.equal(refreshed.data.reports[0]!.outcome, "completed");
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("Overview sorts Reports by instant then ID rather than filename or timezone spelling", () => {
  const workspaceDir = setupProject();
  try {
    const root = path.join(workspaceDir, "ops/repo-a/reports");
    const original = readFileSync(path.join(root, "report-workbench.md"), "utf8");
    for (const [id, time] of [
      ["report-a", "2026-09-05T09:00:00+09:00"],
      ["report-z", "2026-09-05T01:00:00Z"],
      ["report-b", "2026-09-05T00:00:00Z"],
    ]) {
      writeFileSync(
        path.join(root, `${id}.md`),
        original.replaceAll("report-workbench", id!).replace("2026-09-04T12:00:00+09:00", time!),
      );
    }
    const result = getWorkbenchProjectOverview({ workspaceDir, projectId: "repo-a" });
    assert.ok(result.ok);
    assert.deepEqual(
      result.data.reports.map((report) => report.id),
      ["report-z", "report-a", "report-b", "report-workbench"],
    );
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("Overview derives readable retrospective summaries without changing records", () => {
  const workspaceDir = setupProject();
  try {
    const root = path.join(workspaceDir, "retrospectives");
    for (let i = 0; i < 7; i++)
      writeRetrospective(workspaceDir, root, {
        schema: RETROSPECTIVE_SCHEMA,
        id: `summary-${i}`,
        created_at: `2026-09-05T0${i}:00:00Z`,
        project: i === 6 ? "other" : "repo-a",
        task: null,
        trigger: "workflow-friction",
        status: "inbox",
        harness: "test",
        model: null,
        body:
          i === 5
            ? "## Hidden friction encountered\n\n---"
            : i === 3
              ? "## Hidden friction encountered\n\n" + "长摘要".repeat(100)
              : `## Hidden friction encountered\n\n**Readable ${i}** [details](https://example.test)\n\n## Workarounds used\nOther text`,
      });
    const file = path.join(root, "inbox/summary-4.md");
    const before = readFileSync(file, "utf8");
    writeFileSync(path.join(root, "inbox/bad.md"), "bad");
    const result = getWorkbenchProjectOverview({ workspaceDir, projectId: "repo-a" });
    assert.ok(result.ok);
    assert.equal(result.data.retrospectives.counts.inbox, 7);
    assert.equal(result.data.retrospectives.recent.length, 5);
    assert.equal(result.data.retrospectives.recent[0]!.summary, "summary-5");
    assert.equal(result.data.retrospectives.recent[1]!.summary, "Readable 4 details");
    assert.equal(Array.from(result.data.retrospectives.recent[2]!.summary).length, 161);
    assert.ok(result.data.retrospectives.recent[2]!.summary.endsWith("…"));
    assert.ok(!result.data.retrospectives.recent.some((r) => r.id === "summary-6"));
    assert.ok(result.data.diagnostics.some((d) => d.source === "retrospectives"));
    assert.equal(readFileSync(file, "utf8"), before);
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("Overview exposes four bounded document entries with readability separate from standard checks", () => {
  const workspaceDir = setupProject();
  try {
    rmSync(path.join(workspaceDir, "repo-a/AGENTS.md"));
    writeFileSync(
      path.join(workspaceDir, "repo-a/docs/PRODUCT_SPEC.md"),
      "Readable without heading",
    );
    const result = getWorkbenchProjectOverview({ workspaceDir, projectId: "repo-a" });
    assert.ok(result.ok);
    assert.deepEqual(
      result.data.docs.documents.map((d) => d.path),
      ["README.md", "AGENTS.md", "docs/PRODUCT_SPEC.md", "docs/ARCHITECTURE.md"],
    );
    assert.equal(result.data.docs.documents[1]!.readable, false);
    assert.match(result.data.docs.documents[1]!.issue!, /不存在/);
    assert.equal(result.data.docs.documents[2]!.readable, true);
    assert.match(result.data.docs.documents[2]!.issue!, /heading/);
    assert.equal(result.data.docs.healthy, false);
    assert.ok(!JSON.stringify(result.data.docs).includes("Readable without heading"));
    rmSync(path.join(workspaceDir, "repo-a"), { recursive: true });
    const unavailable = getWorkbenchProjectOverview({ workspaceDir, projectId: "repo-a" });
    assert.ok(unavailable.ok);
    assert.equal(unavailable.data.docs.healthy, false);
    assert.ok(unavailable.data.docs.documents.every((d) => !d.readable && d.issue));
    assert.ok(unavailable.data.diagnostics.some((d) => d.source === "docs"));
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
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
  assert.deepEqual(
    first.data.backlog.recent.map((item) => item.id),
    ["REP-001"],
  );
  assert.deepEqual(first.data.plans, [
    {
      id: "plan-workbench",
      title: "Workbench",
      status: "draft",
      item_count: 1,
      execution: {
        prerequisites: { evidence: [], diagnostics: [] },
        materialized: false,
        counts: {
          total: 0,
          todo: 0,
          in_progress: 0,
          done: 0,
          blocked: 0,
          cancelled: 0,
          unreadable: 0,
        },
        completion_percent: null,
        diagnostics: [],
      },
    },
  ]);
  assert.deepEqual(first.data.reports, [
    {
      id: "report-workbench",
      title: "Workbench delivery",
      outcome: "completed",
      created_at: "2026-09-04T12:00:00+09:00",
    },
  ]);
  assert.equal(first.data.docs.healthy, true);
  assert.deepEqual(first.data.docs.problems, []);
  assert.ok(first.data.docs.documents.every((d) => d.readable && !d.issue));
  assert.deepEqual(first.data.retrospectives.counts, { inbox: 1, active: 0, archive: 0 });
  assert.deepEqual(first.data.retrospectives.recent, [
    {
      id: "workbench-friction",
      status: "inbox",
      created_at: "2026-09-04T12:30:00+09:00",
      path: "inbox/workbench-friction.md",
      summary: "Captured.",
    },
  ]);
  assert.deepEqual(first.data.diagnostics, []);
  assert.equal(JSON.stringify(first.data).includes(workspaceDir), false);
});

test("Workbench project overview isolates malformed and missing domain data", () => {
  const workspaceDir = setupProject();
  const ops = path.join(workspaceDir, "ops", "repo-a");
  rmSync(path.join(ops, "plans", "plan-workbench.json"));
  writeFileSync(path.join(ops, "plans", "plan-broken.json"), "{invalid", "utf8");
  rmSync(path.join(ops, "reports"), { recursive: true });
  writeFileSync(
    path.join(workspaceDir, "retrospectives", "inbox", "broken.md"),
    "not frontmatter\n",
    "utf8",
  );
  writeFileSync(path.join(ops, "backlog", "items", "REP-001.md"), "not frontmatter\n", "utf8");

  const result = getWorkbenchProjectOverview({ workspaceDir, projectId: "repo-a" });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.backlog.counts.todo, 0);
  assert.deepEqual(result.data.plans, []);
  assert.deepEqual(result.data.reports, []);
  assert.ok(
    result.data.diagnostics.some(
      (entry) => entry.source === "backlog" && entry.code === "ITEM_INVALID",
    ),
  );
  assert.ok(
    result.data.diagnostics.some(
      (entry) => entry.source === "plans" && entry.reference === "plans/plan-broken.json",
    ),
  );
  assert.ok(result.data.diagnostics.some((entry) => entry.source === "reports"));
  assert.ok(
    result.data.diagnostics.some(
      (entry) => entry.source === "retrospectives" && entry.reference === "inbox/broken.md",
    ),
  );
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
  assert.ok(
    result.data.diagnostics.some(
      (entry) => entry.source === "backlog" && entry.code === "BACKLOG_STORE_INVALID",
    ),
  );
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
  assert.ok(
    result.data.diagnostics.some(
      (entry) =>
        entry.source === "plans" &&
        entry.code === "ARTIFACT_INVALID" &&
        entry.reference === "plans/plan-workbench.json",
    ),
  );
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
  assert.ok(
    result.data.diagnostics.some(
      (entry) => entry.source === "backlog" && entry.code === "ITEM_ID_MISMATCH",
    ),
  );
});
