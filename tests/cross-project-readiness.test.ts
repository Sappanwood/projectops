import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runCli } from "../src/app.js";
import { getPlanNext } from "../src/application/planNext.js";
import { getBacklogDependencies } from "../src/application/backlogDependencies.js";

function setup() {
  const root = mkdtempSync(path.join(tmpdir(), "cross-readiness-"));
  const cli = (args: string[]) => {
    const output: string[] = [];
    assert.equal(
      runCli(
        [...args, "--json"],
        { stdout: (s) => output.push(s), stderr: (s) => output.push(s) },
        root,
      ),
      0,
      output.join("\n"),
    );
    return JSON.parse(output.join("\n"));
  };
  cli(["init"]);
  for (const p of ["alpha", "infra"]) {
    mkdirSync(path.join(root, p));
    cli(["project", "add", p]);
    cli(["backlog", "init", p]);
  }
  const upstream = cli([
    "backlog",
    "add",
    "infra",
    "-T",
    "Infra",
    "-c",
    "feature",
    "--priority",
    "P1",
  ]).item.id;
  const local = cli([
    "backlog",
    "add",
    "alpha",
    "-T",
    "Local",
    "-c",
    "feature",
    "--priority",
    "P1",
    "--depends-on",
    `infra:${upstream}`,
  ]).item.id;
  writeFileSync(
    path.join(root, "ops/alpha/plans/plan-cross.json"),
    JSON.stringify({
      schema: "plan/Plan@1",
      id: "plan-cross",
      title: "Cross",
      goal: "Deliver",
      status: "approved",
      approval: { approved_at: "2026-09-07", review_note: "Fixture" },
      materialization: { materialized_at: "2026-09-07", mapping: { local } },
      items: [
        {
          key: "local",
          title: "Local",
          item_type: "task",
          priority: "P1",
          body: "Deliver",
          depends_on: [`infra:${upstream}`],
        },
      ],
    }),
  );
  return { root, cli, upstream, local };
}

test("cross-project next refreshes done, reopen, cancellation and unreadable facts", () => {
  const f = setup();
  try {
    const next = () => {
      const r = getPlanNext({ workspaceDir: f.root, projectId: "alpha", planId: "plan-cross" });
      assert.ok(r.ok);
      return r.data;
    };
    assert.equal(next().blocked[0]?.reasons[0]?.code, "DEPENDENCY_NOT_DONE");
    f.cli(["backlog", "update", "infra", f.upstream, "--status", "done"]);
    assert.equal(next().ready[0]?.id, f.local);
    for (const status of ["todo", "cancelled"]) {
      f.cli(["backlog", "update", "infra", f.upstream, "--status", status]);
      assert.equal(next().ready.length, 0);
      assert.equal(next().blocked[0]?.reasons[0]?.id, `infra:${f.upstream}`);
    }
    writeFileSync(path.join(f.root, `ops/infra/backlog/items/${f.upstream}.md`), "broken");
    assert.equal(next().ready.length, 0);
    assert.ok(next().blocked.length);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("dependency query exposes reverse references and incomplete diagnostics", () => {
  const f = setup();
  try {
    const query = () => {
      const r = getBacklogDependencies({
        workspaceDir: f.root,
        projectId: "infra",
        itemId: f.upstream,
      });
      assert.ok(r.ok);
      return r.data;
    };
    assert.equal(query().dependents[0]!.reference.project, "alpha");
    writeFileSync(path.join(f.root, "ops/alpha/backlog/items/ALP-999.md"), "broken");
    const result = query();
    assert.equal(result.complete, false);
    assert.ok(result.diagnostics.length);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("Plan completion and Report refuse unmet external prerequisites even when mapped tasks are done", async () => {
  const f = setup();
  try {
    const { completePlan } = await import("../src/application/planComplete.js");
    const { computePlanRevision } = await import("../src/application/planRevision.js");
    const { readPlan } = await import("../src/plan/planFs.js");
    f.cli(["backlog", "update", "alpha", f.local, "--status", "done"]);
    const plan = readPlan(path.join(f.root, "ops/alpha/plans"), "plan-cross");
    const request = {
      workspaceDir: f.root,
      projectId: "alpha",
      planId: plan.id,
      expectedRevision: computePlanRevision(plan),
    };

    const { writeGeneratedReport } = await import("../src/useCases/reportGenerate.js");
    const input = {
      workspaceRoot: f.root,
      projectId: "alpha",
      planId: plan.id,
      plansRoot: path.join(f.root, "ops/alpha/plans"),
      backlogRoot: path.join(f.root, "ops/alpha/backlog"),
      reportsRoot: path.join(f.root, "ops/alpha/reports"),
    };
    assert.throws(() => writeGeneratedReport(input), /infra:/);
    assert.equal(completePlan(request).ok, false);
    f.cli(["backlog", "update", "infra", f.upstream, "--status", "done"]);
    assert.ok(completePlan(request).ok);
    const report = writeGeneratedReport(input);
    assert.equal(report.outcome, "completed");
    assert.equal(report.backlog.length, 1);
    assert.ok(report.verification.some((value) => value.includes(`infra:${f.upstream}`)));
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
