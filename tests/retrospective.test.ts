import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
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
  RetrospectiveRevisionConflictError,
  RetrospectiveRootError,
  RetrospectiveStoreAlreadyExistsError,
  RetrospectiveTargetError,
  RetrospectiveTransitionError,
  archiveRetrospective,
  captureRetrospective,
  createRetrospectiveStore,
  readRetrospective,
  rebuildRetrospectiveIndexes,
  retrospectiveLockPath,
  triageRetrospective,
  writeRetrospective,
  type RetrospectiveFsOps,
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

test("retrospective triage moves inbox records and persists classification metadata", () => {
  const workspace = freshDir();
  const root = path.join(workspace, "retrospectives");
  createRetrospectiveStore(workspace, root);
  const retrospective = validRetrospective();
  writeRetrospective(workspace, root, retrospective);
  const source = path.join(root, "inbox", `${retrospective.id}.md`);
  const revision = revisionFor(readFileSync(source, "utf8"));

  const moved = triageRetrospective(workspace, root, retrospective.id, revision, {
    destination: "active",
    disposition: "actionable",
    owner_scope: "projectops",
    categories: ["tooling", "docs"],
    next_action: "improve the command guidance",
    related_info: ["project-ops:backlog/items/POP-031.md", "README.md"],
  });

  assert.equal(moved.status, "active");
  assert.equal(moved.path, `active/${retrospective.id}.md`);
  assert.notEqual(moved.revision, revision);
  assert.equal(existsSync(source), false);
  assert.deepEqual(readRetrospective(workspace, root, "active", retrospective.id), {
    ...retrospective,
    status: "active",
    disposition: "actionable",
    owner_scope: "projectops",
    categories: ["tooling", "docs"],
    next_action: "improve the command guidance",
    related_info: ["project-ops:backlog/items/POP-031.md", "README.md"],
  });
  const index = JSON.parse(readFileSync(path.join(root, "index.json"), "utf8")) as { records: { status: string; path: string }[] };
  assert.deepEqual(index.records.map(({ status, path: recordPath }) => ({ status, path: recordPath })), [{ status: "active", path: `active/${retrospective.id}.md` }]);
  rmSync(workspace, { recursive: true, force: true });
});

test("retrospective archive closes active records and persists action metadata", () => {
  const workspace = freshDir();
  const root = path.join(workspace, "retrospectives");
  createRetrospectiveStore(workspace, root);
  const active: Retrospective = { ...validRetrospective(), status: "active", next_action: "Monitor the existing action." };
  writeRetrospective(workspace, root, active);
  rebuildRetrospectiveIndexes(workspace, root);
  const activeFile = path.join(root, "active", `${active.id}.md`);
  const moved = archiveRetrospective(workspace, root, active.id, revisionFor(readFileSync(activeFile, "utf8")), {
    action_disposition: "resolved",
    actioned_at: "2026-09-04T15:00:00.000Z",
    backlog: ["project-ops:backlog/items/POP-031.md"],
    resolution_note: "The lifecycle implementation is complete.",
  });

  assert.equal(moved.status, "archive");
  assert.equal(moved.path, `archive/${active.id}.md`);
  assert.equal(existsSync(activeFile), false);
  assert.deepEqual(readRetrospective(workspace, root, "archive", active.id), {
    ...active,
    status: "archive",
    action_disposition: "resolved",
    actioned_at: "2026-09-04T15:00:00.000Z",
    backlog: ["project-ops:backlog/items/POP-031.md"],
    resolution_note: "The lifecycle implementation is complete.",
  });
  rmSync(workspace, { recursive: true, force: true });
});

