import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
  const ws = freshDir();
  assert.equal(run(["init"], ws).code, 0);
  mkdirSync(path.join(ws, "repo-a"));
  assert.equal(run(["project", "add", "repo-a"], ws).code, 0);
  return ws;
}

function writePlan(ws: string, plan: Record<string, unknown>): string {
  const planPath = path.join(ws, "ops", "repo-a", "plans", "plan-release-workflow.json");
  mkdirSync(path.dirname(planPath), { recursive: true });
  writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  return planPath;
}

function validPlan(): Record<string, unknown> {
  return {
    schema: "plan/Plan@1",
    id: "plan-release-workflow",
    title: "Release workflow",
    goal: "Publish a repeatable release.",
    items: [
      {
        key: "prepare",
        title: "Prepare release",
        item_type: "task",
        priority: "P1",
        body: "Update release notes.",
        depends_on: [],
      },
      {
        key: "publish",
        title: "Publish release",
        item_type: "task",
        priority: "P1",
        body: "Publish the package.",
        depends_on: ["prepare"],
      },
    ],
  };
}

test("plan validate and approve record a single approval with a review note", () => {
  const ws = setupWorkspace();
  const planPath = writePlan(ws, validPlan());

  const validated = run(["plan", "validate", "repo-a", "plan-release-workflow", "--json"], ws);
  assert.equal(validated.code, 0);
  assert.deepEqual(JSON.parse(validated.stdout[0] ?? "null"), {
    ok: true,
    plan: { ...validPlan(), status: "draft" },
  });

  const approved = run([
    "plan",
    "approve",
    "repo-a",
    "plan-release-workflow",
    "--review-note",
    "Reviewed for the release milestone.",
    "--json",
  ], ws);
  assert.equal(approved.code, 0);
  const result = JSON.parse(approved.stdout[0] ?? "null") as {
    ok: boolean;
    plan: { status: string; approval: { approved_at: string; review_note: string } };
  };
  assert.equal(result.ok, true);
  assert.equal(result.plan.status, "approved");
  assert.equal(result.plan.approval.review_note, "Reviewed for the release milestone.");
  assert.match(result.plan.approval.approved_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(JSON.parse(readFileSync(planPath, "utf8")), result.plan);
});

test("plan validate reports invalid schema without writing", () => {
  const ws = setupWorkspace();
  const planPath = writePlan(ws, { ...validPlan(), schema: "plan/Plan@999" });
  const original = readFileSync(planPath, "utf8");

  const result = run(["plan", "validate", "repo-a", "plan-release-workflow"], ws);

  assert.equal(result.code, 1);
  assert.match(result.stderr.join("\n"), /unexpected plan schema/i);
  assert.equal(readFileSync(planPath, "utf8"), original);
});

test("plan validate reports duplicate keys and missing dependencies", () => {
  const duplicate = setupWorkspace();
  const duplicatePlan = validPlan();
  duplicatePlan.items = [
    ...(duplicatePlan.items as Record<string, unknown>[]),
    { ...(duplicatePlan.items as Record<string, unknown>[])[0] },
  ];
  writePlan(duplicate, duplicatePlan);
  const duplicateResult = run(["plan", "validate", "repo-a", "plan-release-workflow"], duplicate);
  assert.equal(duplicateResult.code, 1);
  assert.match(duplicateResult.stderr.join("\n"), /duplicate plan item key: prepare/i);

  const missing = setupWorkspace();
  const missingPlan = validPlan();
  const missingItems = missingPlan.items as Record<string, unknown>[];
  const missingItem = missingItems[1];
  assert.ok(missingItem);
  missingItem.depends_on = ["missing"];
  writePlan(missing, missingPlan);
  const missingResult = run(["plan", "validate", "repo-a", "plan-release-workflow"], missing);
  assert.equal(missingResult.code, 1);
  assert.match(missingResult.stderr.join("\n"), /dependency not found: missing/i);
});

test("plan approve rejects invalid plans, blank notes, and re-approval without writing", () => {
  const ws = setupWorkspace();
  const planPath = writePlan(ws, { ...validPlan(), status: "draft" });
  const original = readFileSync(planPath, "utf8");

  const blankNote = run([
    "plan",
    "approve",
    "repo-a",
    "plan-release-workflow",
    "--review-note",
    "   ",
  ], ws);
  assert.equal(blankNote.code, 1);
  assert.match(blankNote.stderr.join("\n"), /review-note.*non-empty/i);
  assert.equal(readFileSync(planPath, "utf8"), original);

  const approved = run([
    "plan",
    "approve",
    "repo-a",
    "plan-release-workflow",
    "--review-note",
    "Approved after review.",
  ], ws);
  assert.equal(approved.code, 0);
  const approvedContent = readFileSync(planPath, "utf8");

  const again = run([
    "plan",
    "approve",
    "repo-a",
    "plan-release-workflow",
    "--review-note",
    "A second review.",
  ], ws);
  assert.equal(again.code, 1);
  assert.match(again.stderr.join("\n"), /already approved/i);
  assert.equal(readFileSync(planPath, "utf8"), approvedContent);
});

test("plan create never overwrites an approved plan", () => {
  const ws = setupWorkspace();
  const draftPath = path.join(ws, "release-workflow.json");
  writeFileSync(draftPath, JSON.stringify({
    title: "Release workflow",
    goal: "Publish a repeatable release.",
    items: [],
  }), "utf8");
  assert.equal(run(["plan", "create", "repo-a", "--input", draftPath], ws).code, 0);
  const planPath = path.join(ws, "ops", "repo-a", "plans", "plan-release-workflow.json");
  assert.equal(run([
    "plan",
    "approve",
    "repo-a",
    "plan-release-workflow",
    "--review-note",
    "Approved.",
  ], ws).code, 0);
  const original = readFileSync(planPath, "utf8");

  const duplicate = run(["plan", "create", "repo-a", "--input", draftPath], ws);

  assert.equal(duplicate.code, 1);
  assert.match(duplicate.stderr.join("\n"), /already exists/i);
  assert.equal(readFileSync(planPath, "utf8"), original);
  assert.equal(existsSync(planPath), true);
});

test("plan approve rejects a plan leaf symlink escaping the workspace without changing its target", () => {
  const ws = setupWorkspace();
  const outside = freshDir();
  const planPath = path.join(ws, "ops", "repo-a", "plans", "plan-release-workflow.json");
  const outsidePlanPath = path.join(outside, "plan-release-workflow.json");
  const externalContent = `${JSON.stringify({ ...validPlan(), status: "draft" }, null, 2)}\n`;
  writeFileSync(outsidePlanPath, externalContent, "utf8");
  symlinkSync(outsidePlanPath, planPath, "file");

  try {
    const result = run([
      "plan",
      "approve",
      "repo-a",
      "plan-release-workflow",
      "--review-note",
      "Approved.",
    ], ws);

    assert.equal(result.code, 1);
    assert.match(result.stderr.join("\n"), /plan.*outside|canonical.*plan/i);
    assert.equal(readFileSync(outsidePlanPath, "utf8"), externalContent);
  } finally {
    rmSync(ws, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("plan approve rejects malformed JSON and schema-invalid plans without writing", () => {
  const cases = [
    { content: "{ not valid json\n", error: /invalid JSON/i },
    { content: `${JSON.stringify({ ...validPlan(), schema: "plan/Plan@999" }, null, 2)}\n`, error: /unexpected plan schema/i },
  ];

  for (const candidate of cases) {
    const ws = setupWorkspace();
    const planPath = path.join(ws, "ops", "repo-a", "plans", "plan-release-workflow.json");
    writeFileSync(planPath, candidate.content, "utf8");

    const result = run([
      "plan",
      "approve",
      "repo-a",
      "plan-release-workflow",
      "--review-note",
      "Approved.",
    ], ws);

    assert.equal(result.code, 1);
    assert.match(result.stderr.join("\n"), candidate.error);
    assert.equal(readFileSync(planPath, "utf8"), candidate.content);
  }
});
