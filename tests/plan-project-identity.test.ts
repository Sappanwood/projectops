import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCli } from "../src/app.js";
import {
  validatePlanDependencies,
  validatePlanTargets,
} from "../src/application/planDependencies.js";
import {
  formatPlanSource,
  parsePlanSource,
  planMappingReference,
} from "../src/plan/planIdentity.js";
import assert from "node:assert/strict";
import test from "node:test";
import { createPlan, parsePlan, type Plan } from "../src/plan/plan.js";

const items = [
  {
    key: "prepare",
    title: "Prepare",
    item_type: "task" as const,
    priority: "P1" as const,
    body: "",
    depends_on: [],
  },
  {
    key: "ship",
    project: "remote",
    title: "Ship",
    item_type: "task" as const,
    priority: "P1" as const,
    body: "",
    depends_on: ["prepare"],
  },
];
function approved(): Plan {
  const plan = createPlan({ title: "Identity", goal: "Deliver", items });
  assert.notEqual(typeof plan, "string");
  return {
    ...(plan as Plan),
    status: "approved",
    approval: { approved_at: "now", review_note: "reviewed" },
  };
}
test("plan preserves explicit project while leaving owner default implicit", () => {
  const plan = approved();
  assert.equal(plan.items[0]!.project, undefined);
  assert.equal(plan.items[1]!.project, "remote");
});
test("mapping accepts full references and partial state but cannot complete partial plans", () => {
  const plan = approved();
  const full = parsePlan({
    ...plan,
    materialization: {
      materialized_at: "now",
      mapping: { prepare: "OWN-001", ship: "remote:REM-001" },
    },
  });
  assert.notEqual(typeof full, "string");
  const partial = {
    ...plan,
    materialization: { materialized_at: "now", state: "partial", mapping: { prepare: "OWN-001" } },
  };
  assert.notEqual(typeof parsePlan(partial), "string");
  assert.match(String(parsePlan({ ...partial, status: "done" })), /partial/);
});

test("source resolves owner independently from target and distinguishes same-name plans", () => {
  const source = { project: "owner", planId: "plan-identity", key: "ship" };
  assert.deepEqual(parsePlanSource(formatPlanSource(source, "remote"), "remote"), source);
  assert.deepEqual(parsePlanSource("plan:plan-identity#ship", "remote"), {
    ...source,
    project: "remote",
  });
  assert.deepEqual(planMappingReference("owner", "remote:REM-001"), {
    project: "remote",
    item: "REM-001",
  });
  assert.deepEqual(planMappingReference("owner", "OWN-001"), { project: "owner", item: "OWN-001" });
});

test("target validation supports two-project local dependencies and rejects parent or mapping relocation", (t) => {
  const ws = mkdtempSync(path.join(tmpdir(), "pops-identity-"));
  t.after(() => rmSync(ws, { recursive: true, force: true }));
  const run = (args: string[]) => runCli(args, { stdout() {}, stderr() {} }, ws);
  assert.equal(run(["init"]), 0);
  for (const project of ["owner", "remote"]) {
    mkdirSync(path.join(ws, project));
    assert.equal(run(["project", "add", project]), 0);
    assert.equal(run(["backlog", "init", project]), 0);
  }
  const plan = approved();
  assert.equal(validatePlanDependencies(ws, "owner", plan).ok, true);
  plan.materialization = {
    materialized_at: "now",
    mapping: { prepare: "OWN-001", ship: "remote:REM-001" },
  };
  plan.items[1]!.project = "owner";
  assert.equal(validatePlanTargets(ws, "owner", plan).ok, false);
  delete plan.materialization;
  plan.items[0]!.item_type = "epic";
  plan.items[1]!.project = "remote";
  plan.items[1]!.parent = "prepare";
  assert.equal(validatePlanTargets(ws, "owner", plan).ok, false);
  delete plan.items[1]!.parent;
  plan.items[1]!.project = "missing";
  assert.equal(validatePlanTargets(ws, "owner", plan).ok, false);
  plan.items[1]!.project = "remote";
  writeFileSync(path.join(ws, "ops", "remote", "backlog", "backlog.json"), "invalid");
  assert.equal(validatePlanTargets(ws, "owner", plan).ok, false);
});
