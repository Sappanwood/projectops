import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  RETROSPECTIVE_SCHEMA,
  RETROSPECTIVE_STORE_SCHEMA,
  parseRetrospective,
  serializeRetrospective,
  type Retrospective,
} from "../src/retrospective/retrospective.js";
import {
  RetrospectiveParseError,
  RetrospectiveRootError,
  RetrospectiveStoreAlreadyExistsError,
  createRetrospectiveStore,
  readRetrospective,
  rebuildRetrospectiveIndexes,
  writeRetrospective,
} from "../src/retrospective/retrospectiveFs.js";
import { newWorkspaceManifest } from "../src/catalog/workspace.js";
import { serializeManifest, loadWorkspace } from "../src/catalog/workspaceStore.js";
import { resolveRetrospectivesRoot } from "../src/useCases/retrospectiveContext.js";
import { runCli } from "../src/app.js";

function freshDir(): string {
  return mkdtempSync(path.join(tmpdir(), "pops-retrospective-"));
}

function validRetrospective(): Retrospective {
  return {
    schema: RETROSPECTIVE_SCHEMA,
    id: "2026-09-04-projectops-test",
    created_at: "2026-09-04T12:00:00+09:00",
    project: "projectops",
    task: "POP-029",
    trigger: "workflow-friction",
    status: "inbox",
    harness: "codex-app",
    model: null,
    body: "## Hidden friction encountered\n\nThe test fixture is useful.",
  };
}

test("Retrospective@1 parses required metadata and deterministic Markdown", () => {
  const retrospective = validRetrospective();
  const serialized = serializeRetrospective(retrospective);

  assert.match(serialized, /^---\nschema: retrospective\/Retrospective@1\n/);
  assert.match(serialized, /model: null\n/);
  assert.equal(serializeRetrospective(retrospective), serialized);
  assert.deepEqual(parseRetrospective(serialized), retrospective);
});

test("Retrospective@1 preserves explicit null provenance and rejects omitted provenance", () => {
  const retrospective = { ...validRetrospective(), project: null, task: null };
  const serialized = serializeRetrospective(retrospective);

  assert.match(serialized, /project: null\n/);
  assert.match(serialized, /task: null\n/);
  assert.deepEqual(parseRetrospective(serialized), retrospective);

  const missingTask = { ...retrospective } as Record<string, unknown>;
  delete missingTask.task;
  assert.match(String(parseRetrospective(missingTask)), /task.*required/i);
});

test("Retrospective parser rejects missing required metadata", () => {
  const retrospective = validRetrospective();
  assert.match(String(parseRetrospective({ ...retrospective, task: undefined })), /task/i);
  assert.throws(
    () => serializeRetrospective({ ...retrospective, status: "done" as Retrospective["status"] }),
    /status/i,
  );
  assert.throws(
    () => serializeRetrospective({ ...retrospective, schema: "retrospective/Retrospective@999" as typeof RETROSPECTIVE_SCHEMA }),
    /schema/i,
  );
});

test("retrospective store bootstraps directories and rebuildable indexes without clobbering", () => {
  const workspace = freshDir();
  const root = path.join(workspace, "retrospectives");

  createRetrospectiveStore(workspace, root);
  assert.deepEqual(
    ["inbox", "active", "archive"].map((name) => existsSync(path.join(root, name))),
    [true, true, true],
  );
  const manifest = JSON.parse(readFileSync(path.join(root, "retrospective.json"), "utf8")) as { schema: string };
  assert.equal(manifest.schema, RETROSPECTIVE_STORE_SCHEMA);
  assert.ok(existsSync(path.join(root, "index.json")));
  assert.ok(existsSync(path.join(root, "INDEX.md")));

  assert.throws(
    () => createRetrospectiveStore(workspace, root),
    RetrospectiveStoreAlreadyExistsError,
  );
  createRetrospectiveStore(workspace, path.join(workspace, "retrospectives-copy"));
  rmSync(workspace, { recursive: true, force: true });
});

test("retrospective store bootstraps a nested root with missing parent directories", () => {
  const workspace = freshDir();
  const root = path.join(workspace, "artifacts", "workflow", "retrospectives");

  createRetrospectiveStore(workspace, root);

  assert.ok(existsSync(path.join(root, "inbox")));
  assert.ok(existsSync(path.join(root, "retrospective.json")));
  rmSync(workspace, { recursive: true, force: true });
});

test("retrospective store writes records, rebuilds machine/readable indexes, and parses malformed files", () => {
  const workspace = freshDir();
  const root = path.join(workspace, "retrospectives");
  createRetrospectiveStore(workspace, root);
  const retrospective = validRetrospective();

  writeRetrospective(workspace, root, retrospective);
  rebuildRetrospectiveIndexes(workspace, root);
  const index = JSON.parse(readFileSync(path.join(root, "index.json"), "utf8")) as {
    records: { id: string; status: string }[];
  };
  assert.deepEqual(index.records, [{
    id: retrospective.id,
    created_at: retrospective.created_at,
    project: retrospective.project,
    task: retrospective.task,
    trigger: retrospective.trigger,
    status: "inbox",
    harness: retrospective.harness,
    model: null,
    path: `inbox/${retrospective.id}.md`,
  }]);
  assert.match(readFileSync(path.join(root, "INDEX.md"), "utf8"), /2026-09-04-projectops-test/);
  assert.deepEqual(readRetrospective(workspace, root, "inbox", retrospective.id), retrospective);
  assert.throws(() => writeRetrospective(workspace, root, retrospective), /already exists/i);

  writeFileSync(path.join(root, "inbox", "broken.md"), "---\nschema: retrospective/Retrospective@1\n---\n", "utf8");
  assert.throws(
    () => readRetrospective(workspace, root, "inbox", "broken"),
    RetrospectiveParseError,
  );
  rmSync(workspace, { recursive: true, force: true });
});

