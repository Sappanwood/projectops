import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  listBacklogItems,
  showBacklogItem,
  updateBacklogItemStatus,
} from "../src/application/backlogApi.js";
import { getWorkspaceSummary } from "../src/application/workspaceApi.js";
import { runCli } from "../src/app.js";

function freshDir(): string {
  return mkdtempSync(path.join(tmpdir(), "pops-application-"));
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
  const workspaceDir = freshDir();
  assert.equal(run(["init"], workspaceDir).code, 0);
  mkdirSync(path.join(workspaceDir, "repo-a"));
  assert.equal(run(["project", "add", "repo-a"], workspaceDir).code, 0);
  return workspaceDir;
}

function setupBacklog(): { workspaceDir: string; revision: string } {
  const workspaceDir = setupWorkspace();
  assert.equal(run(["backlog", "init", "repo-a"], workspaceDir).code, 0);
  const added = run(
    [
      "backlog",
      "add",
      "repo-a",
      "-T",
      "Typed API",
      "-c",
      "feature",
      "--priority",
      "P1",
      "-b",
      "Details",
      "--json",
    ],
    workspaceDir,
  );
  assert.equal(added.code, 0);
  const receipt = JSON.parse(added.stdout[0] ?? "null") as { item: { revision: string } };
  return { workspaceDir, revision: receipt.item.revision };
}

test("workspace application API returns stable relative project summaries", () => {
  const workspaceDir = setupWorkspace();

  const result = getWorkspaceSummary({ workspaceDir });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.data.name.length > 0);
  assert.deepEqual(result.data.projects, [{ id: "repo-a", path: "repo-a" }]);
  assert.equal(JSON.stringify(result.data).includes(workspaceDir), false);
});

test("workspace application API uses stable path-free errors", () => {
  const outside = freshDir();
  const missing = getWorkspaceSummary({ workspaceDir: outside });
  assert.equal(missing.ok, false);
  if (missing.ok) return;
  assert.equal(missing.error.code, "WORKSPACE_NOT_FOUND");
  assert.equal(JSON.stringify(missing.error).includes(outside), false);

  const broken = setupWorkspace();
  writeFileSync(path.join(broken, ".pops", "workspace.json"), "{invalid", "utf8");
  const invalid = getWorkspaceSummary({ workspaceDir: broken });
  assert.equal(invalid.ok, false);
  if (invalid.ok) return;
  assert.equal(invalid.error.code, "WORKSPACE_INVALID");
  assert.equal(JSON.stringify(invalid.error).includes(broken), false);
});

test("backlog application API lists summaries and shows full items", () => {
  const { workspaceDir } = setupBacklog();

  const listed = listBacklogItems({ workspaceDir, projectId: "repo-a", status: "todo" });
  assert.equal(listed.ok, true);
  if (!listed.ok) return;
  assert.equal(listed.data.items.length, 1);
  assert.equal(listed.data.items[0]?.id, "REP-001");
  assert.equal("body" in (listed.data.items[0] ?? {}), false);

  const shown = showBacklogItem({ workspaceDir, projectId: "repo-a", itemId: "REP-001" });
  assert.equal(shown.ok, true);
  if (!shown.ok) return;
  assert.equal(shown.data.item.body, "Details\n");
});

test("backlog application API reports stable lookup and validation errors", () => {
  const { workspaceDir } = setupBacklog();

  const invalidStatus = listBacklogItems({ workspaceDir, projectId: "repo-a", status: "unknown" });
  assert.equal(invalidStatus.ok, false);
  if (!invalidStatus.ok) assert.equal(invalidStatus.error.code, "INVALID_STATUS");

  const unknownProject = listBacklogItems({ workspaceDir, projectId: "missing" });
  assert.equal(unknownProject.ok, false);
  if (!unknownProject.ok) assert.equal(unknownProject.error.code, "PROJECT_NOT_FOUND");

  const inheritedProject = listBacklogItems({ workspaceDir, projectId: "constructor" });
  assert.equal(inheritedProject.ok, false);
  if (!inheritedProject.ok) assert.equal(inheritedProject.error.code, "PROJECT_NOT_FOUND");

  const invalidId = showBacklogItem({ workspaceDir, projectId: "repo-a", itemId: "../../outside" });
  assert.equal(invalidId.ok, false);
  if (!invalidId.ok) assert.equal(invalidId.error.code, "INVALID_ITEM_ID");

  const missingItem = showBacklogItem({ workspaceDir, projectId: "repo-a", itemId: "REP-999" });
  assert.equal(missingItem.ok, false);
  if (!missingItem.ok) assert.equal(missingItem.error.code, "ITEM_NOT_FOUND");

  assert.equal(
    JSON.stringify([invalidStatus, unknownProject, invalidId, missingItem]).includes(workspaceDir),
    false,
  );
});

test("backlog application API updates status and protects revisions", () => {
  const { workspaceDir, revision } = setupBacklog();

  const updated = updateBacklogItemStatus({
    workspaceDir,
    projectId: "repo-a",
    itemId: "REP-001",
    status: "in_progress",
    expectedRevision: revision,
  });
  assert.equal(updated.ok, true);
  if (!updated.ok) return;
  assert.equal(updated.data.no_op, false);
  assert.equal(updated.data.result.status, "in_progress");
  assert.notEqual(updated.data.revision, revision);

  const file = path.join(workspaceDir, "ops", "repo-a", "backlog", "items", "REP-001.md");
  const beforeConflict = readFileSync(file, "utf8");
  const conflict = updateBacklogItemStatus({
    workspaceDir,
    projectId: "repo-a",
    itemId: "REP-001",
    status: "done",
    expectedRevision: revision,
  });
  assert.equal(conflict.ok, false);
  if (!conflict.ok) assert.equal(conflict.error.code, "REVISION_MISMATCH");
  assert.equal(readFileSync(file, "utf8"), beforeConflict);

  const invalid = updateBacklogItemStatus({
    workspaceDir,
    projectId: "repo-a",
    itemId: "REP-001",
    status: "unknown",
  });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.error.code, "INVALID_STATUS");
});

test("backlog application API reports invalid store when items directory is missing", () => {
  const { workspaceDir } = setupBacklog();
  const itemsDir = path.join(workspaceDir, "ops", "repo-a", "backlog", "items");
  rmSync(itemsDir, { recursive: true });

  const result = listBacklogItems({ workspaceDir, projectId: "repo-a" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "BACKLOG_STORE_INVALID");
});

test("backlog application API reports ITEM_ID_MISMATCH when filename and internal ID disagree", () => {
  const { workspaceDir } = setupBacklog();
  const file = path.join(workspaceDir, "ops", "repo-a", "backlog", "items", "REP-001.md");
  const content = readFileSync(file, "utf8").replace("id: REP-001", "id: REP-999");
  writeFileSync(file, content, "utf8");

  const result = listBacklogItems({ workspaceDir, projectId: "repo-a" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "ITEM_ID_MISMATCH");
});
