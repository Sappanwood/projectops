import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const cli = path.resolve("dist/cli.js");
const target = ".agents/skills/projectops-workflow";
function fixture() {
  return mkdtempSync(path.join(tmpdir(), "pops-skill-"));
}
function run(cwd: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [cli, ...args, "--json"], { cwd, encoding: "utf8" });
  return {
    code: result.status,
    receipt: JSON.parse(result.stdout || "null"),
    stderr: result.stderr,
  };
}

test("built init installs skill and repeated install is a verifiable no-op", () => {
  const dir = fixture();
  const first = run(dir, "init");
  assert.equal(first.code, 0);
  assert.equal(first.receipt.skill.status, "installed");
  assert.match(first.receipt.skill.distribution_id, /^sha256:/);
  const skill = path.join(dir, target, "SKILL.md");
  const bytes = readFileSync(skill, "utf8");
  const repeat = run(dir, "skill", "install");
  assert.equal(repeat.code, 0);
  assert.equal(repeat.receipt.skill.no_op, true);
  assert.equal(readFileSync(skill, "utf8"), bytes);
  const status = run(dir, "skill", "status");
  assert.equal(status.receipt.skill.matches_cli, true);
  assert.equal(run(dir, "init").code, 1);
});

test("skip and independent installation preserve other files", () => {
  const dir = fixture();
  mkdirSync(path.join(dir, ".agents/skills/other"), { recursive: true });
  writeFileSync(path.join(dir, ".agents/skills/other/keep"), "keep");
  assert.equal(run(dir, "init", "--skip-skill").receipt.skill.status, "skipped");
  assert.equal(existsSync(path.join(dir, target)), false);
  const manifest = readFileSync(path.join(dir, ".pops/workspace.json"), "utf8");
  assert.equal(run(dir, "skill", "install").code, 0);
  assert.equal(readFileSync(path.join(dir, ".pops/workspace.json"), "utf8"), manifest);
  assert.equal(readFileSync(path.join(dir, ".agents/skills/other/keep"), "utf8"), "keep");
});

test("init conflict preserves initialized data and gives independent recovery", () => {
  const dir = fixture();
  mkdirSync(path.join(dir, target), { recursive: true });
  writeFileSync(path.join(dir, target, "SKILL.md"), "user content");
  const result = run(dir, "init");
  assert.equal(result.code, 1);
  assert.equal(result.receipt.workspace.initialized, true);
  assert.equal(result.receipt.skill.status, "conflict");
  assert.match(result.receipt.skill.recovery, /skill/);
  assert.equal(readFileSync(path.join(dir, target, "SKILL.md"), "utf8"), "user content");
  const state = run(dir, "skill", "status").receipt.skill;
  assert.equal(
    run(dir, "skill", "update", "--replace", "--expected-content", state.content_id).code,
    0,
  );
});

test("local modifications require explicit replacement of the inspected content", () => {
  const dir = fixture();
  run(dir, "init");
  const file = path.join(dir, target, "SKILL.md");
  writeFileSync(file, "local edit");
  assert.equal(run(dir, "skill", "update").code, 1);
  assert.equal(readFileSync(file, "utf8"), "local edit");
  const status = run(dir, "skill", "status").receipt.skill;
  assert.equal(status.matches_cli, false);
  writeFileSync(file, "new edit");
  assert.equal(
    run(dir, "skill", "update", "--replace", "--expected-content", status.content_id).code,
    1,
  );
  assert.equal(readFileSync(file, "utf8"), "new edit");
  const current = run(dir, "skill", "status").receipt.skill;
  const fixed = run(dir, "skill", "update", "--replace", "--expected-content", current.content_id);
  assert.equal(fixed.code, 0);
  assert.ok(fixed.receipt.skill.backups.length > 0);
});

test("outside symlink is diagnosed and retry after user correction succeeds", () => {
  const dir = fixture();
  const outside = fixture();
  symlinkSync(outside, path.join(dir, ".agents"));
  const first = run(dir, "init");
  assert.equal(first.code, 1);
  assert.equal(first.receipt.workspace.initialized, true);
  assert.equal(existsSync(path.join(outside, "skills")), false);
  assert.equal(run(dir, "skill", "install").code, 1);
  unlinkSync(path.join(dir, ".agents"));
  assert.equal(run(dir, "skill", "install").code, 0);
});

test("invalid init and skill options do not mutate a workspace", () => {
  const dir = fixture();
  assert.equal(run(dir, "init", "--unknown").code, 1);
  assert.equal(existsSync(path.join(dir, ".pops")), false);
  run(dir, "init", "--skip-skill");
  assert.equal(run(dir, "skill", "install", "--replace").code, 1);
  assert.equal(run(dir, "skill", "update", "--replace").code, 1);
  assert.equal(existsSync(path.join(dir, target)), false);
});