test("retrospective archive accepts canonical backlog references for generic project prefixes", () => {
  const workspace = freshDir();
  const root = path.join(workspace, "retrospectives");
  createRetrospectiveStore(workspace, root);
  const active = { ...validRetrospective(), id: "retro-generic-backlog", status: "active" as const };
  writeRetrospective(workspace, root, active);
  const activeFile = path.join(root, "active", `${active.id}.md`);
  const common = {
    action_disposition: "resolved",
    actioned_at: "2026-09-04T15:00:00.000Z",
    resolution_note: "Tracked.",
  };

  assert.throws(
    () => archiveRetrospective(workspace, root, active.id, revisionFor(readFileSync(activeFile, "utf8")), {
      ...common,
      backlog: ["project-ops:backlog/items/POP-031"],
    }),
    /canonical|logical reference/i,
  );
  assert.equal(existsSync(activeFile), true);

  const archived = archiveRetrospective(workspace, root, active.id, revisionFor(readFileSync(activeFile, "utf8")), {
    ...common,
    backlog: ["project-ops:backlog/items/ABC-001.md"],
  });
  assert.equal(archived.status, "archive");
  assert.deepEqual(archived.backlog, ["project-ops:backlog/items/ABC-001.md"]);
  rmSync(workspace, { recursive: true, force: true });
});

test("retrospective triage can archive inbox records and leaves one indexed authority", () => {
  const workspace = freshDir();
  const root = path.join(workspace, "retrospectives");
  createRetrospectiveStore(workspace, root);
  const retrospective = validRetrospective();
  writeRetrospective(workspace, root, retrospective);
  const inboxFile = path.join(root, "inbox", `${retrospective.id}.md`);
  const moved = triageRetrospective(workspace, root, retrospective.id, revisionFor(readFileSync(inboxFile, "utf8")), {
    destination: "archive",
    disposition: "noise",
    owner_scope: "workspace",
    categories: ["triage"],
    next_action: "Review only if the signal recurs.",
    related_info: [],
  });

  assert.equal(moved.status, "archive");
  assert.equal(existsSync(inboxFile), false);
  assert.equal(existsSync(path.join(root, "active", `${retrospective.id}.md`)), false);
  assert.equal(existsSync(path.join(root, "archive", `${retrospective.id}.md`)), true);
  const index = JSON.parse(readFileSync(path.join(root, "index.json"), "utf8")) as {
    records: { id: string; path: string; status: string }[];
  };
  assert.equal(index.records.length, 1);
  assert.deepEqual(index.records, [{
    id: retrospective.id,
    created_at: retrospective.created_at,
    project: retrospective.project,
    task: retrospective.task,
    trigger: retrospective.trigger,
    status: "archive",
    harness: retrospective.harness,
    model: retrospective.model,
    disposition: "noise",
    owner_scope: "workspace",
    categories: ["triage"],
    next_action: "Review only if the signal recurs.",
    related_info: [],
    path: `archive/${retrospective.id}.md`,
  }]);
  const readableIndex = readFileSync(path.join(root, "INDEX.md"), "utf8");
  assert.match(readableIndex, /> Total records: 1/);
  assert.equal((readableIndex.match(new RegExp(`\\| archive \\| ${retrospective.id} \\|`, "g")) ?? []).length, 1);
  assert.doesNotMatch(readableIndex, new RegExp(`\\| inbox \\| ${retrospective.id} \\|`));
  rmSync(workspace, { recursive: true, force: true });
});

test("retrospective transitions reject a third-status duplicate before writing", () => {
  const workspace = freshDir();
  const root = path.join(workspace, "retrospectives");
  createRetrospectiveStore(workspace, root);
  const retrospective = validRetrospective();
  writeRetrospective(workspace, root, retrospective);
  const archive = { ...retrospective, status: "archive" as const };
  writeRetrospective(workspace, root, archive);
  const sourceFile = path.join(root, "inbox", `${retrospective.id}.md`);
  const archiveFile = path.join(root, "archive", `${retrospective.id}.md`);
  const sourceBefore = readFileSync(sourceFile, "utf8");
  const archiveBefore = readFileSync(archiveFile, "utf8");
  const indexBefore = readFileSync(path.join(root, "index.json"), "utf8");
  const readableBefore = readFileSync(path.join(root, "INDEX.md"), "utf8");

  assert.throws(
    () => triageRetrospective(workspace, root, retrospective.id, revisionFor(sourceBefore), {
      destination: "active",
      disposition: "actionable",
      owner_scope: "projectops",
      categories: ["tooling"],
      next_action: "Resolve the duplicate.",
      related_info: [],
    }),
    RetrospectiveTransitionError,
  );
  assert.equal(readFileSync(sourceFile, "utf8"), sourceBefore);
  assert.equal(readFileSync(archiveFile, "utf8"), archiveBefore);
  assert.equal(readFileSync(path.join(root, "index.json"), "utf8"), indexBefore);
  assert.equal(readFileSync(path.join(root, "INDEX.md"), "utf8"), readableBefore);
  assert.equal(existsSync(path.join(root, "active", `${retrospective.id}.md`)), false);
  rmSync(workspace, { recursive: true, force: true });
});

