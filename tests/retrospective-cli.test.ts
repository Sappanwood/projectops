import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { runCli } from "../src/app.js";
import { captureRetrospective, writeRetrospective } from "../src/retrospective/retrospectiveFs.js";
import type { Retrospective } from "../src/retrospective/retrospective.js";

function freshDir(): string {
  return mkdtempSync(path.join(tmpdir(), "pops-retrospective-cli-"));
}

function run(args: string[], cwd: string): { code: number; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = runCli(args, {
    stdout: (message) => stdout.push(message),
    stderr: (message) => stderr.push(message),
  }, cwd);
  return { code, stdout, stderr };
}

function setupWorkspace(): string {
  const workspace = freshDir();
  assert.equal(run(["init"], workspace).code, 0);
  return workspace;
}

const CAPTURE_BODY = "## Hidden friction encountered\n\nFriction.\n\n## Workarounds used\n\nWorkaround.\n\n## Improvement candidates\n\nImprove.";

function capture(
  workspace: string,
  id: string,
  project: string | null,
  task: string | null,
  body = CAPTURE_BODY,
): ReturnType<typeof run> {
  const args = [
    "retrospective", "capture", "--id", id,
    "--trigger", "workflow-friction", "--harness", "codex-app", "--model", "gpt-test",
    "--body", body,
    "--json",
  ];
  if (project !== null) args.splice(8, 0, "--project", project);
  if (task !== null) args.splice(project === null ? 8 : 10, 0, "--task", task);
  return run(args, workspace);
}

