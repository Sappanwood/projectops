import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { runCli } from "../src/app.js";

const MANIFEST_DIR = ".pops";
const MANIFEST_FILE = "workspace.json";

function freshDir(): string {
  return mkdtempSync(path.join(tmpdir(), "pops-"));
}

function manifestPath(dir: string): string {
  return path.join(dir, MANIFEST_DIR, MANIFEST_FILE);
}

function run(
  args: string[],
  cwd: string,
): { code: number; stdout: string[]; stderr: string[] } {
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

test("init creates a workspace manifest in an empty directory", () => {
  const dir = freshDir();
  const { code, stderr } = run(["init"], dir);

  assert.equal(code, 0);
  assert.deepEqual(stderr, []);
  const manifest = JSON.parse(readFileSync(manifestPath(dir), "utf8")) as {
    schema: string;
    name: string;
    projects: unknown;
    artifact_layout: unknown;
  };
  assert.equal(manifest.schema, "workspace/Manifest@1");
  assert.equal(manifest.name, path.basename(dir));
  assert.deepEqual(manifest.projects, {});
  assert.ok(manifest.artifact_layout);
});

test("init does not create per-project artifact roots", () => {
  const dir = freshDir();
  run(["init"], dir);

  assert.equal(existsSync(path.join(dir, "ops")), false);
});

test("init creates a missing target directory", () => {
  const parent = freshDir();
  const dir = path.join(parent, "nested", "workspace");
  const { code } = run(["init", dir], parent);

  assert.equal(code, 0);
  assert.ok(existsSync(manifestPath(dir)));
});

test("init refuses to overwrite an existing manifest", () => {
  const dir = freshDir();
  run(["init"], dir);
  const before = readFileSync(manifestPath(dir), "utf8");
  writeFileSync(manifestPath(dir), before + "\n// user edit\n", "utf8");

  const { code, stderr } = run(["init"], dir);

  assert.equal(code, 1);
  assert.match(stderr.join("\n"), /already/i);
  assert.equal(readFileSync(manifestPath(dir), "utf8"), before + "\n// user edit\n");
});

test("init succeeds in a non-empty directory without a manifest", () => {
  const dir = freshDir();
  writeFileSync(path.join(dir, "notes.txt"), "hello", "utf8");
  mkdirSync(path.join(dir, "src"));

  const { code } = run(["init"], dir);

  assert.equal(code, 0);
  assert.ok(existsSync(manifestPath(dir)));
  assert.ok(existsSync(path.join(dir, "notes.txt")));
});

test("init without arguments uses the current directory", () => {
  const dir = freshDir();
  const { code } = run(["init"], dir);

  assert.equal(code, 0);
  assert.ok(existsSync(manifestPath(dir)));
});
