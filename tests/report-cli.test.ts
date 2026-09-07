import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { runCli } from "../src/app.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const BUILT_CLI = path.join(REPO_ROOT, "dist", "cli.js");

function freshDir(): string {
  return mkdtempSync(path.join(tmpdir(), "pops-report-cli-"));
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

function runBuilt(args: string[], cwd: string): { code: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [BUILT_CLI, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 30_000,
    killSignal: "SIGTERM",
  });
  return { code: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function setupWorkspace(): string {
  const workspace = freshDir();
  assert.equal(run(["init"], workspace).code, 0);
  mkdirSync(path.join(workspace, "repo-a"));
  assert.equal(run(["project", "add", "repo-a"], workspace).code, 0);
  assert.equal(run(["backlog", "init", "repo-a"], workspace).code, 0);
  return workspace;
}

function materializePlan(workspace: string): void {
  const draft = path.join(workspace, "release.json");
  writeFileSync(
    draft,
    `${JSON.stringify(
      {
        title: "Release workflow",
        goal: "Publish a repeatable release.",
        items: [
          {
            key: "prepare",
            title: "Prepare release",
            item_type: "task",
            priority: "P1",
            body: "Prepare.",
          },
          {
            key: "publish",
            title: "Publish release",
            item_type: "task",
            priority: "P1",
            body: "Publish.",
            depends_on: ["prepare"],
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  assert.equal(run(["plan", "create", "repo-a", "--input", draft], workspace).code, 0);
  assert.equal(
    run(
      ["plan", "approve", "repo-a", "plan-release-workflow", "--review-note", "Reviewed."],
      workspace,
    ).code,
    0,
  );
  assert.equal(run(["plan", "materialize", "repo-a", "plan-release-workflow"], workspace).code, 0);
}

function materializePendingPlan(workspace: string): void {
  const draft = path.join(workspace, "maintenance.json");
  writeFileSync(
    draft,
    `${JSON.stringify(
      {
        title: "Maintenance workflow",
        goal: "Keep the service healthy.",
        items: [
          {
            key: "audit",
            title: "Audit service",
            item_type: "task",
            priority: "P1",
            body: "Audit.",
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  assert.equal(run(["plan", "create", "repo-a", "--input", draft], workspace).code, 0);
  assert.equal(
    run(
      ["plan", "approve", "repo-a", "plan-maintenance-workflow", "--review-note", "Reviewed."],
      workspace,
    ).code,
    0,
  );
  assert.equal(
    run(["plan", "materialize", "repo-a", "plan-maintenance-workflow"], workspace).code,
    0,
  );
}

function markDone(workspace: string, id: string): void {
  const shown = run(["backlog", "show", "repo-a", id, "--json"], workspace);
  assert.equal(shown.code, 0, shown.stderr.join("\n"));
  const item = JSON.parse(shown.stdout[0] ?? "null") as { revision: string };
  assert.equal(
    run(
      ["backlog", "update", "repo-a", id, "--status", "done", "--expected-revision", item.revision],
      workspace,
    ).code,
    0,
  );
}

test("report create/list/show expose a completed Report and preserve no-clobber", () => {
  const workspace = setupWorkspace();
  try {
    materializePlan(workspace);
    markDone(workspace, "REP-001");
    markDone(workspace, "REP-002");

    const created = run(
      [
        "report",
        "create",
        "repo-a",
        "plan-release-workflow",
        "--report-id",
        "report-release-zeta",
        "--verification",
        "npm test",
        "--verification",
        "npm run typecheck",
        "--repo-doc",
        "docs/README.md",
        "--json",
      ],
      workspace,
    );
    assert.equal(created.code, 0, created.stderr.join("\n"));
    assert.deepEqual(JSON.parse(created.stdout[0] ?? "null"), {
      ok: true,
      report: {
        schema: "report/Report@1",
        id: "report-release-zeta",
        title: "Release workflow",
        project: "repo-a",
        created_at: (JSON.parse(created.stdout[0] ?? "null") as { report: { created_at: string } })
          .report.created_at,
        outcome: "completed",
        plan: "project-ops:plans/plan-release-workflow.json",
        backlog: [
          {
            id: "REP-001",
            project: "repo-a",
            status: "done",
            revision: (
              JSON.parse(created.stdout[0] ?? "null") as {
                report: { backlog: [{ revision: string }] };
              }
            ).report.backlog[0].revision,
            uri: "project-ops:backlog/items/REP-001.md",
          },
          {
            id: "REP-002",
            project: "repo-a",
            status: "done",
            revision: (
              JSON.parse(created.stdout[0] ?? "null") as {
                report: { backlog: [{ revision: string }, { revision: string }] };
              }
            ).report.backlog[1].revision,
            uri: "project-ops:backlog/items/REP-002.md",
          },
        ],
        verification: [
          "npm test",
          "npm run typecheck",
          "Task repo-a:REP-001; basis: done; attempt: none; snapshot: none; verification: none; landing: none",
          "Task repo-a:REP-002; basis: done; attempt: none; snapshot: none; verification: none; landing: none",
        ],
        deviations: [],
        workarounds: [],
        repo_docs: ["docs/README.md"],
        body: "",
      },
    });

    const duplicate = run(
      [
        "report",
        "create",
        "repo-a",
        "plan-release-workflow",
        "--report-id",
        "report-release-zeta",
        "--verification",
        "npm test",
        "--json",
      ],
      workspace,
    );
    assert.equal(duplicate.code, 1);
    assert.deepEqual(JSON.parse(duplicate.stdout[0] ?? "null"), {
      ok: false,
      error: "Report already exists: report-release-zeta",
    });
    assert.equal(duplicate.stderr.length, 0);

    const second = run(
      [
        "report",
        "create",
        "repo-a",
        "plan-release-workflow",
        "--report-id",
        "report-release-alpha",
        "--verification",
        "npm test",
        "--json",
      ],
      workspace,
    );
    assert.equal(second.code, 0, second.stderr.join("\n"));

    const listed = run(["report", "list", "repo-a", "--json"], workspace);
    assert.equal(listed.code, 0, listed.stderr.join("\n"));
    assert.deepEqual(JSON.parse(listed.stdout[0] ?? "null"), {
      ok: true,
      reports: [
        {
          id: "report-release-alpha",
          title: "Release workflow",
          project: "repo-a",
          created_at: (JSON.parse(second.stdout[0] ?? "null") as { report: { created_at: string } })
            .report.created_at,
          outcome: "completed",
          plan: "project-ops:plans/plan-release-workflow.json",
        },
        {
          id: "report-release-zeta",
          title: "Release workflow",
          project: "repo-a",
          created_at: (
            JSON.parse(created.stdout[0] ?? "null") as { report: { created_at: string } }
          ).report.created_at,
          outcome: "completed",
          plan: "project-ops:plans/plan-release-workflow.json",
        },
      ],
    });

    const shown = run(["report", "show", "repo-a", "report-release-alpha", "--json"], workspace);
    assert.equal(shown.code, 0, shown.stderr.join("\n"));
    assert.equal(
      (JSON.parse(shown.stdout[0] ?? "null") as { id: string; outcome: string }).id,
      "report-release-alpha",
    );
    assert.equal(
      existsSync(path.join(workspace, "ops", "repo-a", "reports", "report-release-alpha.md")),
      true,
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("report create requires verification and explicit partial acceptance", () => {
  const workspace = setupWorkspace();
  try {
    materializePlan(workspace);

    const noEvidence = run(
      ["report", "create", "repo-a", "plan-release-workflow", "--json"],
      workspace,
    );
    assert.equal(noEvidence.code, 1);
    assert.deepEqual(JSON.parse(noEvidence.stdout[0] ?? "null"), {
      ok: false,
      error: "--verification is required at least once",
    });

    const unfinished = run(
      [
        "report",
        "create",
        "repo-a",
        "plan-release-workflow",
        "--verification",
        "npm test",
        "--json",
      ],
      workspace,
    );
    assert.equal(unfinished.code, 1);
    assert.match(JSON.parse(unfinished.stdout[0] ?? "null").error, /partial acceptance/i);
    assert.equal(
      existsSync(path.join(workspace, "ops", "repo-a", "reports", "report-release-workflow.md")),
      false,
    );

    const partial = run(
      [
        "report",
        "create",
        "repo-a",
        "plan-release-workflow",
        "--verification",
        "npm test",
        "--partial-acceptance",
        "Publish waits for the registry window.",
        "--json",
      ],
      workspace,
    );
    assert.equal(partial.code, 0, partial.stderr.join("\n"));
    const report = JSON.parse(partial.stdout[0] ?? "null").report as {
      outcome: string;
      deviations: string[];
    };
    assert.equal(report.outcome, "partial");
    assert.deepEqual(report.deviations, ["Publish waits for the registry window."]);

    const badPlan = run(
      ["report", "create", "repo-a", "plan-missing", "--verification", "npm test", "--json"],
      workspace,
    );
    assert.equal(badPlan.code, 1);
    assert.match(JSON.parse(badPlan.stdout[0] ?? "null").error, /Plan not found/i);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("built CLI report create returns completed, partial, no-clobber, and invalid-reference results", () => {
  const workspace = setupWorkspace();
  try {
    materializePlan(workspace);
    markDone(workspace, "REP-001");
    markDone(workspace, "REP-002");
    materializePendingPlan(workspace);

    const completed = runBuilt(
      [
        "report",
        "create",
        "repo-a",
        "plan-release-workflow",
        "--report-id",
        "report-release-built",
        "--verification",
        "npm test",
        "--json",
      ],
      workspace,
    );
    assert.equal(completed.code, 0, completed.stderr);
    assert.equal(completed.stderr, "");
    const completedJson = JSON.parse(completed.stdout) as {
      ok: boolean;
      report?: { outcome: string };
    };
    assert.equal(completedJson.ok, true);
    assert.equal(completedJson.report?.outcome, "completed");

    const partial = runBuilt(
      [
        "report",
        "create",
        "repo-a",
        "plan-maintenance-workflow",
        "--report-id",
        "report-maintenance-built",
        "--verification",
        "npm test",
        "--partial-acceptance",
        "Audit waits for the maintenance window.",
        "--json",
      ],
      workspace,
    );
    assert.equal(partial.code, 0, partial.stderr);
    assert.equal(partial.stderr, "");
    const partialJson = JSON.parse(partial.stdout) as { ok: boolean; report?: { outcome: string } };
    assert.equal(partialJson.ok, true);
    assert.equal(partialJson.report?.outcome, "partial");

    const duplicate = runBuilt(
      [
        "report",
        "create",
        "repo-a",
        "plan-release-workflow",
        "--report-id",
        "report-release-built",
        "--verification",
        "npm test",
        "--json",
      ],
      workspace,
    );
    assert.equal(duplicate.code, 1);
    assert.equal(duplicate.stderr, "");
    const duplicateJson = JSON.parse(duplicate.stdout) as {
      ok: boolean;
      report?: unknown;
      error?: string;
    };
    assert.equal(duplicateJson.ok, false);
    assert.equal("report" in duplicateJson, false);
    assert.equal(duplicateJson.error, "Report already exists: report-release-built");

    const invalidReference = runBuilt(
      ["report", "create", "repo-a", "plan-does-not-exist", "--verification", "npm test", "--json"],
      workspace,
    );
    assert.equal(invalidReference.code, 1);
    assert.equal(invalidReference.stderr, "");
    const invalidReferenceJson = JSON.parse(invalidReference.stdout) as {
      ok: boolean;
      report?: unknown;
      error?: string;
    };
    assert.equal(invalidReferenceJson.ok, false);
    assert.equal("report" in invalidReferenceJson, false);
    assert.match(invalidReferenceJson.error ?? "", /Plan not found/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
