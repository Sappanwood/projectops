import assert from "node:assert/strict";
import test from "node:test";
import { parsePlanDraft, createPlan, parsePlan } from "../src/plan/plan.js";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCli } from "../src/app.js";
import { revisePlan, showPlanRevision } from "../src/application/planRevision.js";
const draft = {
  title: "Explicit parallel",
  goal: "Diamond",
  execution_policy: { max_parallel: 2 },
  items: [
    {
      key: "a",
      title: "A",
      item_type: "task",
      priority: "P1",
      body: "A",
      parallel: true,
      resources: ["database"],
      depends_on: [],
    },
  ],
};
test("explicit parallel policy survives canonical Plan parsing without inventing permission", () => {
  const d = parsePlanDraft(draft);
  assert.notEqual(typeof d, "string");
  if (typeof d === "string") return;
  assert.deepEqual(d.execution_policy, { max_parallel: 2 });
  assert.equal(d.items[0]!.parallel, true);
  assert.deepEqual(d.items[0]!.resources, ["database"]);
  const p = createPlan(d);
  assert.notEqual(typeof p, "string");
  assert.deepEqual(parsePlan(p), p);
  const plain = parsePlanDraft({
    ...draft,
    execution_policy: undefined,
    items: [{ ...draft.items[0], parallel: undefined, resources: undefined }],
  });
  assert.notEqual(typeof plain, "string");
  if (typeof plain === "string") return;
  assert.equal(plain.execution_policy, undefined);
  assert.equal(plain.items[0]!.parallel, undefined);
});
test("invalid capacity and malformed resource permissions are rejected", () => {
  for (const bad of [
    { ...draft, execution_policy: { max_parallel: 3 } },
    { ...draft, items: [{ ...draft.items[0], parallel: "yes" }] },
    { ...draft, items: [{ ...draft.items[0], resources: ["same", "same"] }] },
    { ...draft, items: [{ ...draft.items[0], resources: ["../outside"] }] },
  ])
    assert.equal(typeof parsePlanDraft(bad), "string");
});
test("policy revisions are previewed and can explicitly remove parallel permission", () => {
  const workspaceDir = mkdtempSync(path.join(tmpdir(), "policy-revise-"));
  const io = { stdout() {}, stderr() {} };
  runCli(["init"], io, workspaceDir);
  mkdirSync(path.join(workspaceDir, "repo"));
  runCli(["project", "add", "repo"], io, workspaceDir);
  const parsed = parsePlanDraft(draft);
  if (typeof parsed === "string") throw Error(parsed);
  const plan = createPlan(parsed);
  if (typeof plan === "string") throw Error(plan);
  writeFileSync(path.join(workspaceDir, "ops/repo/plans", plan.id + ".json"), JSON.stringify(plan));
  const q = { workspaceDir, projectId: "repo", planId: plan.id };
  const shown = showPlanRevision(q);
  if (!shown.ok) throw Error(shown.error.message);
  const candidate = {
    ...draft,
    execution_policy: undefined,
    items: [{ ...draft.items[0], parallel: false, resources: [] }],
  };
  const preview = revisePlan({ ...q, expectedRevision: shown.data.revision, draft: candidate });
  if (!preview.ok) throw Error(preview.error.message);
  assert.ok(preview.data.changes.some((change) => change.fields.includes("execution_policy")));
  assert.ok(preview.data.changes.some((change) => change.fields.includes("parallel")));
  const confirmed = revisePlan({
    ...q,
    expectedRevision: shown.data.revision,
    draft: candidate,
    confirm: preview.data.confirmation_token,
  });
  if (!confirmed.ok) throw Error(confirmed.error.message);
  assert.equal(confirmed.data.plan.execution_policy, undefined);
  assert.equal(confirmed.data.plan.items[0]!.parallel, false);
});
