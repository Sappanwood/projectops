import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const CLI = path.join(REPO_ROOT, "dist", "cli.js");
const README = readFileSync(path.join(REPO_ROOT, "README.md"), "utf8");
const PROJECT_ID = "my-app";

function pops(cwd: string, args: string[]): { code: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 30_000,
    killSignal: "SIGTERM",
  });
  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

function expectOk(result: ReturnType<typeof pops>): void {
  assert.equal(result.code, 0, result.stderr);
}

test("README workflow is executable for my-app and its MYA backlog", () => {
  assert.match(README, /pops project add my-app/);
  assert.match(README, /MYA-001/);
  assert.match(README, /--body[ =]"First task body\."/);
  assert.match(README, /node -e/);
  assert.match(README, /pops report create my-app plan-release-workflow/);
  assert.match(README, /pops report list my-app --json/);
  assert.match(README, /pops report show my-app report-release-workflow --json/);

  const parent = mkdtempSync(path.join(tmpdir(), "pops-readme-"));
  const workspace = path.join(parent, "my-workspace");

  try {
    expectOk(pops(parent, ["init", workspace]));
    mkdirSync(path.join(workspace, PROJECT_ID));
    expectOk(pops(workspace, ["project", "add", PROJECT_ID]));

    const projects = JSON.parse(pops(workspace, ["project", "list", "--json"]).stdout) as {
      projects: { id: string; path: string }[];
    };
    assert.deepEqual(projects.projects, [{ id: PROJECT_ID, path: PROJECT_ID }]);
    expectOk(pops(workspace, ["project", "doctor"]));

    expectOk(pops(workspace, ["docs", "scaffold", PROJECT_ID, "--json"]));
    const docsCheck = pops(workspace, ["docs", "check", PROJECT_ID, "--json"]);
    expectOk(docsCheck);
    assert.deepEqual(JSON.parse(docsCheck.stdout), { ok: true, project: PROJECT_ID, problems: [] });

    expectOk(pops(workspace, ["backlog", "init", PROJECT_ID]));
    expectOk(pops(workspace, [
      "backlog", "add", PROJECT_ID,
      "-T", "First task", "-c", "feature", "--priority", "P1", "--body", "First task body.",
    ]));

    const first = JSON.parse(pops(workspace, ["backlog", "show", PROJECT_ID, "MYA-001", "--json"]).stdout) as {
      id: string;
      body: string;
      revision: string;
    };
    assert.equal(first.id, "MYA-001");
    assert.equal(first.body, "First task body.\n");
    const revisionScript = [
      "const { readFileSync } = require('node:fs');",
      "const text = readFileSync('ops/my-app/backlog/items/MYA-001.md', 'utf8');",
      "const match = /^revision: ([0-9a-f]+)$/m.exec(text);",
      "if (!match) process.exit(1);",
      "process.stdout.write(match[1]);",
    ].join(" ");
    const revisionResult = spawnSync(process.execPath, ["-e", revisionScript], {
      cwd: workspace,
      encoding: "utf8",
    });
    assert.equal(revisionResult.status, 0, revisionResult.stderr);
    assert.equal(revisionResult.stdout, first.revision);

    const updated = pops(workspace, [
      "backlog", "update", PROJECT_ID, "MYA-001",
      "--status", "in_progress", "--expected-revision", revisionResult.stdout,
    ]);
    expectOk(updated);
    const afterUpdate = readFileSync(path.join(workspace, "ops", PROJECT_ID, "backlog", "items", "MYA-001.md"), "utf8");
    assert.match(afterUpdate, /status: in_progress/);
    assert.match(afterUpdate, /First task body\./);

    const beforeStaleUpdate = afterUpdate;
    const stale = pops(workspace, [
      "backlog", "update", PROJECT_ID, "MYA-001",
      "--status", "done", "--expected-revision", "deadbeef",
    ]);
    assert.equal(stale.code, 1);
    assert.match(stale.stderr, /revision/i);
    assert.equal(readFileSync(path.join(workspace, "ops", PROJECT_ID, "backlog", "items", "MYA-001.md"), "utf8"), beforeStaleUpdate);

    const inputPath = path.join(workspace, "release-plan.json");
    writeFileSync(inputPath, `${JSON.stringify({
      title: "Release workflow",
      goal: "Publish a repeatable release.",
      items: [{
        key: "publish",
        title: "Publish release",
        item_type: "task",
        priority: "P1",
        body: "Publish the package.",
      }],
    }, null, 2)}\n`, "utf8");
    expectOk(pops(workspace, ["plan", "create", PROJECT_ID, "--input", inputPath, "--json"]));
    expectOk(pops(workspace, ["plan", "list", PROJECT_ID, "--json"]));
    expectOk(pops(workspace, ["plan", "show", PROJECT_ID, "plan-release-workflow", "--json"]));
    expectOk(pops(workspace, ["plan", "validate", PROJECT_ID, "plan-release-workflow", "--json"]));
    expectOk(pops(workspace, [
      "plan", "approve", PROJECT_ID, "plan-release-workflow",
      "--review-note", "Reviewed for release.", "--json",
    ]));

    const materialized = pops(workspace, ["plan", "materialize", PROJECT_ID, "plan-release-workflow", "--json"]);
    expectOk(materialized);
    const receipt = JSON.parse(materialized.stdout) as { mapping: Record<string, string> };
    assert.deepEqual(receipt.mapping, { publish: "MYA-002" });

    const planItem = JSON.parse(pops(workspace, ["backlog", "show", PROJECT_ID, "MYA-002", "--json"]).stdout) as {
      body: string;
      revision: string;
    };
    assert.equal(planItem.body, "Publish the package.\n");

    expectOk(pops(workspace, [
      "backlog", "update", PROJECT_ID, "MYA-002",
      "--status", "done", "--expected-revision", planItem.revision,
    ]));

    const reportCreated = pops(workspace, [
      "report", "create", PROJECT_ID, "plan-release-workflow",
      "--verification", "npm test",
      "--repo-doc", "README.md",
      "--json",
    ]);
    expectOk(reportCreated);
    const report = JSON.parse(reportCreated.stdout) as {
      ok: boolean;
      report: {
        outcome: string;
        plan: string;
        verification: string[];
        repo_docs: string[];
        backlog: { id: string; status: string; revision?: string; uri: string }[];
      };
    };
    assert.equal(report.ok, true);
    assert.equal(report.report.outcome, "completed");
    assert.equal(report.report.plan, "project-ops:plans/plan-release-workflow.json");
    assert.deepEqual(report.report.verification, ["npm test"]);
    assert.deepEqual(report.report.repo_docs, ["README.md"]);
    assert.deepEqual(report.report.backlog, [{
      id: "MYA-002",
      status: "done",
      revision: report.report.backlog[0]?.revision,
      uri: "project-ops:backlog/items/MYA-002.md",
    }]);

    const reportList = pops(workspace, ["report", "list", PROJECT_ID, "--json"]);
    expectOk(reportList);
    const listed = JSON.parse(reportList.stdout) as { ok: boolean; reports: { id: string; outcome: string; plan: string }[] };
    assert.equal(listed.ok, true);
    assert.deepEqual(listed.reports.map(({ id, outcome, plan }) => ({ id, outcome, plan })), [{
      id: "report-release-workflow",
      outcome: "completed",
      plan: "project-ops:plans/plan-release-workflow.json",
    }]);

    const reportShown = pops(workspace, ["report", "show", PROJECT_ID, "report-release-workflow", "--json"]);
    expectOk(reportShown);
    const shown = JSON.parse(reportShown.stdout) as {
      id: string;
      outcome: string;
      plan: string;
      verification: string[];
      repo_docs: string[];
      backlog: { id: string; status: string; revision?: string; uri: string }[];
    };
    assert.equal(shown.id, "report-release-workflow");
    assert.equal(shown.outcome, report.report.outcome);
    assert.equal(shown.plan, report.report.plan);
    assert.deepEqual(shown.verification, report.report.verification);
    assert.deepEqual(shown.repo_docs, report.report.repo_docs);
    assert.deepEqual(shown.backlog, report.report.backlog);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
