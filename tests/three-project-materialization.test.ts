import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createExecution,
  decideExecution,
  finishExecution,
  verifyExecution,
} from "../src/application/executionApi.js";
import { readPlanExecution } from "../src/application/planExecution.js";

const cliPath = path.resolve("dist/cli.js");

test("three-project CLI delivery creates in A/B, reads C and accepts each actual Repo", (t) => {
  const workspaceDir = mkdtempSync(path.join(tmpdir(), "pops-three-materialize-"));
  t.after(() => rmSync(workspaceDir, { recursive: true, force: true }));
  const cli = (args: string[]) =>
    JSON.parse(
      execFileSync(process.execPath, [cliPath, ...args, "--json"], {
        cwd: workspaceDir,
        encoding: "utf8",
      }),
    );
  cli(["init"]);
  for (const project of ["alpha", "beta", "charlie"]) {
    const repo = path.join(workspaceDir, project);
    mkdirSync(repo);
    cli(["project", "add", project]);
    cli(["backlog", "init", project]);
    execFileSync("git", ["init", "-q"], { cwd: repo });
    execFileSync("git", ["config", "user.name", "Fixture"], { cwd: repo });
    execFileSync("git", ["config", "user.email", "fixture@example.invalid"], { cwd: repo });
    writeFileSync(path.join(repo, "base.txt"), project);
    execFileSync("git", ["add", "."], { cwd: repo });
    execFileSync("git", ["commit", "-qm", "Fixture base"], { cwd: repo });
  }
  const upstream = cli([
    "backlog",
    "add",
    "charlie",
    "-T",
    "Existing prerequisite",
    "-c",
    "feature",
    "--priority",
    "P1",
  ]).item.id;
  cli(["backlog", "update", "charlie", upstream, "--status", "done"]);
  const upstreamFile = path.join(workspaceDir, "ops/charlie/backlog/items", `${upstream}.md`);
  const upstreamBefore = readFileSync(upstreamFile, "utf8");
  const upstreamList = cli(["backlog", "list", "charlie"]);
  const draft = {
    title: "Three project materialization",
    goal: "Deliver A and B with a read-only C prerequisite",
    items: [
      { key: "prepare", title: "Prepare", body: "Prepare A", item_type: "task", priority: "P1" },
      {
        key: "deliver",
        project: "beta",
        title: "Deliver",
        body: "Deliver B",
        item_type: "task",
        priority: "P1",
        depends_on: ["prepare", `charlie:${upstream}`],
      },
    ],
  };
  const draftFile = path.join(workspaceDir, "draft.json");
  writeFileSync(draftFile, JSON.stringify(draft));
  const planId = cli(["plan", "create", "alpha", "--input", draftFile]).plan.id;
  cli(["plan", "validate", "alpha", planId]);
  cli(["plan", "approve", "alpha", planId, "--review-note", "Fixture scope approved"]);
  const receipt = cli(["plan", "materialize", "alpha", planId]);
  assert.equal(receipt.state, "complete");
  assert.deepEqual(
    receipt.items.map((item: { project: string }) => item.project),
    ["alpha", "beta"],
  );
  const localId = receipt.mapping.prepare;
  const remoteId = receipt.mapping.deliver.split(":")[1];
  assert.equal(receipt.mapping.deliver, `beta:${remoteId}`);
  assert.equal(cli(["plan", "materialize", "alpha", planId]).no_op, true);
  const remote = cli(["backlog", "show", "beta", remoteId]);
  assert.deepEqual(remote.depends_on, [`alpha:${localId}`, `charlie:${upstream}`]);
  assert.equal(remote.source, `plan:alpha:${planId}#deliver`);
  const request = { workspaceDir, projectId: "alpha", planId };
  const shown = () => cli(["plan", "show", "alpha", planId]);
  assert.equal(readPlanExecution(request, shown()).counts.total, 2);
  assert.equal(cli(["plan", "next", "alpha", planId]).next.project, "alpha");

  draft.items[1]!.title = "Deliver revised";
  writeFileSync(draftFile, JSON.stringify(draft));
  const reviseArgs = [
    "plan",
    "revise",
    "alpha",
    planId,
    "--input",
    draftFile,
    "--expected-revision",
    shown().revision,
  ];
  const preview = cli(reviseArgs);
  assert.ok(preview.affected_items.some((item: { project: string }) => item.project === "beta"));
  assert.equal(cli([...reviseArgs, "--confirm", preview.confirmation_token]).applied, true);
  assert.equal(cli(["backlog", "show", "beta", remoteId]).title, "Deliver revised");

  for (const [projectId, itemId] of [
    ["alpha", localId],
    ["beta", remoteId],
  ]) {
    const q = { workspaceDir, projectId: projectId!, itemId: itemId! };
    const created = createExecution(q);
    assert.ok(created.ok, JSON.stringify(created));
    assert.equal(created.data.attempt.input.item.project, projectId);
    if (projectId === "beta") assert.equal(created.data.attempt.input.plan?.project, "alpha");
    const finished = finishExecution({
      ...q,
      attemptId: created.data.attempt.id,
      expectedRevision: created.data.attempt.revision,
      outcome: "succeeded",
      summary: "Fixture work complete",
    });
    assert.ok(finished.ok);
    const verified = verifyExecution({
      ...q,
      attemptId: finished.data.attempt.id,
      expectedRevision: finished.data.attempt.revision,
      command: "fixture verification",
      outcome: "passed",
      evidence: "Fixture passed",
    });
    assert.ok(verified.ok);
    const accepted = decideExecution({
      ...q,
      attemptId: verified.data.attempt.id,
      expectedRevision: verified.data.attempt.revision,
      decision: "accepted",
      note: "Fixture accepted",
    });
    assert.ok(accepted.ok, JSON.stringify(accepted));
    if (projectId === "alpha") {
      assert.equal(readPlanExecution(request, shown()).completion_percent, 50);
      const next = cli(["plan", "next", "alpha", planId]).next;
      assert.equal(next.project, "beta");
      assert.equal(next.id, remoteId);
      const text = execFileSync(process.execPath, [cliPath, "plan", "next", "alpha", planId], {
        cwd: workspaceDir,
        encoding: "utf8",
      });
      assert.ok(text.includes(`beta:${remoteId}`), text);
    }
  }
  assert.equal(readPlanExecution(request, shown()).completion_percent, 100);
  const report = cli([
    "report",
    "create",
    "alpha",
    planId,
    "--verification",
    "Both fixture tasks accepted",
  ]).report;
  assert.equal(report.outcome, "completed");
  assert.deepEqual(
    report.backlog.map((item: { project: string; id: string }) => [item.project, item.id]),
    [
      ["alpha", localId],
      ["beta", remoteId],
    ],
  );
  assert.ok(
    report.verification.some((line: string) =>
      line.includes(`Task beta:${remoteId}; basis: accepted`),
    ),
  );
  cli(["plan", "complete", "alpha", planId, "--expected-revision", shown().revision]);
  assert.equal(shown().status, "done");
  assert.deepEqual(cli(["backlog", "list", "charlie"]), upstreamList);
  assert.equal(readFileSync(upstreamFile, "utf8"), upstreamBefore);
});