test("retrospective transitions reject stale revisions, invalid states, and destination conflicts without moving the source", () => {
  const workspace = freshDir();
  const root = path.join(workspace, "retrospectives");
  createRetrospectiveStore(workspace, root);
  const retrospective = validRetrospective();
  writeRetrospective(workspace, root, retrospective);
  const source = path.join(root, "inbox", `${retrospective.id}.md`);
  const sourceBefore = readFileSync(source, "utf8");
  const options = {
    destination: "active" as const,
    disposition: "actionable",
    owner_scope: "projectops",
    categories: ["tooling"],
    next_action: "follow up",
    related_info: [],
  };

  assert.throws(
    () => triageRetrospective(workspace, root, retrospective.id, "stale", options),
    RetrospectiveRevisionConflictError,
  );
  assert.equal(readFileSync(source, "utf8"), sourceBefore);

  assert.throws(
    () => archiveRetrospective(workspace, root, retrospective.id, revisionFor(sourceBefore), {
      action_disposition: "ignored",
      actioned_at: "2026-09-04T15:00:00.000Z",
      backlog: [],
      resolution_note: "Not active.",
    }),
    RetrospectiveTransitionError,
  );
  assert.equal(readFileSync(source, "utf8"), sourceBefore);

  writeRetrospective(workspace, root, { ...retrospective, status: "active" });
  const activeFile = path.join(root, "active", `${retrospective.id}.md`);
  const activeBefore = readFileSync(activeFile, "utf8");
  assert.throws(
    () => triageRetrospective(workspace, root, retrospective.id, revisionFor(sourceBefore), options),
    /already exists/i,
  );
  assert.equal(readFileSync(activeFile, "utf8"), activeBefore);
  rmSync(workspace, { recursive: true, force: true });
});

test("retrospective transition rolls back source, destination, and indexes after publication failure", () => {
  const workspace = freshDir();
  const root = path.join(workspace, "retrospectives");
  createRetrospectiveStore(workspace, root);
  const retrospective = validRetrospective();
  writeRetrospective(workspace, root, retrospective);
  rebuildRetrospectiveIndexes(workspace, root);
  const source = path.join(root, "inbox", `${retrospective.id}.md`);
  const sourceBefore = readFileSync(source, "utf8");
  const indexBefore = readFileSync(path.join(root, "index.json"), "utf8");
  const readableBefore = readFileSync(path.join(root, "INDEX.md"), "utf8");

  assert.throws(
    () => triageRetrospective(workspace, root, retrospective.id, revisionFor(sourceBefore), {
      destination: "active",
      disposition: "actionable",
      owner_scope: "projectops",
      categories: ["tooling"],
      next_action: "follow up",
      related_info: [],
    }, (target: string) => {
      if (target.endsWith("INDEX.md")) throw new Error("injected index refresh failure");
    }),
    /injected index refresh failure/,
  );
  assert.equal(readFileSync(source, "utf8"), sourceBefore);
  assert.equal(existsSync(path.join(root, "active", `${retrospective.id}.md`)), false);
  assert.equal(readFileSync(path.join(root, "index.json"), "utf8"), indexBefore);
  assert.equal(readFileSync(path.join(root, "INDEX.md"), "utf8"), readableBefore);
  rmSync(workspace, { recursive: true, force: true });
});

