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