test("retrospective root rejects symlinks and workspace escapes", () => {
  const workspace = freshDir();
  const outside = freshDir();
  symlinkSync(outside, path.join(workspace, "retrospectives"), "dir");
  assert.throws(
    () => createRetrospectiveStore(workspace, path.join(workspace, "retrospectives")),
    (error: unknown) => error instanceof RetrospectiveRootError && /symlink/i.test(error.message),
  );
  assert.throws(
    () => createRetrospectiveStore(workspace, outside),
    (error: unknown) => error instanceof RetrospectiveRootError && /outside/i.test(error.message),
  );
  const file = path.join(workspace, "not-a-root");
  writeFileSync(file, "file", "utf8");
  assert.throws(() => createRetrospectiveStore(workspace, file), RetrospectiveRootError);
  rmSync(workspace, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

test("workspace manifest explicitly routes retrospectives and init bootstraps the store", () => {
  const workspace = freshDir();
  const manifest = newWorkspaceManifest("fixture");
  assert.deepEqual(manifest.retrospectives, {
    type: "workflow/retrospectives@1",
    root: "retrospectives",
  });
  mkdirSync(path.join(workspace, ".pops"), { recursive: true });
  writeFileSync(path.join(workspace, ".pops", "workspace.json"), serializeManifest(manifest), "utf8");
  assert.equal(loadWorkspace(workspace).manifest.retrospectives.root, "retrospectives");

  const initialized = freshDir();
  const stdout: string[] = [];
  const code = runCli(["init"], { stdout: (value) => stdout.push(value), stderr: () => undefined }, initialized);
  assert.equal(code, 0);
  assert.ok(lstatSync(path.join(initialized, "retrospectives")).isDirectory());
  assert.ok(existsSync(path.join(initialized, "retrospectives", "inbox")));
  rmSync(workspace, { recursive: true, force: true });
  rmSync(initialized, { recursive: true, force: true });
});

test("workspace retrospective routing rejects a symlinked ancestor", () => {
  const workspace = freshDir();
  const outside = freshDir();
  const manifest = newWorkspaceManifest("fixture");
  manifest.retrospectives.root = "linked-retrospectives/missing";
  mkdirSync(path.join(workspace, ".pops"), { recursive: true });
  writeFileSync(path.join(workspace, ".pops", "workspace.json"), serializeManifest(manifest), "utf8");
  symlinkSync(outside, path.join(workspace, "linked-retrospectives"), "dir");

  const stderr: string[] = [];
  const resolved = resolveRetrospectivesRoot(
    { stdout: () => undefined, stderr: (value) => stderr.push(value) },
    workspace,
  );

  assert.equal(resolved, null);
  assert.match(stderr.join("\n"), /symlink/i);
  rmSync(workspace, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

test("init removes only its new manifest when a pre-existing retrospective root blocks bootstrap", () => {
  const workspace = freshDir();
  const root = path.join(workspace, "retrospectives");
  const marker = path.join(root, "keep.txt");
  mkdirSync(root);
  writeFileSync(marker, "keep", "utf8");

  const stderr: string[] = [];
  const failed = runCli(
    ["init"],
    { stdout: () => undefined, stderr: (value) => stderr.push(value) },
    workspace,
  );

  assert.equal(failed, 1);
  assert.match(stderr.join("\n"), /already exists/i);
  assert.equal(existsSync(path.join(workspace, ".pops", "workspace.json")), false);
  assert.equal(readFileSync(marker, "utf8"), "keep");

  rmSync(root, { recursive: true, force: true });
  assert.equal(runCli(["init"], { stdout: () => undefined, stderr: () => undefined }, workspace), 0);
  assert.ok(existsSync(path.join(root, "retrospective.json")));
  rmSync(workspace, { recursive: true, force: true });
});

test("init preserves a symlinked retrospective target and remains retryable", () => {
  const workspace = freshDir();
  const outside = freshDir();
  const root = path.join(workspace, "retrospectives");
  symlinkSync(outside, root, "dir");

  const stderr: string[] = [];
  const failed = runCli(
    ["init"],
    { stdout: () => undefined, stderr: (value) => stderr.push(value) },
    workspace,
  );

  assert.equal(failed, 1);
  assert.match(stderr.join("\n"), /symlink/i);
  assert.equal(existsSync(path.join(workspace, ".pops", "workspace.json")), false);
  assert.equal(lstatSync(root).isSymbolicLink(), true);

  rmSync(root, { force: true });
  assert.equal(runCli(["init"], { stdout: () => undefined, stderr: () => undefined }, workspace), 0);
  assert.ok(existsSync(path.join(root, "retrospective.json")));
  rmSync(workspace, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});
