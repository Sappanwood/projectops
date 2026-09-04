import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { readPlan } from "../src/plan/planFs.js";
import { readReport } from "../src/report/reportFs.js";
import {
  ReportGenerationError,
  generateReport,
  writeGeneratedReport,
} from "../src/useCases/reportGenerate.js";
import { runCli } from "../src/app.js";

function freshDir(): string {
  return mkdtempSync(path.join(tmpdir(), "pops-report-generation-"));
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

function setupWorkspace(): string {
  const workspace = freshDir();
  assert.equal(run(["init"], workspace).code, 0);
  mkdirSync(path.join(workspace, "repo-a"));
  assert.equal(run(["project", "add", "repo-a"], workspace).code, 0);
  assert.equal(run(["backlog", "init", "repo-a"], workspace).code, 0);
  return workspace;
}

function createMaterializedPlan(workspace: string, includeEpic = false): {
  plan: ReturnType<typeof readPlan>;
  workspaceRoot: string;
  backlogRoot: string;
  reportsRoot: string;
} {
  const planPath = path.join(workspace, "plan-draft.json");
  writeFileSync(planPath, `${JSON.stringify({
    title: "Release workflow",
    goal: "Publish a repeatable release.",
    items: [
      ...(includeEpic ? [{
        key: "release",
        title: "Release",
        item_type: "epic",
        priority: "P1",
        body: "Release work.",
        depends_on: [],
      }] : []),
      {
        key: "prepare",
        title: "Prepare release",
        item_type: "task",
        priority: "P1",
        body: "Update release notes.",
        ...(includeEpic ? { parent: "release" } : {}),
        depends_on: [],
      },
      {
        key: "publish",
        title: "Publish release",
        item_type: "task",
        priority: "P1",
        body: "Publish the package.",
        ...(includeEpic ? { parent: "release" } : {}),
        depends_on: ["prepare"],
      },
    ],
  }, null, 2)}\n`, "utf8");
  assert.equal(run(["plan", "create", "repo-a", "--input", planPath], workspace).code, 0);
  assert.equal(run(["plan", "approve", "repo-a", "plan-release-workflow", "--review-note", "Reviewed."], workspace).code, 0);
  assert.equal(run(["plan", "materialize", "repo-a", "plan-release-workflow"], workspace).code, 0);

  return {
    plan: readPlan(path.join(workspace, "ops", "repo-a", "plans"), "plan-release-workflow"),
    workspaceRoot: workspace,
    backlogRoot: path.join(workspace, "ops", "repo-a", "backlog"),
    reportsRoot: path.join(workspace, "ops", "repo-a", "reports"),
  };
}

function inputFor(values: ReturnType<typeof createMaterializedPlan>) {
  return {
    projectId: "repo-a",
    plansRoot: path.join(values.workspaceRoot, "ops", "repo-a", "plans"),
    planId: values.plan.id,
    backlogRoot: values.backlogRoot,
    reportId: "report-release-workflow",
    title: "Release workflow",
    verification: ["npm test"],
  };
}

function writePlanArtifact(values: ReturnType<typeof createMaterializedPlan>, plan: unknown): void {
  writeFileSync(
    path.join(values.workspaceRoot, "ops", "repo-a", "plans", `${values.plan.id}.json`),
    `${JSON.stringify(plan, null, 2)}\n`,
    "utf8",
  );
}

function markDone(workspace: string, id: string): void {
  const item = JSON.parse(run(["backlog", "show", "repo-a", id, "--json"], workspace).stdout[0] ?? "null") as { revision: string };
  assert.equal(run(["backlog", "update", "repo-a", id, "--status", "done", "--expected-revision", item.revision], workspace).code, 0);
}

test("Report generation derives completed from every mapped backlog item and records evidence", () => {
  const values = createMaterializedPlan(setupWorkspace());
  markDone(values.workspaceRoot, "REP-001");
  markDone(values.workspaceRoot, "REP-002");

  const report = generateReport(inputFor(values));

  assert.equal(report.outcome, "completed");
  assert.equal(report.plan, "project-ops:plans/plan-release-workflow.json");
  assert.deepEqual(report.backlog, [
    { id: "REP-001", status: "done", revision: report.backlog[0]?.revision, uri: "project-ops:backlog/items/REP-001.md" },
    { id: "REP-002", status: "done", revision: report.backlog[1]?.revision, uri: "project-ops:backlog/items/REP-002.md" },
  ]);
  assert.deepEqual(report.verification, ["npm test"]);
  rmSync(values.workspaceRoot, { recursive: true, force: true });
});

test("Report generation ignores a mapped epic's unfinished status when all mapped tasks are done", () => {
  const values = createMaterializedPlan(setupWorkspace(), true);
  markDone(values.workspaceRoot, "REP-002");
  markDone(values.workspaceRoot, "REP-003");

  const report = generateReport(inputFor(values));

  assert.equal(report.outcome, "completed");
  assert.deepEqual(report.backlog.map((item) => ({ id: item.id, status: item.status })), [
    { id: "REP-001", status: "todo" },
    { id: "REP-002", status: "done" },
    { id: "REP-003", status: "done" },
  ]);
  rmSync(values.workspaceRoot, { recursive: true, force: true });
});

test("Report generation rejects unfinished work without writing a report", () => {
  const values = createMaterializedPlan(setupWorkspace());
  assert.throws(
    () => writeGeneratedReport({ ...inputFor(values), workspaceRoot: values.workspaceRoot, reportsRoot: values.reportsRoot }),
    (error: unknown) => error instanceof ReportGenerationError && /unfinished|partial/i.test(error.message),
  );
  assert.equal(existsSync(path.join(values.reportsRoot, "report-release-workflow.md")), false);
  rmSync(values.workspaceRoot, { recursive: true, force: true });
});

test("Report generation requires explicit non-empty partial acceptance and preserves its explanation", () => {
  const values = createMaterializedPlan(setupWorkspace());
  const report = writeGeneratedReport({
    ...inputFor(values),
    workspaceRoot: values.workspaceRoot,
    reportsRoot: values.reportsRoot,
    partialAcceptance: "Publish is deferred until the registry window opens.",
  });

  assert.equal(report.outcome, "partial");
  assert.deepEqual(report.deviations, ["Publish is deferred until the registry window opens."]);
  assert.deepEqual(readReport(values.workspaceRoot, values.reportsRoot, report.id), report);

  const secondValues = createMaterializedPlan(setupWorkspace());
  assert.throws(
    () => generateReport({ ...inputFor(secondValues), partialAcceptance: "  " }),
    (error: unknown) => error instanceof ReportGenerationError && /non-empty|explanation/i.test(error.message),
  );
  rmSync(values.workspaceRoot, { recursive: true, force: true });
  rmSync(secondValues.workspaceRoot, { recursive: true, force: true });
});

test("Report generation rejects missing or cross-project mapped backlog references without writing", () => {
  const values = createMaterializedPlan(setupWorkspace());
  const missingPlan = {
    ...values.plan,
    materialization: {
      ...values.plan.materialization!,
      mapping: { prepare: "REP-001", publish: "REP-099" },
    },
  };
  writePlanArtifact(values, missingPlan);
  assert.throws(
    () => writeGeneratedReport({ ...inputFor(values), workspaceRoot: values.workspaceRoot, reportsRoot: values.reportsRoot }),
    (error: unknown) => error instanceof ReportGenerationError && /not found|missing/i.test(error.message),
  );
  assert.equal(existsSync(path.join(values.reportsRoot, "report-release-workflow.md")), false);

  const outsideWorkspace = freshDir();
  const outsideBacklogRoot = path.join(outsideWorkspace, "backlog");
  mkdirSync(path.join(outsideBacklogRoot, "items"), { recursive: true });
  writeFileSync(path.join(outsideBacklogRoot, "backlog.json"), `${JSON.stringify({
    schema: "backlog/Store@1",
    project_id: "other-project",
    id_prefix: "OTH",
  })}\n`, "utf8");
  const crossProjectPlan = {
    ...values.plan,
    materialization: {
      ...values.plan.materialization!,
      mapping: { prepare: "OTH-001", publish: "OTH-002" },
    },
  };
  writePlanArtifact(values, crossProjectPlan);
  assert.throws(
    () => writeGeneratedReport({ ...inputFor(values), backlogRoot: outsideBacklogRoot, workspaceRoot: values.workspaceRoot, reportsRoot: values.reportsRoot }),
    (error: unknown) => error instanceof ReportGenerationError && /project|cross/i.test(error.message),
  );
  assert.equal(existsSync(path.join(values.reportsRoot, "report-release-workflow.md")), false);

  rmSync(values.workspaceRoot, { recursive: true, force: true });
  rmSync(outsideWorkspace, { recursive: true, force: true });
});

test("Report generation rejects an unmaterialized Plan before any Report write", () => {
  const values = createMaterializedPlan(setupWorkspace());
  const { materialization: _materialization, ...unmaterialized } = values.plan;
  writePlanArtifact(values, unmaterialized);

  assert.throws(
    () => writeGeneratedReport({ ...inputFor(values), workspaceRoot: values.workspaceRoot, reportsRoot: values.reportsRoot }),
    (error: unknown) => error instanceof ReportGenerationError && /materialized/i.test(error.message),
  );
  assert.equal(existsSync(path.join(values.reportsRoot, "report-release-workflow.md")), false);
  rmSync(values.workspaceRoot, { recursive: true, force: true });
});

test("Report generation rejects a missing Plan without writing a report", () => {
  const values = createMaterializedPlan(setupWorkspace());

  assert.throws(
    () => writeGeneratedReport({ ...inputFor(values), planId: "plan-missing", workspaceRoot: values.workspaceRoot, reportsRoot: values.reportsRoot }),
    (error: unknown) => error instanceof ReportGenerationError && /not found|missing/i.test(error.message),
  );
  assert.equal(existsSync(path.join(values.reportsRoot, "report-release-workflow.md")), false);
  rmSync(values.workspaceRoot, { recursive: true, force: true });
});

test("Report generation rejects a materialization mapping that omits a Plan item without writing", () => {
  const values = createMaterializedPlan(setupWorkspace());
  const malformedPlan = {
    ...values.plan,
    materialization: {
      ...values.plan.materialization!,
      mapping: { prepare: "REP-001" },
    },
  };
  writePlanArtifact(values, malformedPlan);

  assert.throws(
    () => writeGeneratedReport({ ...inputFor(values), workspaceRoot: values.workspaceRoot, reportsRoot: values.reportsRoot }),
    (error: unknown) => error instanceof ReportGenerationError && /mapping|include|missing/i.test(error.message),
  );
  assert.equal(existsSync(path.join(values.reportsRoot, "report-release-workflow.md")), false);
  rmSync(values.workspaceRoot, { recursive: true, force: true });
});
