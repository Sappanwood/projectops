import assert from "node:assert/strict";
import {
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

import { runCli } from "../src/app.js";

const TARGETS = [
  "README.md",
  "AGENTS.md",
  path.join("docs", "PRODUCT_SPEC.md"),
  path.join("docs", "ARCHITECTURE.md"),
];

function freshDir(): string {
  return mkdtempSync(path.join(tmpdir(), "pops-docs-check-"));
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

function setupWorkspace(): { workspace: string; project: string } {
  const workspace = freshDir();
  assert.equal(run(["init"], workspace).code, 0);
  const project = path.join(workspace, "repo-a");
  mkdirProject(project);
  assert.equal(run(["project", "add", "repo-a"], workspace).code, 0);
  return { workspace, project };
}

function mkdirProject(project: string): void {
  const docs = path.join(project, "docs");
  const parent = path.dirname(docs);
  mkdirSync(parent, { recursive: true });
  mkdirSync(docs, { recursive: true });
}

function writeCompleteDocs(project: string): void {
  writeFileSync(path.join(project, "README.md"), "# README\n", "utf8");
  writeFileSync(path.join(project, "AGENTS.md"), "# AGENTS\n", "utf8");
  writeFileSync(path.join(project, "docs", "PRODUCT_SPEC.md"), "# Product spec\n", "utf8");
  writeFileSync(path.join(project, "docs", "ARCHITECTURE.md"), "# Architecture\n", "utf8");
}

test("docs check accepts the complete fixed document set without modifying it", () => {
  const { workspace, project } = setupWorkspace();
  writeCompleteDocs(project);
  const before = new Map(
    TARGETS.map((target) => {
      const file = path.join(project, target);
      const stat = lstatSync(file);
      return [target, { bytes: readFileSync(file), mtimeMs: stat.mtimeMs }];
    }),
  );

  const result = run(["docs", "check", "repo-a", "--json"], workspace);

  assert.equal(result.code, 0, result.stderr.join("\n"));
  assert.deepEqual(JSON.parse(result.stdout[0] ?? "null"), {
    ok: true,
    project: "repo-a",
    problems: [],
  });
  for (const target of TARGETS) {
    const file = path.join(project, target);
    const after = lstatSync(file);
    assert.deepEqual(readFileSync(file), before.get(target)?.bytes);
    assert.equal(after.mtimeMs, before.get(target)?.mtimeMs);
  }
  rmSync(workspace, { recursive: true, force: true });
});

test("docs check reports every missing document", () => {
  const { workspace, project } = setupWorkspace();
  const manifest = path.join(workspace, ".pops", "workspace.json");
  const beforeManifest = { bytes: readFileSync(manifest), mtimeMs: lstatSync(manifest).mtimeMs };
  const beforeProject = lstatSync(project).mtimeMs;

  const result = run(["docs", "check", "repo-a", "--json"], workspace);

  assert.equal(result.code, 1);
  const checked = JSON.parse(result.stdout[0] ?? "null") as {
    ok: boolean;
    project: string;
    problems: { path: string; issue: string }[];
  };
  assert.equal(checked.ok, false);
  assert.equal(checked.project, "repo-a");
  assert.deepEqual(checked.problems, TARGETS.map((target) => ({
    path: target,
    issue: "document is missing",
  })));
  assert.deepEqual(readFileSync(manifest), beforeManifest.bytes);
  assert.equal(lstatSync(manifest).mtimeMs, beforeManifest.mtimeMs);
  assert.equal(lstatSync(project).mtimeMs, beforeProject);
  rmSync(workspace, { recursive: true, force: true });
});

test("docs check reports every document that lacks a Markdown H1", () => {
  const { workspace, project } = setupWorkspace();
  writeFileSync(path.join(project, "README.md"), "## README\n", "utf8");
  writeFileSync(path.join(project, "AGENTS.md"), "body\n", "utf8");
  writeFileSync(path.join(project, "docs", "PRODUCT_SPEC.md"), "### Product spec\n", "utf8");
  writeFileSync(path.join(project, "docs", "ARCHITECTURE.md"), "body\n", "utf8");
  const before = new Map(
    TARGETS.map((target) => {
      const file = path.join(project, target);
      return [target, { bytes: readFileSync(file), mtimeMs: lstatSync(file).mtimeMs }];
    }),
  );

  const result = run(["docs", "check", "repo-a", "--json"], workspace);

  assert.equal(result.code, 1);
  const checked = JSON.parse(result.stdout[0] ?? "null") as {
    problems: { path: string; issue: string }[];
  };
  assert.deepEqual(checked.problems, TARGETS.map((target) => ({
    path: target,
    issue: "document is missing a level-one Markdown heading",
  })));
  for (const target of TARGETS) {
    const file = path.join(project, target);
    assert.deepEqual(readFileSync(file), before.get(target)?.bytes);
    assert.equal(lstatSync(file).mtimeMs, before.get(target)?.mtimeMs);
  }
  rmSync(workspace, { recursive: true, force: true });
});

test("docs check treats a document symlink as non-regular without following it", () => {
  const { workspace, project } = setupWorkspace();
  const outside = freshDir();
  writeFileSync(path.join(outside, "readme.md"), "# Outside\n", "utf8");
  symlinkSync(path.join(outside, "readme.md"), path.join(project, "README.md"));
  writeFileSync(path.join(project, "AGENTS.md"), "# AGENTS\n", "utf8");
  writeFileSync(path.join(project, "docs", "PRODUCT_SPEC.md"), "# Product spec\n", "utf8");
  writeFileSync(path.join(project, "docs", "ARCHITECTURE.md"), "# Architecture\n", "utf8");
  const beforeOutside = readFileSync(path.join(outside, "readme.md"));
  const beforeLink = lstatSync(path.join(project, "README.md"));

  const result = run(["docs", "check", "repo-a", "--json"], workspace);

  assert.equal(result.code, 1);
  const checked = JSON.parse(result.stdout[0] ?? "null") as {
    problems: { path: string; issue: string }[];
  };
  assert.deepEqual(checked.problems, [{
    path: "README.md",
    issue: "document is not a regular file",
  }]);
  assert.deepEqual(readFileSync(path.join(outside, "readme.md")), beforeOutside);
  assert.equal(lstatSync(path.join(project, "README.md")).mtimeMs, beforeLink.mtimeMs);
  rmSync(workspace, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

test("docs check accepts a registered project symlink that stays inside the workspace", () => {
  const workspace = freshDir();
  assert.equal(run(["init"], workspace).code, 0);
  const project = path.join(workspace, "projects", "repo-a");
  mkdirSync(path.join(project, "docs"), { recursive: true });
  const link = path.join(workspace, "repo-link");
  symlinkSync(project, link, "dir");
  assert.equal(run(["project", "add", "repo-link"], workspace).code, 0);
  writeCompleteDocs(project);

  const result = run(["docs", "check", "repo-link", "--json"], workspace);

  assert.equal(result.code, 0, result.stderr.join("\n"));
  assert.deepEqual(JSON.parse(result.stdout[0] ?? "null"), {
    ok: true,
    project: "repo-link",
    problems: [],
  });
  rmSync(workspace, { recursive: true, force: true });
});