test("generated capture ids avoid records in every status while holding a workspace runtime lock", () => {
  const workspace = freshDir();
  const root = path.join(workspace, "retrospectives");
  createRetrospectiveStore(workspace, root);
  const base = validRetrospective();
  writeRetrospective(workspace, root, { ...base, status: "active" });
  writeRetrospective(workspace, root, { ...base, id: `${base.id}-2`, status: "archive" });

  let observed = false;
  const generated = captureRetrospective(workspace, root, base, (target) => {
    if (!target.endsWith(`${base.id}-3.md`)) return;
    observed = true;
    assert.equal(existsSync(path.join(root, ".retrospective-capture.lock")), false);
    assert.ok(existsSync(retrospectiveLockPath(workspace, root)));
  }, { generated: true });

  assert.equal(observed, true);
  assert.equal(generated.id, `${base.id}-3`);
  assert.equal(generated.path, `inbox/${base.id}-3.md`);
  assert.ok(existsSync(path.join(root, "inbox", `${base.id}-3.md`)));
  rmSync(workspace, { recursive: true, force: true });
});

test("capture cleans a record created before the write failure and restores partial derived indexes", () => {
  const workspace = freshDir();
  const root = path.join(workspace, "retrospectives");
  createRetrospectiveStore(workspace, root);
  const beforeIndex = readFileSync(path.join(root, "index.json"), "utf8");
  const beforeReadable = readFileSync(path.join(root, "INDEX.md"), "utf8");
  const retrospective = { ...validRetrospective(), id: "retro-write-failure" };

  assert.throws(
    () => captureRetrospective(workspace, root, retrospective, (target) => {
      if (target.endsWith(`${retrospective.id}.md`)) {
        writeFileSync(target, "partial record", "utf8");
        throw new Error("injected create-then-write failure");
      }
      if (target.endsWith("INDEX.md")) {
        writeFileSync(target, "partial index", "utf8");
        throw new Error("injected partial index failure");
      }
    }),
    /injected create-then-write failure/,
  );
  assert.equal(existsSync(path.join(root, "inbox", `${retrospective.id}.md`)), false);
  assert.equal(readFileSync(path.join(root, "index.json"), "utf8"), beforeIndex);
  assert.equal(readFileSync(path.join(root, "INDEX.md"), "utf8"), beforeReadable);

  const partial = { ...retrospective, id: "retro-index-failure" };
  assert.throws(
    () => captureRetrospective(workspace, root, partial, (target) => {
      if (target.endsWith("INDEX.md")) {
        writeFileSync(target, "partial index", "utf8");
        throw new Error("injected partial index failure");
      }
    }),
    /injected partial index failure/,
  );
  assert.equal(existsSync(path.join(root, "inbox", `${partial.id}.md`)), false);
  assert.equal(readFileSync(path.join(root, "index.json"), "utf8"), beforeIndex);
  assert.equal(readFileSync(path.join(root, "INDEX.md"), "utf8"), beforeReadable);
  rmSync(workspace, { recursive: true, force: true });
});

test("explicit capture ids conflict with active and archive authorities", () => {
  const workspace = freshDir();
  const root = path.join(workspace, "retrospectives");
  createRetrospectiveStore(workspace, root);
  const retrospective = validRetrospective();
  writeRetrospective(workspace, root, { ...retrospective, status: "active" });

  assert.throws(
    () => captureRetrospective(workspace, root, retrospective),
    /already exists/i,
  );
  writeRetrospective(workspace, root, { ...retrospective, id: "retro-archive-authority", status: "archive" });
  assert.throws(
    () => captureRetrospective(workspace, root, { ...retrospective, id: "retro-archive-authority" }),
    /already exists/i,
  );
  rmSync(workspace, { recursive: true, force: true });
});

