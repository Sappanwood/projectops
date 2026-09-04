import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { runCli } from "../src/app.js";

function freshDir(): string {
  return mkdtempSync(path.join(tmpdir(), "pops-docs-"));
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
  mkdirSync(project);
  assert.equal(run(["project", "add", "repo-a"], workspace).code, 0);
  return { workspace, project };
}

const TARGETS = [
  "README.md",
  "AGENTS.md",
  path.join("docs", "PRODUCT_SPEC.md"),
  path.join("docs", "ARCHITECTURE.md"),
];

test("docs scaffold creates the fixed project document set", () => {
  const { workspace, project } = setupWorkspace();

  const result = run(["docs", "scaffold", "repo-a", "--json"], workspace);

  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.stdout[0] ?? "null"), {
    ok: true,
    project: "repo-a",
    created: TARGETS,
    skipped: [],
  });
  for (const target of TARGETS) {
    assert.ok(lstatSync(path.join(project, target)).isFile());
  }
  assert.match(readFileSync(path.join(project, "README.md"), "utf8"), /# .*README|项目概览/);
  assert.match(readFileSync(path.join(project, "AGENTS.md"), "utf8"), /# .*AGENTS|路由/);
  assert.match(readFileSync(path.join(project, "docs", "PRODUCT_SPEC.md"), "utf8"), /产品概述/);
  assert.match(readFileSync(path.join(project, "docs", "ARCHITECTURE.md"), "utf8"), /架构概览/);
});

test("docs scaffold skips existing regular files byte-for-byte", () => {
  const { workspace, project } = setupWorkspace();
  const readme = path.join(project, "README.md");
  const agents = path.join(project, "AGENTS.md");
  writeFileSync(readme, "# Handwritten README\n", "utf8");
  writeFileSync(agents, "# Handwritten AGENTS\n", "utf8");

  const first = run(["docs", "scaffold", "repo-a", "--json"], workspace);
  assert.equal(first.code, 0);
  assert.deepEqual(JSON.parse(first.stdout[0] ?? "null"), {
    ok: true,
    project: "repo-a",
    created: [path.join("docs", "PRODUCT_SPEC.md"), path.join("docs", "ARCHITECTURE.md")],
    skipped: ["README.md", "AGENTS.md"],
  });
  const before = new Map(TARGETS.map((target) => [target, readFileSync(path.join(project, target), "utf8")]));

  const second = run(["docs", "scaffold", "repo-a", "--json"], workspace);

  assert.equal(second.code, 0);
  assert.deepEqual(JSON.parse(second.stdout[0] ?? "null"), {
    ok: true,
    project: "repo-a",
    created: [],
    skipped: TARGETS,
  });
  for (const target of TARGETS) {
    assert.equal(readFileSync(path.join(project, target), "utf8"), before.get(target));
  }
});

test("docs scaffold preflights non-regular targets before writing any file", () => {
  const { workspace, project } = setupWorkspace();
  mkdirSync(path.join(project, "README.md"));

  const result = run(["docs", "scaffold", "repo-a", "--json"], workspace);

  assert.equal(result.code, 1);
  assert.match(result.stderr.join("\n"), /README\.md.*(regular|file)|not.*file/i);
  assert.equal(existsSync(path.join(project, "AGENTS.md")), false);
  assert.equal(existsSync(path.join(project, "docs")), false);
});

test("docs scaffold rejects an escaping docs parent before writing", () => {
  const { workspace, project } = setupWorkspace();
  const outside = freshDir();
  symlinkSync(outside, path.join(project, "docs"), "dir");

  const result = run(["docs", "scaffold", "repo-a"], workspace);

  assert.equal(result.code, 1);
  assert.match(result.stderr.join("\n"), /outside|contain/i);
  assert.equal(existsSync(path.join(project, "README.md")), false);
  assert.equal(existsSync(path.join(project, "AGENTS.md")), false);
  assert.equal(existsSync(path.join(outside, "PRODUCT_SPEC.md")), false);
});

test("docs scaffold accepts a registered project symlink that stays inside the workspace", () => {
  const workspace = freshDir();
  assert.equal(run(["init"], workspace).code, 0);
  const projects = path.join(workspace, "projects");
  const project = path.join(projects, "repo-a");
  mkdirSync(project, { recursive: true });
  const link = path.join(workspace, "repo-link");
  symlinkSync(project, link, "dir");
  assert.equal(run(["project", "add", "repo-link"], workspace).code, 0);

  const result = run(["docs", "scaffold", "repo-link", "--json"], workspace);

  assert.equal(result.code, 0, result.stderr.join("\n"));
  const receipt = JSON.parse(result.stdout[0] ?? "null") as { created: string[]; skipped: string[] };
  assert.deepEqual(receipt.created, TARGETS);
  assert.deepEqual(receipt.skipped, []);
  for (const target of TARGETS) assert.ok(lstatSync(path.join(project, target)).isFile());
});

test("docs scaffold rejects a registered project symlink that escapes the workspace", () => {
  const workspace = freshDir();
  const outside = freshDir();
  assert.equal(run(["init"], workspace).code, 0);
  symlinkSync(outside, path.join(workspace, "repo-link"), "dir");
  assert.equal(run(["project", "add", "repo-link"], workspace).code, 0);

  const result = run(["docs", "scaffold", "repo-link"], workspace);

  assert.equal(result.code, 1);
  assert.match(result.stderr.join("\n"), /outside|workspace|resolv/i);
  assert.equal(existsSync(path.join(outside, "README.md")), false);
});

test("docs scaffold preflights the final target before creating earlier files", () => {
  const { workspace, project } = setupWorkspace();
  mkdirSync(path.join(project, "docs"));
  mkdirSync(path.join(project, "docs", "ARCHITECTURE.md"));

  const result = run(["docs", "scaffold", "repo-a", "--json"], workspace);

  assert.equal(result.code, 1);
  assert.match(result.stderr.join("\n"), /docs\/ARCHITECTURE\.md.*(regular|file)|not.*file/i);
  assert.equal(existsSync(path.join(project, "README.md")), false);
  assert.equal(existsSync(path.join(project, "AGENTS.md")), false);
  assert.equal(existsSync(path.join(project, "docs", "PRODUCT_SPEC.md")), false);
  assert.ok(lstatSync(path.join(project, "docs", "ARCHITECTURE.md")).isDirectory());
});

test("docs scaffold rejects an unregistered project", () => {
  const workspace = freshDir();
  assert.equal(run(["init"], workspace).code, 0);

  const result = run(["docs", "scaffold", "missing"], workspace);

  assert.equal(result.code, 1);
  assert.match(result.stderr.join("\n"), /not registered/i);
});
