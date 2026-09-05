import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  symlinkSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createExecution } from "../src/application/executionApi.js";
import { runCli } from "../src/app.js";
import {
  updateBacklogItemContent,
  showBacklogItem,
  updateBacklogItemStatus,
} from "../src/application/backlogApi.js";
import { showPlanRevision, revisePlan } from "../src/application/planRevision.js";
function setup() {
  const workspaceDir = mkdtempSync(path.join(tmpdir(), "pops-revision-"));
  const projectId = "repo";
  const run = (args: string[]) => {
    const out: string[] = [];
    const err: string[] = [];
    assert.equal(
      runCli(args, { stdout: (v) => out.push(v), stderr: (v) => err.push(v) }, workspaceDir),
      0,
      err.join("\n"),
    );
    return JSON.parse(out[0] ?? "{}");
  };
  run(["init", "--json"]);
  mkdirSync(path.join(workspaceDir, projectId));
  run(["project", "add", projectId, "--json"]);
  run(["backlog", "init", projectId, "--json"]);
  const draft = {
    title: "Work",
    goal: "Goal",
    items: [
      {
        key: "a",
        title: "A",
        body: "Acceptance",
        item_type: "task",
        priority: "P1",
        depends_on: [],
      },
    ],
  };
  const input = path.join(workspaceDir, "draft.json");
  writeFileSync(input, JSON.stringify(draft));
  run(["plan", "create", projectId, "--input", input, "--json"]);
  return { workspaceDir, projectId, planId: "plan-work", draft, run };
}
test("content editing preserves body and rejects stale revision", () => {
  const c = setup();
  const added = c.run([
    "backlog",
    "add",
    "repo",
    "-T",
    "Task",
    "-c",
    "feature",
    "--priority",
    "P1",
    "--json",
  ]);
  const itemId = added.item.id;
  const edited = updateBacklogItemContent({
    ...c,
    itemId,
    title: "Revised",
    body: "## Acceptance\n\nVerify it",
    expectedRevision: added.item.revision,
  });
  assert.equal(edited.ok, true);
  const stale = updateBacklogItemContent({
    ...c,
    itemId,
    body: "Lost",
    expectedRevision: added.item.revision,
  });
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.equal(stale.error.code, "REVISION_MISMATCH");
  const shown = showBacklogItem({ ...c, itemId });
  assert.equal(shown.ok && shown.data.item.body.trimEnd(), "## Acceptance\n\nVerify it");
});
test("plan preview confirms exact revision, rejects dependency cycles, preserves materialization and started work", () => {
  const c = setup();
  let loaded = showPlanRevision(c);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  const draft = { ...c.draft, goal: "New goal" };
  let preview = revisePlan({ ...c, draft, expectedRevision: loaded.data.revision });
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  assert.equal(preview.data.applied, false);
  const applied = revisePlan({
    ...c,
    draft,
    expectedRevision: loaded.data.revision,
    confirm: preview.data.confirmation_token,
  });
  assert.equal(applied.ok && applied.data.applied, true);
  const cycle = revisePlan({
    ...c,
    draft: { ...draft, items: [{ ...draft.items[0], depends_on: ["a"] }] },
    expectedRevision: applied.ok ? applied.data.revision : "",
  });
  assert.equal(cycle.ok, false);
  c.run(["plan", "approve", "repo", c.planId, "--review-note", "Reviewed", "--json"]);
  const m = c.run(["plan", "materialize", "repo", c.planId, "--json"]);
  loaded = showPlanRevision(c);
  if (!loaded.ok) return;
  const changed = { ...draft, items: [{ ...draft.items[0], title: "Changed" }] };
  preview = revisePlan({ ...c, draft: changed, expectedRevision: loaded.data.revision });
  assert.equal(preview.ok, true, JSON.stringify(preview));
  if (!preview.ok) return;
  const result = revisePlan({
    ...c,
    draft: changed,
    expectedRevision: loaded.data.revision,
    confirm: preview.data.confirmation_token,
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.data.plan.materialization?.mapping, m.mapping);
  updateBacklogItemStatus({ ...c, itemId: m.mapping.a, status: "in_progress" });
  loaded = showPlanRevision(c);
  if (!loaded.ok) return;
  const blocked = revisePlan({ ...c, draft, expectedRevision: loaded.data.revision });
  assert.equal(blocked.ok, false);
  const unsupported = revisePlan({
    ...c,
    draft: { ...draft, items: [] },
    expectedRevision: loaded.data.revision,
  });
  assert.equal(unsupported.ok, false);
});

test("confirmation detects task edits since preview and never overwrites divergent content", () => {
  const c = setup();
  c.run(["plan", "approve", "repo", c.planId, "--review-note", "Reviewed", "--json"]);
  const m = c.run(["plan", "materialize", "repo", c.planId, "--json"]);
  const loaded = showPlanRevision(c);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  const draft = { ...c.draft, items: [{ ...c.draft.items[0], title: "Next" }] };
  const preview = revisePlan({ ...c, draft, expectedRevision: loaded.data.revision });
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  const item = showBacklogItem({ ...c, itemId: m.mapping.a });
  if (!item.ok) return;
  updateBacklogItemContent({
    ...c,
    itemId: m.mapping.a,
    body: "Independent acceptance",
    expectedRevision: item.data.item.revision,
  });
  const confirmation = revisePlan({
    ...c,
    draft,
    expectedRevision: loaded.data.revision,
    confirm: preview.data.confirmation_token,
  });
  assert.equal(confirmation.ok, false);
  const retained = showBacklogItem({ ...c, itemId: m.mapping.a });
  assert.equal(retained.ok && retained.data.item.body.trimEnd(), "Independent acceptance");
});

test("CLI task content edits require revision and share application behavior", () => {
  const c = setup();
  const added = c.run([
    "backlog",
    "add",
    "repo",
    "-T",
    "Task",
    "-c",
    "feature",
    "--priority",
    "P1",
    "--json",
  ]);
  const bodyFile = path.join(c.workspaceDir, "body.md");
  writeFileSync(bodyFile, "## Acceptance\n\nCLI edited\n");
  const receipt = c.run([
    "backlog",
    "update",
    "repo",
    added.item.id,
    "--title",
    "Updated",
    "--body-file",
    bodyFile,
    "--expected-revision",
    added.item.revision,
    "--json",
  ]);
  assert.equal(receipt.result.title, "Updated");
  assert.match(receipt.result.body, /CLI edited/);
  const errors: string[] = [];
  assert.equal(
    runCli(
      ["backlog", "update", "repo", added.item.id, "--title", "Missing revision"],
      { stdout: () => {}, stderr: (v) => errors.push(v) },
      c.workspaceDir,
    ),
    1,
  );
  assert.match(errors.join(""), /expectedRevision/);
});

test("execution history protects plan tasks even while todo and prevents direct done", () => {
  const c = setup();
  c.run(["plan", "approve", "repo", c.planId, "--review-note", "Reviewed", "--json"]);
  const m = c.run(["plan", "materialize", "repo", c.planId, "--json"]);
  const created = createExecution({ ...c, itemId: m.mapping.a });
  assert.equal(created.ok, true, JSON.stringify(created));
  const direct = updateBacklogItemStatus({ ...c, itemId: m.mapping.a, status: "done" });
  assert.equal(direct.ok, false);
  const loaded = showPlanRevision(c);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  const blocked = revisePlan({
    ...c,
    draft: { ...c.draft, items: [{ ...c.draft.items[0], title: "Overwrite" }] },
    expectedRevision: loaded.data.revision,
  });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.match(blocked.error.message, /TASK_PROTECTED/);
});

test("unreadable execution history blocks done and plan rewriting", () => {
  const c = setup();
  c.run(["plan", "approve", "repo", c.planId, "--review-note", "Reviewed", "--json"]);
  const m = c.run(["plan", "materialize", "repo", c.planId, "--json"]);
  const created = createExecution({ ...c, itemId: m.mapping.a });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  writeFileSync(
    path.join(c.workspaceDir, "ops", "repo", "executions", `${created.data.attempt.id}.json`),
    "broken",
  );
  const blocked = updateBacklogItemStatus({ ...c, itemId: m.mapping.a, status: "done" });
  assert.equal(blocked.ok, false);
  const loaded = showPlanRevision(c);
  if (!loaded.ok) return;
  const preview = revisePlan({
    ...c,
    draft: { ...c.draft, items: [{ ...c.draft.items[0], title: "Overwrite" }] },
    expectedRevision: loaded.data.revision,
  });
  assert.equal(preview.ok, false);
});

test("plan confirmation rejects a backlog root symlink outside workspace", () => {
  const c = setup();
  c.run(["plan", "approve", "repo", c.planId, "--review-note", "Reviewed", "--json"]);
  const m = c.run(["plan", "materialize", "repo", c.planId, "--json"]);
  const loaded = showPlanRevision(c);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  const draft = { ...c.draft, items: [{ ...c.draft.items[0], title: "Outside write" }] };
  const preview = revisePlan({ ...c, draft, expectedRevision: loaded.data.revision });
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  const external = mkdtempSync(path.join(tmpdir(), "pops-outside-"));
  const root = path.join(c.workspaceDir, "ops", "repo", "backlog");
  const moved = path.join(external, "backlog");
  renameSync(root, moved);
  symlinkSync(moved, root, "dir");
  const target = path.join(moved, "items", `${m.mapping.a}.md`);
  const before = readFileSync(target, "utf8");
  const result = revisePlan({
    ...c,
    draft,
    expectedRevision: loaded.data.revision,
    confirm: preview.data.confirmation_token,
  });
  assert.equal(result.ok, false);
  assert.equal(readFileSync(target, "utf8"), before);
});