function runBuilt(args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.resolve("dist/cli.js"), ...args], { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

test("retrospective capture/list/show persist evidence, revisions, and filters", () => {
  const workspace = setupWorkspace();
  try {
    const first = capture(workspace, "retro-alpha", "projectops", "POP-030");
    assert.equal(first.code, 0, first.stderr.join("\n"));
    const created = JSON.parse(first.stdout[0] ?? "null") as {
      ok: boolean;
      retrospective: { id: string; status: string; revision: string; path: string; model: string | null };
    };
    assert.equal(created.ok, true);
    assert.equal(created.retrospective.id, "retro-alpha");
    assert.equal(created.retrospective.status, "inbox");
    assert.match(created.retrospective.revision, /^[0-9a-f]{64}$/);
    assert.equal(created.retrospective.path, "inbox/retro-alpha.md");
    assert.equal(created.retrospective.model, "gpt-test");

    const second = capture(workspace, "retro-beta", null, null);
    assert.equal(second.code, 0, second.stderr.join("\n"));
    writeRetrospective(workspace, path.join(workspace, "retrospectives"), {
      schema: "retrospective/Retrospective@1",
      id: "retro-active",
      created_at: "2026-09-04T00:00:00.000Z",
      project: "projectops",
      task: "POP-030",
      trigger: "workflow-friction",
      status: "active",
      harness: "codex-app",
      model: null,
      body: CAPTURE_BODY,
    });
    const listed = run(["retrospective", "list", "--status", "inbox", "--project", "projectops", "--task", "POP-030", "--json"], workspace);
    assert.equal(listed.code, 0, listed.stderr.join("\n"));
    const projectRecords = JSON.parse(listed.stdout[0] ?? "null") as {
      ok: boolean;
      retrospectives: { id: string; project: string | null; task: string | null; revision: string }[];
    };
    assert.equal(projectRecords.ok, true);
    assert.deepEqual(projectRecords.retrospectives.map(({ id }) => id), ["retro-alpha"]);

    const shown = run(["retrospective", "show", "retro-alpha", "--json"], workspace);
    assert.equal(shown.code, 0, shown.stderr.join("\n"));
    const record = JSON.parse(shown.stdout[0] ?? "null") as {
      id: string; project: string | null; task: string | null; status: string; revision: string; body: string;
    };
    assert.equal(record.id, "retro-alpha");
    assert.equal(record.project, "projectops");
    assert.equal(record.task, "POP-030");
    assert.equal(record.status, "inbox");
    assert.equal(record.revision, created.retrospective.revision);
    assert.match(record.body, /Hidden friction/);

    const nullRecord = run(["retrospective", "show", "retro-beta", "--json"], workspace);
    assert.equal(nullRecord.code, 0, nullRecord.stderr.join("\n"));
    assert.equal((JSON.parse(nullRecord.stdout[0] ?? "null") as { project: string | null; task: string | null }).project, null);
    assert.equal((JSON.parse(nullRecord.stdout[0] ?? "null") as { project: string | null; task: string | null }).task, null);

    const nullFiltered = run(["retrospective", "list", "--status", "inbox", "--project", "null", "--task", "null", "--json"], workspace);
    assert.equal(nullFiltered.code, 0, nullFiltered.stderr.join("\n"));
    assert.deepEqual(
      (JSON.parse(nullFiltered.stdout[0] ?? "null") as { retrospectives: { id: string }[] }).retrospectives.map(({ id }) => id),
      ["retro-beta"],
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("retrospective capture requires three non-empty evidence sections", () => {
  const workspace = setupWorkspace();
  try {
    const missing = capture(workspace, "retro-missing-section", null, null, "plain evidence");
    assert.equal(missing.code, 1);
    assert.match(missing.stdout[0] ?? "", /Hidden friction encountered/);
    assert.equal(existsSync(path.join(workspace, "retrospectives", "inbox", "retro-missing-section.md")), false);

    const empty = capture(
      workspace,
      "retro-empty-section",
      null,
      null,
      "## Hidden friction encountered\n\nFriction.\n\n## Workarounds used\n\n\n## Improvement candidates\n\nImprove.",
    );
    assert.equal(empty.code, 1);
    assert.match(empty.stdout[0] ?? "", /non-empty.*Workarounds used/i);
    assert.equal(existsSync(path.join(workspace, "retrospectives", "inbox", "retro-empty-section.md")), false);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("retrospective capture is no-clobber and malformed list records become diagnostics", () => {
  const workspace = setupWorkspace();
  try {
    const first = capture(workspace, "retro-conflict", "projectops", null);
    assert.equal(first.code, 0, first.stderr.join("\n"));
    const before = readFileSync(path.join(workspace, "retrospectives", "inbox", "retro-conflict.md"), "utf8");
    const duplicate = capture(workspace, "retro-conflict", "projectops", null);
    assert.equal(duplicate.code, 1);
    assert.match(duplicate.stdout[0] ?? "", /already exists/i);
    assert.equal(readFileSync(path.join(workspace, "retrospectives", "inbox", "retro-conflict.md"), "utf8"), before);

    writeFileSync(
      path.join(workspace, "retrospectives", "inbox", "broken.md"),
      "---\nschema: retrospective/Retrospective@1\nid: broken\nstatus: inbox\n---\nnot valid metadata\n",
      "utf8",
    );
    const listed = run(["retrospective", "list", "--json"], workspace);
    assert.equal(listed.code, 0, listed.stderr.join("\n"));
    const result = JSON.parse(listed.stdout[0] ?? "null") as {
      ok: boolean;
      retrospectives: { id: string }[];
      diagnostics: { id: string; message: string; path: string }[];
    };
    assert.equal(result.ok, true);
    assert.deepEqual(result.retrospectives.map(({ id }) => id), ["retro-conflict"]);
    assert.equal(result.diagnostics.length, 1);
    assert.equal(result.diagnostics[0]?.id, "broken");
    assert.match(result.diagnostics[0]?.message ?? "", /invalid|missing|required|non-empty/i);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("retrospective capture failure leaves no file or index drift", () => {
  const workspace = setupWorkspace();
  try {
    const root = path.join(workspace, "retrospectives");
    const indexBefore = readFileSync(path.join(root, "index.json"), "utf8");
    const readableBefore = readFileSync(path.join(root, "INDEX.md"), "utf8");
    writeFileSync(
      path.join(root, "inbox", "broken.md"),
      "---\nschema: retrospective/Retrospective@1\nid: broken\nstatus: inbox\n---\nmalformed\n",
      "utf8",
    );
    const failed = capture(workspace, "retro-failure", "projectops", null);
    assert.equal(failed.code, 1);
    assert.equal(existsSync(path.join(root, "inbox", "retro-failure.md")), false);
    assert.equal(readFileSync(path.join(root, "index.json"), "utf8"), indexBefore);
    assert.equal(readFileSync(path.join(root, "INDEX.md"), "utf8"), readableBefore);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("retrospective triage and archive CLI transitions use revision protection", () => {
  const workspace = setupWorkspace();
  try {
    const captured = capture(workspace, "retro-lifecycle", "projectops", "POP-031");
    assert.equal(captured.code, 0, captured.stderr.join("\n"));
    const captureReceipt = JSON.parse(captured.stdout[0] ?? "null") as { retrospective: { revision: string } };

    const triaged = run([
      "retrospective", "triage", "retro-lifecycle",
      "--to", "active", "--expected-revision", captureReceipt.retrospective.revision,
      "--disposition", "actionable", "--owner-scope", "projectops",
      "--category", "tooling", "--category", "docs",
      "--next-action", "update docs", "--related-info", "project-ops:backlog/items/POP-031.md", "--json",
    ], workspace);
    assert.equal(triaged.code, 0, triaged.stderr.join("\n"));
    const triageReceipt = JSON.parse(triaged.stdout[0] ?? "null") as {
      ok: boolean;
      retrospective: { status: string; path: string; revision: string; categories: string[]; owner_scope: string };
    };
    assert.equal(triageReceipt.ok, true);
    assert.equal(triageReceipt.retrospective.status, "active");
    assert.equal(triageReceipt.retrospective.path, "active/retro-lifecycle.md");
    assert.deepEqual(triageReceipt.retrospective.categories, ["tooling", "docs"]);
    assert.equal(triageReceipt.retrospective.owner_scope, "projectops");

    const archived = run([
      "retrospective", "archive", "retro-lifecycle",
      "--expected-revision", triageReceipt.retrospective.revision,
      "--action-disposition", "resolved", "--backlog", "project-ops:backlog/items/POP-031.md",
      "--resolution-note", "Documentation updated.", "--json",
    ], workspace);
    assert.equal(archived.code, 0, archived.stderr.join("\n"));
    const archiveReceipt = JSON.parse(archived.stdout[0] ?? "null") as {
      ok: boolean;
      retrospective: { status: string; path: string; action_disposition: string; resolution_note: string; next_action: string };
    };
    assert.equal(archiveReceipt.ok, true);
    assert.equal(archiveReceipt.retrospective.status, "archive");
    assert.equal(archiveReceipt.retrospective.path, "archive/retro-lifecycle.md");
    assert.equal(archiveReceipt.retrospective.action_disposition, "resolved");
    assert.equal(archiveReceipt.retrospective.resolution_note, "Documentation updated.");
    assert.equal(archiveReceipt.retrospective.next_action, "update docs");

    const invalid = run([
      "retrospective", "archive", "retro-lifecycle",
      "--expected-revision", "stale", "--action-disposition", "resolved",
      "--resolution-note", "already archived", "--json",
    ], workspace);
    assert.equal(invalid.code, 1);
    assert.match(invalid.stdout[0] ?? "", /already exists|not found|transition|revision/i);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("retrospective transition CLI requires explicit destinations and next actions", () => {
  const workspace = setupWorkspace();
  try {
    const captured = capture(workspace, "retro-required-flags", "projectops", "POP-031");
    assert.equal(captured.code, 0, captured.stderr.join("\n"));
    const revision = (JSON.parse(captured.stdout[0] ?? "null") as { retrospective: { revision: string } }).retrospective.revision;
    const common = [
      "retrospective", "triage", "retro-required-flags",
      "--expected-revision", revision, "--disposition", "actionable", "--owner-scope", "projectops", "--json",
    ];

    const missingDestination = run(common, workspace);
    assert.equal(missingDestination.code, 1);
    assert.match(missingDestination.stdout[0] ?? "", /--to is required/i);

    const missingActiveNextAction = run([...common, "--to", "active"], workspace);
    assert.equal(missingActiveNextAction.code, 1);
    assert.match(missingActiveNextAction.stdout[0] ?? "", /--next-action is required/i);

    const missingArchiveNextAction = run([...common, "--to", "archive"], workspace);
    assert.equal(missingArchiveNextAction.code, 1);
    assert.match(missingArchiveNextAction.stdout[0] ?? "", /--next-action is required/i);

    const active = run([...common, "--to", "active", "--next-action", "Follow up."], workspace);
    assert.equal(active.code, 0, active.stderr.join("\n"));
    const activeRevision = (JSON.parse(active.stdout[0] ?? "null") as { retrospective: { revision: string } }).retrospective.revision;
    const archived = run([
      "retrospective", "archive", "retro-required-flags", "--expected-revision", activeRevision,
      "--action-disposition", "resolved", "--resolution-note", "Handled.", "--json",
    ], workspace);
    assert.equal(archived.code, 0, archived.stderr.join("\n"));
    assert.equal((JSON.parse(archived.stdout[0] ?? "null") as { retrospective: { next_action: string } }).retrospective.next_action, "Follow up.");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("retrospective triage and archive JSON resolution failures use a stable envelope", () => {
  const missingWorkspace = freshDir();
  try {
    for (const subcommand of ["triage", "archive"] as const) {
      const result = run(["retrospective", subcommand, "retro-missing-workspace", "--json"], missingWorkspace);
      assert.equal(result.code, 1);
      assert.deepEqual(result.stderr, []);
      assert.deepEqual(JSON.parse(result.stdout[0] ?? "null"), {
        ok: false,
        error: `No workspace found at or above ${missingWorkspace}`,
      });
    }
  } finally {
    rmSync(missingWorkspace, { recursive: true, force: true });
  }

  const missingRoot = setupWorkspace();
  try {
    rmSync(path.join(missingRoot, "retrospectives"), { recursive: true, force: true });
    for (const subcommand of ["triage", "archive"] as const) {
      const result = run(["retrospective", subcommand, "retro-missing-root", "--json"], missingRoot);
      assert.equal(result.code, 1);
      assert.deepEqual(result.stderr, []);
      const envelope = JSON.parse(result.stdout[0] ?? "null") as { ok: boolean; error: string };
      assert.equal(envelope.ok, false);
      assert.match(envelope.error, /retrospectives root does not exist/i);
    }
  } finally {
    rmSync(missingRoot, { recursive: true, force: true });
  }
});

test("built CLI completes a bounded retrospective transition smoke", async () => {
  const workspace = setupWorkspace();
  try {
    const captured = await runBuilt([
      "retrospective", "capture", "--id", "retro-built-lifecycle",
      "--trigger", "workflow-friction", "--harness", "codex-app", "--model", "null",
      "--body", CAPTURE_BODY, "--json",
    ], workspace);
    assert.equal(captured.code, 0, captured.stderr);
    const captureReceipt = JSON.parse(captured.stdout) as { retrospective: { revision: string } };
    const triaged = await runBuilt([
      "retrospective", "triage", "retro-built-lifecycle", "--to", "active",
      "--expected-revision", captureReceipt.retrospective.revision,
      "--disposition", "actionable", "--owner-scope", "workspace",
      "--category", "testing", "--next-action", "Keep the smoke bounded.", "--json",
    ], workspace);
    assert.equal(triaged.code, 0, triaged.stderr);
    const triageReceipt = JSON.parse(triaged.stdout) as { retrospective: { revision: string; status: string } };
    assert.equal(triageReceipt.retrospective.status, "active");
    const archived = await runBuilt([
      "retrospective", "archive", "retro-built-lifecycle",
      "--expected-revision", triageReceipt.retrospective.revision,
      "--action-disposition", "resolved", "--resolution-note", "Smoke passed.", "--json",
    ], workspace);
    assert.equal(archived.code, 0, archived.stderr);
    assert.equal((JSON.parse(archived.stdout) as { retrospective: { status: string } }).retrospective.status, "archive");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("retrospective capture rolls back after a post-create index refresh failure", () => {
  const workspace = setupWorkspace();
  try {
    const root = path.join(workspace, "retrospectives");
    const indexBefore = readFileSync(path.join(root, "index.json"), "utf8");
    const readableBefore = readFileSync(path.join(root, "INDEX.md"), "utf8");
    const retrospective: Retrospective = {
      schema: "retrospective/Retrospective@1",
      id: "retro-post-create-failure",
      created_at: "2026-09-04T00:00:00.000Z",
      project: null,
      task: null,
      trigger: "workflow-friction",
      status: "inbox",
      harness: "codex-app",
      model: null,
      body: CAPTURE_BODY,
    };

    assert.throws(
      () => captureRetrospective(workspace, root, retrospective, (target) => {
        if (target.endsWith("INDEX.md")) throw new Error("injected index refresh failure");
      }),
      /injected index refresh failure/,
    );
    assert.equal(existsSync(path.join(root, "inbox", `${retrospective.id}.md`)), false);
    assert.equal(readFileSync(path.join(root, "index.json"), "utf8"), indexBefore);
    assert.equal(readFileSync(path.join(root, "INDEX.md"), "utf8"), readableBefore);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("concurrent same-record capture preserves the winner and derived index", async () => {
  const workspace = setupWorkspace();
  try {
    const args = [
      "retrospective", "capture", "--id", "retro-race",
      "--created-at", "2026-09-04T00:00:00.000Z",
      "--trigger", "workflow-friction", "--harness", "codex-app", "--model", "null",
      "--body", CAPTURE_BODY, "--json",
    ];
    const results = await Promise.all([runBuilt(args, workspace), runBuilt(args, workspace)]);
    assert.deepEqual(results.map(({ code }) => code).sort((left, right) => left - right), [0, 1]);
    assert.match(results.find(({ code }) => code === 1)?.stdout ?? "", /already exists/i);

    const index = JSON.parse(readFileSync(path.join(workspace, "retrospectives", "index.json"), "utf8")) as {
      records: { id: string; path: string }[];
    };
    assert.deepEqual(index.records, [{
      id: "retro-race",
      path: "inbox/retro-race.md",
      created_at: "2026-09-04T00:00:00.000Z",
      project: null,
      task: null,
      trigger: "workflow-friction",
      status: "inbox",
      harness: "codex-app",
      model: null,
    }]);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