test("retrospective capture removes a stale runtime lock and leaves no artifact lock", () => {
  const workspace = freshDir();
  const root = path.join(workspace, "retrospectives");
  createRetrospectiveStore(workspace, root);
  const lock = retrospectiveLockPath(workspace, root);
  mkdirSync(path.dirname(lock), { recursive: true });
  writeFileSync(lock, "99999999\n", "utf8");

  const captured = captureRetrospective(workspace, root, { ...validRetrospective(), id: "retro-stale-lock" });

  assert.equal(captured.id, "retro-stale-lock");
  assert.equal(existsSync(lock), false);
  assert.equal(existsSync(path.join(root, ".retrospective-capture.lock")), false);
  rmSync(workspace, { recursive: true, force: true });
});

test("capture rolls back after the actual record create/write helper fails", () => {
  const workspace = freshDir();
  const root = path.join(workspace, "retrospectives");
  createRetrospectiveStore(workspace, root);
  const indexBefore = readFileSync(path.join(root, "index.json"), "utf8");
  const readableBefore = readFileSync(path.join(root, "INDEX.md"), "utf8");
  const retrospective = { ...validRetrospective(), id: "retro-helper-record-failure" };
  let failed = false;
  const fsOps: RetrospectiveFsOps = {
    writeFileSync: ((target: string, content: unknown, options: unknown) => {
      writeFileSync(target, content as Parameters<typeof writeFileSync>[1], options as Parameters<typeof writeFileSync>[2]);
      if (!failed && target.endsWith(`${retrospective.id}.md`)) {
        failed = true;
        throw new Error("injected record helper failure");
      }
    }) as NonNullable<RetrospectiveFsOps["writeFileSync"]>,
  };

  assert.throws(
    () => captureRetrospective(workspace, root, retrospective, undefined, { fsOps }),
    /injected record helper failure/,
  );
  assert.equal(existsSync(path.join(root, "inbox", `${retrospective.id}.md`)), false);
  assert.equal(existsSync(retrospectiveLockPath(workspace, root)), false);
  assert.equal(readFileSync(path.join(root, "index.json"), "utf8"), indexBefore);
  assert.equal(readFileSync(path.join(root, "INDEX.md"), "utf8"), readableBefore);
  rmSync(workspace, { recursive: true, force: true });
});

test("capture restores both indexes after the actual derived index write helper fails", () => {
  const workspace = freshDir();
  const root = path.join(workspace, "retrospectives");
  createRetrospectiveStore(workspace, root);
  const indexBefore = readFileSync(path.join(root, "index.json"), "utf8");
  const readableBefore = readFileSync(path.join(root, "INDEX.md"), "utf8");
  const retrospective = { ...validRetrospective(), id: "retro-helper-index-failure" };
  let failed = false;
  const fsOps: RetrospectiveFsOps = {
    writeFileSync: ((target: string, content: unknown, options: unknown) => {
      writeFileSync(target, content as Parameters<typeof writeFileSync>[1], options as Parameters<typeof writeFileSync>[2]);
      if (!failed && target.endsWith("INDEX.md")) {
        failed = true;
        throw new Error("injected derived index helper failure");
      }
    }) as NonNullable<RetrospectiveFsOps["writeFileSync"]>,
  };

  assert.throws(
    () => captureRetrospective(workspace, root, retrospective, undefined, { fsOps }),
    /injected derived index helper failure/,
  );
  assert.equal(existsSync(path.join(root, "inbox", `${retrospective.id}.md`)), false);
  assert.equal(existsSync(retrospectiveLockPath(workspace, root)), false);
  assert.equal(readFileSync(path.join(root, "index.json"), "utf8"), indexBefore);
  assert.equal(readFileSync(path.join(root, "INDEX.md"), "utf8"), readableBefore);
  rmSync(workspace, { recursive: true, force: true });
});

