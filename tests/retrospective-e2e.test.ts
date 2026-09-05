import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const CLI = path.join(REPO_ROOT, "dist", "cli.js");
const BODY = [
  "## Hidden friction encountered",
  "",
  "The workflow needed a complete lifecycle smoke.",
  "",
  "## Workarounds used",
  "",
  "The CLI was exercised from an isolated temporary workspace.",
  "",
  "## Improvement candidates",
  "",
  "Keep lifecycle evidence and derived indexes consistent.",
].join("\n");

type CliResult = { code: number; stdout: string; stderr: string };
type RetrospectiveReceipt = {
  ok: boolean;
  retrospective: {
    id: string;
    created_at: string;
    project: string | null;
    task: string | null;
    trigger: string;
    status: string;
    path: string;
    revision: string;
    harness: string;
    model: string | null;
    body: string;
    disposition?: string;
    owner_scope?: string;
    categories?: string[];
    next_action?: string;
    related_info?: string[];
    canonical?: string;
    action_disposition?: string;
    actioned_at?: string;
    backlog?: string[];
    resolution_note?: string;
  };
};
type RetrospectiveIndex = {
  schema: string;
  records: Array<Record<string, unknown>>;
};

function pops(cwd: string, args: string[]): CliResult {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 30_000,
    killSignal: "SIGTERM",
  });
  const error = result.error instanceof Error ? result.error.message : "";
  return {
    code: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: [result.stderr ?? "", error].filter(Boolean).join("\n"),
  };
}

function json<T>(result: CliResult): T {
  return JSON.parse(result.stdout) as T;
}

function expectOk(result: CliResult): void {
  assert.equal(result.code, 0, result.stderr || result.stdout);
}

function readIndex(root: string): RetrospectiveIndex {
  return JSON.parse(readFileSync(path.join(root, "index.json"), "utf8")) as RetrospectiveIndex;
}

function indexRecord(root: string): Record<string, unknown> {
  const index = readIndex(root);
  assert.equal(index.records.length, 1);
  return index.records[0] as Record<string, unknown>;
}

