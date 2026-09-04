import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

// Runs the built CLI as a real subprocess: the closest thing to a user invocation.
const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const CLI = path.join(REPO_ROOT, "dist", "cli.js");
const BUILT_CLI_TIMEOUT_MS = 30_000;
const PROJECT_DOCS = [
  "README.md",
  "AGENTS.md",
  path.join("docs", "PRODUCT_SPEC.md"),
  path.join("docs", "ARCHITECTURE.md"),
];

function pops(cwd: string, args: string[]): { code: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    timeout: BUILT_CLI_TIMEOUT_MS,
    killSignal: "SIGTERM",
  });
  return {
    code: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? result.error?.message ?? "",
  };
}

test("end-to-end smoke: init, register, backlog bootstrap and CRUD", () => {
  const ws = mkdtempSync(path.join(tmpdir(), "pops-smoke-"));

  try {
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
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("end-to-end smoke: Plan lifecycle, Backlog materialization and Delivery Report", () => {
  const ws = mkdtempSync(path.join(tmpdir(), "pops-plan-smoke-"));

  try {
    let r = pops(ws, ["init"]);
    assert.equal(r.code, 0, r.stderr);

    mkdirSync(path.join(ws, "app"));
    r = pops(ws, ["project", "add", "app"]);
    assert.equal(r.code, 0, r.stderr);

    r = pops(ws, ["backlog", "init", "app"]);
    assert.equal(r.code, 0, r.stderr);

    const inputPath = path.join(ws, "release-plan.json");
    writeFileSync(inputPath, `${JSON.stringify({
      title: "Release workflow",
      goal: "Publish a repeatable release.",
      items: [
        {
          key: "release",
          title: "Release",
          item_type: "epic",
          priority: "P1",
          body: "Release work.",
        },
        {
          key: "prepare",
          title: "Prepare release",
          item_type: "task",
          priority: "P1",
          body: "Update release notes.",
          parent: "release",
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
    }, null, 2)}\n`, "utf8");

    r = pops(ws, ["plan", "create", "app", "--input", inputPath, "--json"]);
    assert.equal(r.code, 0, r.stderr);
    const created = JSON.parse(r.stdout) as { ok: boolean; plan: { id: string; status: string } };
    assert.deepEqual(created, {
      ok: true,
      plan: {
        schema: "plan/Plan@1",
        id: "plan-release-workflow",
        title: "Release workflow",
        goal: "Publish a repeatable release.",
        items: [
          { key: "release", title: "Release", item_type: "epic", priority: "P1", body: "Release work.", depends_on: [] },
          { key: "prepare", title: "Prepare release", item_type: "task", priority: "P1", body: "Update release notes.", parent: "release", depends_on: [] },
          { key: "publish", title: "Publish release", item_type: "task", priority: "P1", body: "Publish the package.", parent: "release", depends_on: ["prepare"] },
        ],
        status: "draft",
      },
    });

    r = pops(ws, ["plan", "list", "app", "--json"]);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), {
      ok: true,
      plans: [{ id: "plan-release-workflow", title: "Release workflow", goal: "Publish a repeatable release.", item_count: 3 }],
    });

    r = pops(ws, ["plan", "show", "app", "plan-release-workflow", "--json"]);
    assert.equal(r.code, 0, r.stderr);
    const shown = JSON.parse(r.stdout) as { items: { key: string; parent?: string; depends_on: string[] }[] };
    assert.deepEqual(shown.items.map(({ key, parent, depends_on }) => ({ key, parent, depends_on })), [
      { key: "release", parent: undefined, depends_on: [] },
      { key: "prepare", parent: "release", depends_on: [] },
      { key: "publish", parent: "release", depends_on: ["prepare"] },
    ]);

    r = pops(ws, ["plan", "validate", "app", "plan-release-workflow", "--json"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal((JSON.parse(r.stdout) as { ok: boolean; plan: { status: string } }).ok, true);
    assert.equal((JSON.parse(r.stdout) as { plan: { status: string } }).plan.status, "draft");

    r = pops(ws, [
      "plan", "approve", "app", "plan-release-workflow",
      "--review-note", "Reviewed for release.", "--json",
    ]);
    assert.equal(r.code, 0, r.stderr);
    const approved = JSON.parse(r.stdout) as { ok: boolean; plan: { status: string; approval: { review_note: string } } };
    assert.equal(approved.ok, true);
    assert.equal(approved.plan.status, "approved");
    assert.equal(approved.plan.approval.review_note, "Reviewed for release.");

    r = pops(ws, ["plan", "materialize", "app", "plan-release-workflow", "--json"]);
    assert.equal(r.code, 0, r.stderr);
    const materialized = JSON.parse(r.stdout) as {
      ok: boolean;
      no_op: boolean;
      plan_id: string;
      mapping: Record<string, string>;
      items: { key: string; id: string; disposition: string }[];
    };
    assert.equal(materialized.ok, true);
    assert.equal(materialized.no_op, false);
    assert.equal(materialized.plan_id, "plan-release-workflow");
    assert.deepEqual(materialized.mapping, {
      release: "APP-001",
      prepare: "APP-002",
      publish: "APP-003",
    });
    assert.deepEqual(materialized.items.map(({ key, id, disposition }) => ({ key, id, disposition })), [
      { key: "release", id: "APP-001", disposition: "created" },
      { key: "prepare", id: "APP-002", disposition: "created" },
      { key: "publish", id: "APP-003", disposition: "created" },
    ]);

    r = pops(ws, ["backlog", "list", "app", "--json"]);
    assert.equal(r.code, 0, r.stderr);
    const listed = JSON.parse(r.stdout) as { ok: boolean; items: { id: string; parent_id: string | null }[] };
    assert.equal(listed.ok, true);
    assert.deepEqual(listed.items.map(({ id }) => id), ["APP-001", "APP-002", "APP-003"]);
    assert.equal(listed.items.find(({ id }) => id === "APP-002")?.parent_id, "APP-001");

    r = pops(ws, ["backlog", "show", "app", "APP-003", "--json"]);
    assert.equal(r.code, 0, r.stderr);
    const publish = JSON.parse(r.stdout) as { parent_id: string | null; depends_on: string[] };
    assert.equal(publish.parent_id, "APP-001");
    assert.deepEqual(publish.depends_on, ["APP-002"]);

    r = pops(ws, ["plan", "show", "app", "plan-release-workflow", "--json"]);
    assert.equal(r.code, 0, r.stderr);
    const stored = JSON.parse(r.stdout) as { materialization: { mapping: Record<string, string> } };
    assert.deepEqual(stored.materialization.mapping, materialized.mapping);

    r = pops(ws, ["plan", "materialize", "app", "plan-release-workflow", "--json"]);
    assert.equal(r.code, 0, r.stderr);
    const retry = JSON.parse(r.stdout) as {
      no_op: boolean;
      mapping: Record<string, string>;
      items: { key: string; id: string; disposition: string }[];
    };
    assert.equal(retry.no_op, true);
    assert.deepEqual(retry.mapping, materialized.mapping);
    assert.deepEqual(retry.items.map(({ key, id, disposition }) => ({ key, id, disposition })), [
      { key: "release", id: "APP-001", disposition: "reused" },
      { key: "prepare", id: "APP-002", disposition: "reused" },
      { key: "publish", id: "APP-003", disposition: "reused" },
    ]);

    r = pops(ws, ["backlog", "list", "app", "--json"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal((JSON.parse(r.stdout) as { items: unknown[] }).items.length, 3);

    for (const id of ["APP-002", "APP-003"]) {
      r = pops(ws, ["backlog", "show", "app", id, "--json"]);
      assert.equal(r.code, 0, r.stderr);
      const item = JSON.parse(r.stdout) as { revision: string };
      r = pops(ws, [
        "backlog", "update", "app", id,
        "--status", "done", "--expected-revision", item.revision,
      ]);
      assert.equal(r.code, 0, r.stderr);
    }

    r = pops(ws, [
      "report", "create", "app", "plan-release-workflow",
      "--report-id", "report-release-smoke",
      "--verification", "npm test",
      "--verification", "npm run typecheck",
      "--repo-doc", "project-ops:repo/README.md",
      "--json",
    ]);
    assert.equal(r.code, 0, r.stderr);
    const createdReport = JSON.parse(r.stdout) as {
      ok: boolean;
      report: {
        created_at: string;
        outcome: string;
        plan: string;
        verification: string[];
        backlog: { id: string; status: string; uri: string }[];
      };
    };
    assert.equal(createdReport.ok, true);
    assert.equal(createdReport.report.outcome, "completed");
    assert.equal(createdReport.report.plan, "project-ops:plans/plan-release-workflow.json");
    assert.deepEqual(createdReport.report.verification, ["npm test", "npm run typecheck"]);
    assert.deepEqual(createdReport.report.backlog.map(({ id, status, uri }) => ({ id, status, uri })), [
      { id: "APP-001", status: "todo", uri: "project-ops:backlog/items/APP-001.md" },
      { id: "APP-002", status: "done", uri: "project-ops:backlog/items/APP-002.md" },
      { id: "APP-003", status: "done", uri: "project-ops:backlog/items/APP-003.md" },
    ]);

    const reportPath = path.join(ws, "ops", "app", "reports", "report-release-smoke.md");
    const reportBeforeDuplicate = readFileSync(reportPath, "utf8");
    r = pops(ws, [
      "report", "create", "app", "plan-release-workflow",
      "--report-id", "report-release-smoke", "--verification", "npm test", "--json",
    ]);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /Report already exists: report-release-smoke/);
    assert.equal(readFileSync(reportPath, "utf8"), reportBeforeDuplicate);

    r = pops(ws, ["report", "list", "app", "--json"]);
    assert.equal(r.code, 0, r.stderr);
    const listedReports = JSON.parse(r.stdout) as {
      ok: boolean;
      reports: { id: string; title: string; project: string; created_at: string; outcome: string; plan: string }[];
    };
    assert.equal(listedReports.ok, true);
    assert.deepEqual(listedReports.reports, [{
      id: "report-release-smoke",
      title: "Release workflow",
      project: "app",
      created_at: createdReport.report.created_at,
      outcome: "completed",
      plan: "project-ops:plans/plan-release-workflow.json",
    }]);

    r = pops(ws, ["report", "show", "app", "report-release-smoke", "--json"]);
    assert.equal(r.code, 0, r.stderr);
    const shownReport = JSON.parse(r.stdout) as {
      id: string;
      outcome: string;
      plan: string;
      verification: string[];
      backlog: { id: string; status: string; uri: string }[];
    };
    assert.equal(shownReport.id, "report-release-smoke");
    assert.equal(shownReport.outcome, "completed");
    assert.equal(shownReport.plan, createdReport.report.plan);
    assert.deepEqual(shownReport.verification, createdReport.report.verification);
    assert.deepEqual(shownReport.backlog, createdReport.report.backlog);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("end-to-end smoke: Project Docs scaffold, no-clobber and check diagnostics", () => {
  const ws = mkdtempSync(path.join(tmpdir(), "pops-docs-smoke-"));

  try {
    let r = pops(ws, ["init"]);
    assert.equal(r.code, 0, r.stderr);

    mkdirSync(path.join(ws, "app"));
    r = pops(ws, ["project", "add", "app"]);
    assert.equal(r.code, 0, r.stderr);

    r = pops(ws, ["docs", "scaffold", "app", "--json"]);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), {
      ok: true,
      project: "app",
      created: PROJECT_DOCS,
      skipped: [],
    });

    r = pops(ws, ["docs", "check", "app", "--json"]);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), {
      ok: true,
      project: "app",
      problems: [],
    });

    const project = path.join(ws, "app");
    const readme = path.join(project, "README.md");
    const handwritten = "# Handwritten README\n\nThis content belongs to the project.\n";
    writeFileSync(readme, handwritten, "utf8");
    const beforeSecondScaffold = new Map(
      PROJECT_DOCS.map((target) => [target, readFileSync(path.join(project, target))]),
    );

    r = pops(ws, ["docs", "scaffold", "app", "--json"]);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), {
      ok: true,
      project: "app",
      created: [],
      skipped: PROJECT_DOCS,
    });
    for (const target of PROJECT_DOCS) {
      assert.deepEqual(readFileSync(path.join(project, target)), beforeSecondScaffold.get(target));
    }
    assert.equal(readFileSync(readme, "utf8"), handwritten);

    rmSync(path.join(project, "docs", "PRODUCT_SPEC.md"));
    r = pops(ws, ["docs", "check", "app", "--json"]);
    assert.equal(r.code, 1, r.stderr);
    const failed = JSON.parse(r.stdout) as {
      ok: boolean;
      project: string;
      problems: { path: string; issue: string }[];
    };
    assert.equal(failed.ok, false);
    assert.equal(failed.project, "app");
    assert.deepEqual(failed.problems, [{
      path: path.join("docs", "PRODUCT_SPEC.md"),
      issue: "document is missing",
    }]);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