test("transition rolls back after the actual destination write helper fails", () => {
  const workspace = freshDir();
  const root = path.join(workspace, "retrospectives");
  createRetrospectiveStore(workspace, root);
  const retrospective = validRetrospective();
  writeRetrospective(workspace, root, retrospective);
  const source = path.join(root, "inbox", `${retrospective.id}.md`);
  const sourceBefore = readFileSync(source, "utf8");
  const indexBefore = readFileSync(path.join(root, "index.json"), "utf8");
  const readableBefore = readFileSync(path.join(root, "INDEX.md"), "utf8");
  let failed = false;
  const fsOps: RetrospectiveFsOps = {
    writeFileSync: ((target: string, content: unknown, options: unknown) => {
      writeFileSync(target, content as Parameters<typeof writeFileSync>[1], options as Parameters<typeof writeFileSync>[2]);
      if (!failed && target.endsWith(`/active/${retrospective.id}.md`)) {
        failed = true;
        throw new Error("injected destination helper failure");
      }
    }) as NonNullable<RetrospectiveFsOps["writeFileSync"]>,
  };

  assert.throws(
    () => triageRetrospective(workspace, root, retrospective.id, revisionFor(sourceBefore), {
      destination: "active",
      disposition: "actionable",
      owner_scope: "projectops",
      categories: ["tooling"],
      next_action: "retry the transition",
      related_info: [],
    }, undefined, fsOps),
    /injected destination helper failure/,
  );
  assert.equal(readFileSync(source, "utf8"), sourceBefore);
  assert.equal(existsSync(path.join(root, "active", `${retrospective.id}.md`)), false);
  assert.equal(existsSync(retrospectiveLockPath(workspace, root)), false);
  assert.equal(readFileSync(path.join(root, "index.json"), "utf8"), indexBefore);
  assert.equal(readFileSync(path.join(root, "INDEX.md"), "utf8"), readableBefore);
  rmSync(workspace, { recursive: true, force: true });
});

test("capture cleans a runtime lock when the actual PID write fails and remains recoverable", () => {
  const workspace = freshDir();
  const root = path.join(workspace, "retrospectives");
  createRetrospectiveStore(workspace, root);
  const lock = retrospectiveLockPath(workspace, root);
  let failed = false;
  const fsOps: RetrospectiveFsOps = {
    writeSync: ((_fd: number, _buffer: ArrayBufferView | string, _offset?: number | null, _length?: number | null, _position?: number | null) => {
      if (!failed) {
        failed = true;
        return 0;
      }
      return 0;
    }) as NonNullable<RetrospectiveFsOps["writeSync"]>,
  };
  const retrospective = { ...validRetrospective(), id: "retro-helper-lock-failure" };

  assert.throws(
    () => captureRetrospective(workspace, root, retrospective, undefined, { fsOps }),
    /PID write was incomplete/,
  );
  assert.equal(existsSync(lock), false);
  assert.equal(existsSync(path.join(root, ".retrospective-capture.lock")), false);
  const captured = captureRetrospective(workspace, root, retrospective);
  assert.equal(captured.id, retrospective.id);
  assert.equal(existsSync(lock), false);
  rmSync(workspace, { recursive: true, force: true });
});

test("capture recovers an old empty runtime lock but preserves a live lock", () => {
  const workspace = freshDir();
  const root = path.join(workspace, "retrospectives");
  createRetrospectiveStore(workspace, root);
  const lock = retrospectiveLockPath(workspace, root);
  mkdirSync(path.dirname(lock), { recursive: true });
  writeFileSync(lock, "", "utf8");
  const old = new Date(0);
  utimesSync(lock, old, old);

  const recovered = captureRetrospective(workspace, root, { ...validRetrospective(), id: "retro-empty-lock" });
  assert.equal(recovered.id, "retro-empty-lock");
  assert.equal(existsSync(lock), false);

  writeFileSync(lock, `${process.pid}\n`, "utf8");
  assert.throws(
    () => captureRetrospective(workspace, root, { ...validRetrospective(), id: "retro-live-lock" }),
    (error: unknown) => error instanceof RetrospectiveTargetError && /busy/i.test(error.message),
  );
  assert.equal(readFileSync(lock, "utf8"), `${process.pid}\n`);
  rmSync(workspace, { recursive: true, force: true });
});

function revisionFor(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