test("built CLI completes an isolated retrospective lifecycle with revision and index invariants", () => {
  const parent = mkdtempSync(path.join(tmpdir(), "pops-retrospective-e2e-"));
  const workspace = path.join(parent, "workspace");
  const root = path.join(workspace, "retrospectives");
  const id = "retro-e2e-lifecycle";

  try {
    expectOk(pops(parent, ["init", workspace]));
    assert.ok(existsSync(path.join(root, "retrospective.json")));
    assert.deepEqual(readIndex(root), { schema: "retrospective/Index@1", records: [] });
    assert.match(readFileSync(path.join(root, "INDEX.md"), "utf8"), /> Total records: 0/);

    const captured = pops(workspace, [
      "retrospective",
      "capture",
      "--id",
      id,
      "--created-at",
      "2026-09-04T01:02:03.000Z",
      "--trigger",
      "workflow-friction",
      "--harness",
      "codex-app",
      "--model",
      "null",
      "--project",
      "projectops",
      "--task",
      "POP-032",
      "--body",
      BODY,
      "--json",
    ]);
    expectOk(captured);
    const captureReceipt = json<RetrospectiveReceipt>(captured);
    const captureRecord = captureReceipt.retrospective;
    assert.equal(captureRecord.status, "inbox");
    assert.equal(captureRecord.path, `inbox/${id}.md`);
    assert.equal(captureRecord.created_at, "2026-09-04T01:02:03.000Z");
    assert.equal(captureRecord.trigger, "workflow-friction");
    assert.equal(captureRecord.harness, "codex-app");
    assert.equal(captureRecord.project, "projectops");
    assert.equal(captureRecord.task, "POP-032");
    assert.equal(captureRecord.model, null);
    assert.equal(captureRecord.body, BODY);
    assert.match(captureRecord.revision, /^[0-9a-f]{64}$/);
    assert.ok(existsSync(path.join(root, "inbox", `${id}.md`)));
    assert.equal(readIndex(root).records.length, 1);
    assert.equal(indexRecord(root).path, `inbox/${id}.md`);
    assert.match(readFileSync(path.join(root, "INDEX.md"), "utf8"), /> Total records: 1/);

    const listed = pops(workspace, [
      "retrospective",
      "list",
      "--status",
      "inbox",
      "--project",
      "projectops",
      "--task",
      "POP-032",
      "--json",
    ]);
    expectOk(listed);
    const listResult = json<{
      ok: boolean;
      retrospectives: RetrospectiveReceipt["retrospective"][];
    }>(listed);
    assert.equal(listResult.ok, true);
    assert.deepEqual(
      listResult.retrospectives.map(({ id: listedId, path: listedPath }) => ({
        id: listedId,
        path: listedPath,
      })),
      [
        {
          id,
          path: `inbox/${id}.md`,
        },
      ],
    );

    const shown = pops(workspace, ["retrospective", "show", `inbox/${id}.md`, "--json"]);
    expectOk(shown);
    const shownRecord = json<RetrospectiveReceipt["retrospective"]>(shown);
    assert.equal(shownRecord.id, id);
    assert.equal(shownRecord.created_at, captureRecord.created_at);
    assert.equal(shownRecord.trigger, captureRecord.trigger);
    assert.equal(shownRecord.harness, captureRecord.harness);
    assert.equal(shownRecord.model, captureRecord.model);
    assert.equal(shownRecord.project, captureRecord.project);
    assert.equal(shownRecord.task, captureRecord.task);
    assert.equal(shownRecord.body, BODY);
    assert.equal(shownRecord.revision, captureRecord.revision);

    const sourceBeforeStale = readFileSync(path.join(root, "inbox", `${id}.md`), "utf8");
    const indexBeforeStale = readFileSync(path.join(root, "index.json"), "utf8");
    const readableIndexBeforeStale = readFileSync(path.join(root, "INDEX.md"), "utf8");
    const stale = pops(workspace, [
      "retrospective",
      "triage",
      id,
      "--to",
      "active",
      "--expected-revision",
      "0".repeat(64),
      "--disposition",
      "actionable",
      "--owner-scope",
      "projectops",
      "--category",
      "testing",
      "--next-action",
      "Keep the lifecycle smoke.",
      "--json",
    ]);
    assert.equal(stale.code, 1, stale.stderr);
    assert.match(stale.stdout, /revision conflict/i);
    assert.equal(readFileSync(path.join(root, "inbox", `${id}.md`), "utf8"), sourceBeforeStale);
    assert.equal(readFileSync(path.join(root, "index.json"), "utf8"), indexBeforeStale);
    assert.equal(readFileSync(path.join(root, "INDEX.md"), "utf8"), readableIndexBeforeStale);

    const triaged = pops(workspace, [
      "retrospective",
      "triage",
      `inbox/${id}.md`,
      "--to",
      "active",
      "--expected-revision",
      captureRecord.revision,
      "--disposition",
      "actionable",
      "--owner-scope",
      "projectops",
      "--category",
      "testing",
      "--category",
      "docs",
      "--next-action",
      "Keep the lifecycle smoke.",
      "--related-info",
      "project-ops:backlog/items/POP-032.md",
      "--canonical",
      "project-ops:retrospectives/retro-e2e-lifecycle.md",
      "--json",
    ]);
    expectOk(triaged);
    const triageReceipt = json<RetrospectiveReceipt>(triaged);
    const activeRecord = triageReceipt.retrospective;
    assert.equal(activeRecord.status, "active");
    assert.equal(activeRecord.path, `active/${id}.md`);
    assert.notEqual(activeRecord.revision, captureRecord.revision);
    assert.equal(activeRecord.created_at, captureRecord.created_at);
    assert.equal(activeRecord.trigger, captureRecord.trigger);
    assert.equal(activeRecord.harness, captureRecord.harness);
    assert.equal(activeRecord.model, captureRecord.model);
    assert.equal(activeRecord.project, "projectops");
    assert.equal(activeRecord.task, "POP-032");
    assert.equal(activeRecord.body, BODY);
    assert.equal(activeRecord.disposition, "actionable");
    assert.deepEqual(activeRecord.categories, ["testing", "docs"]);
    assert.equal(activeRecord.owner_scope, "projectops");
    assert.equal(activeRecord.next_action, "Keep the lifecycle smoke.");
    assert.deepEqual(activeRecord.related_info, ["project-ops:backlog/items/POP-032.md"]);
    assert.equal(activeRecord.canonical, "project-ops:retrospectives/retro-e2e-lifecycle.md");
    assert.equal(existsSync(path.join(root, "inbox", `${id}.md`)), false);
    assert.ok(existsSync(path.join(root, "active", `${id}.md`)));

    const activeShown = pops(workspace, ["retrospective", "show", `active/${id}.md`, "--json"]);
    expectOk(activeShown);
    const activeShownRecord = json<RetrospectiveReceipt["retrospective"]>(activeShown);
    assert.equal(activeShownRecord.id, id);
    assert.equal(activeShownRecord.status, "active");
    assert.equal(activeShownRecord.path, `active/${id}.md`);
    assert.equal(activeShownRecord.created_at, captureRecord.created_at);
    assert.equal(activeShownRecord.trigger, captureRecord.trigger);
    assert.equal(activeShownRecord.harness, captureRecord.harness);
    assert.equal(activeShownRecord.model, captureRecord.model);
    assert.equal(activeShownRecord.project, captureRecord.project);
    assert.equal(activeShownRecord.task, captureRecord.task);
    assert.equal(activeShownRecord.body, BODY);
    assert.equal(activeShownRecord.disposition, "actionable");
    assert.equal(activeShownRecord.owner_scope, "projectops");
    assert.deepEqual(activeShownRecord.categories, ["testing", "docs"]);
    assert.equal(activeShownRecord.next_action, "Keep the lifecycle smoke.");
    assert.deepEqual(activeShownRecord.related_info, ["project-ops:backlog/items/POP-032.md"]);
    assert.equal(activeShownRecord.canonical, "project-ops:retrospectives/retro-e2e-lifecycle.md");
    assert.equal(activeShownRecord.revision, activeRecord.revision);
    const activeIndexRecord = indexRecord(root);
    assert.equal(activeIndexRecord.path, `active/${id}.md`);
    assert.equal(activeIndexRecord.status, "active");
    assert.deepEqual(activeIndexRecord.categories, ["testing", "docs"]);
    assert.match(readFileSync(path.join(root, "INDEX.md"), "utf8"), /> Total records: 1/);
    assert.match(
      readFileSync(path.join(root, "INDEX.md"), "utf8"),
      /\| active \| retro-e2e-lifecycle \|/,
    );

    const archived = pops(workspace, [
      "retrospective",
      "archive",
      id,
      "--expected-revision",
      activeRecord.revision,
      "--action-disposition",
      "resolved",
      "--actioned-at",
      "2026-09-04T02:03:04.000Z",
      "--backlog",
      "project-ops:backlog/items/POP-032.md",
      "--resolution-note",
      "Lifecycle smoke passed.",
      "--json",
    ]);
    expectOk(archived);
    const archiveReceipt = json<RetrospectiveReceipt>(archived);
    const archiveRecord = archiveReceipt.retrospective;
    assert.equal(archiveRecord.status, "archive");
    assert.equal(archiveRecord.path, `archive/${id}.md`);
    assert.notEqual(archiveRecord.revision, activeRecord.revision);
    assert.equal(archiveRecord.created_at, captureRecord.created_at);
    assert.equal(archiveRecord.trigger, captureRecord.trigger);
    assert.equal(archiveRecord.harness, captureRecord.harness);
    assert.equal(archiveRecord.model, captureRecord.model);
    assert.equal(archiveRecord.project, captureRecord.project);
    assert.equal(archiveRecord.task, captureRecord.task);
    assert.equal(archiveRecord.body, BODY);
    assert.equal(archiveRecord.disposition, "actionable");
    assert.equal(archiveRecord.owner_scope, "projectops");
    assert.deepEqual(archiveRecord.categories, ["testing", "docs"]);
    assert.equal(archiveRecord.next_action, "Keep the lifecycle smoke.");
    assert.deepEqual(archiveRecord.related_info, ["project-ops:backlog/items/POP-032.md"]);
    assert.equal(archiveRecord.canonical, "project-ops:retrospectives/retro-e2e-lifecycle.md");
    assert.equal(archiveRecord.action_disposition, "resolved");
    assert.equal(archiveRecord.actioned_at, "2026-09-04T02:03:04.000Z");
    assert.deepEqual(archiveRecord.backlog, ["project-ops:backlog/items/POP-032.md"]);
    assert.equal(archiveRecord.resolution_note, "Lifecycle smoke passed.");
    assert.equal(existsSync(path.join(root, "active", `${id}.md`)), false);
    assert.ok(existsSync(path.join(root, "archive", `${id}.md`)));

    const archivedShown = pops(workspace, ["retrospective", "show", `archive/${id}.md`, "--json"]);
    expectOk(archivedShown);
    const finalRecord = json<RetrospectiveReceipt["retrospective"]>(archivedShown);
    assert.equal(finalRecord.revision, archiveRecord.revision);
    assert.equal(finalRecord.created_at, captureRecord.created_at);
    assert.equal(finalRecord.trigger, captureRecord.trigger);
    assert.equal(finalRecord.harness, captureRecord.harness);
    assert.equal(finalRecord.model, captureRecord.model);
    assert.equal(finalRecord.project, captureRecord.project);
    assert.equal(finalRecord.task, captureRecord.task);
    assert.equal(finalRecord.body, BODY);
    assert.equal(finalRecord.disposition, "actionable");
    assert.equal(finalRecord.owner_scope, "projectops");
    assert.deepEqual(finalRecord.categories, ["testing", "docs"]);
    assert.equal(finalRecord.next_action, "Keep the lifecycle smoke.");
    assert.deepEqual(finalRecord.related_info, ["project-ops:backlog/items/POP-032.md"]);
    assert.equal(finalRecord.canonical, "project-ops:retrospectives/retro-e2e-lifecycle.md");
    assert.equal(finalRecord.action_disposition, "resolved");
    assert.equal(finalRecord.actioned_at, "2026-09-04T02:03:04.000Z");
    assert.deepEqual(finalRecord.backlog, ["project-ops:backlog/items/POP-032.md"]);
    assert.equal(finalRecord.resolution_note, "Lifecycle smoke passed.");
    assert.equal(finalRecord.path, `archive/${id}.md`);
    assert.equal(finalRecord.status, "archive");
    assert.equal(readIndex(root).records.length, 1);
    const finalIndexRecord = indexRecord(root);
    assert.equal(finalIndexRecord.created_at, captureRecord.created_at);
    assert.equal(finalIndexRecord.trigger, captureRecord.trigger);
    assert.equal(finalIndexRecord.harness, captureRecord.harness);
    assert.equal(finalIndexRecord.model, captureRecord.model);
    assert.equal(finalIndexRecord.project, captureRecord.project);
    assert.equal(finalIndexRecord.task, captureRecord.task);
    assert.equal(finalIndexRecord.path, `archive/${id}.md`);
    assert.equal(finalIndexRecord.status, "archive");
    assert.equal(finalIndexRecord.disposition, "actionable");
    assert.equal(finalIndexRecord.owner_scope, "projectops");
    assert.deepEqual(finalIndexRecord.categories, ["testing", "docs"]);
    assert.equal(finalIndexRecord.next_action, "Keep the lifecycle smoke.");
    assert.deepEqual(finalIndexRecord.related_info, ["project-ops:backlog/items/POP-032.md"]);
    assert.equal(finalIndexRecord.canonical, "project-ops:retrospectives/retro-e2e-lifecycle.md");
    assert.equal(finalIndexRecord.action_disposition, "resolved");
    assert.equal(finalIndexRecord.actioned_at, "2026-09-04T02:03:04.000Z");
    assert.deepEqual(finalIndexRecord.backlog, ["project-ops:backlog/items/POP-032.md"]);
    assert.equal(finalIndexRecord.resolution_note, "Lifecycle smoke passed.");
    assert.match(readFileSync(path.join(root, "INDEX.md"), "utf8"), /> Total records: 1/);
    assert.match(
      readFileSync(path.join(root, "INDEX.md"), "utf8"),
      /\| archive \| retro-e2e-lifecycle \|/,
    );
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
