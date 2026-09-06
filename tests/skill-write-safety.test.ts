import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const cli = path.resolve("dist/cli.js");
const relative = ".agents/skills/projectops-workflow";
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "pops-skill-safety-"));
  const run = (args: string[], preload?: string) => {
    const result = spawnSync(
      process.execPath,
      [...(preload ? ["--import", preload] : []), cli, ...args, "--json"],
      { cwd: root, encoding: "utf8" },
    );
    return { code: result.status, receipt: JSON.parse(result.stdout) };
  };
  run(["init"]);
  return { root, run, target: path.join(root, relative) };
}

test("partial write failure keeps data and can be recovered with a reviewed content token", () => {
  const { root, run, target } = fixture();
  const skill = path.join(target, "SKILL.md");
  writeFileSync(skill, "user edits");
  writeFileSync(path.join(target, "references/runs.md"), "other edits");
  const token = run(["skill", "status"]).receipt.skill.content_id;
  const injector = path.join(root, "fault.mjs");
  writeFileSync(
    injector,
    `import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module';
const write = fs.writeFileSync;
fs.writeFileSync = function(file, ...args) { if (String(file).endsWith('/SKILL.md')) throw Error('Injected write failure'); return write(file, ...args); };
syncBuiltinESMExports();`,
  );
  const failed = run(["skill", "update", "--replace", "--expected-content", token], injector);
  assert.equal(failed.code, 1);
  assert.equal(failed.receipt.skill.status, "failed");
  assert.ok(failed.receipt.skill.changed.length > 0);
  assert.ok(failed.receipt.skill.backups.length > 0);
  assert.equal(run(["project", "doctor"]).code, 0);
  const status = run(["skill", "status"]).receipt.skill;
  assert.equal(status.matches_cli, false);
  assert.equal(run(["skill", "update"]).code, 1);
  assert.equal(
    run(["skill", "update", "--replace", "--expected-content", status.content_id]).code,
    0,
  );
  assert.equal(run(["skill", "status"]).receipt.skill.matches_cli, true);
  assert.ok(
    failed.receipt.skill.backups.some(
      (file: string) => readFileSync(path.join(root, file), "utf8") === "other edits",
    ),
  );
});

for (const timing of ["before-move", "after-move"] as const) {
  test(`normal concurrent editor is preserved (${timing})`, () => {
    const { root, run, target } = fixture();
    const skill = path.join(target, "SKILL.md");
    writeFileSync(skill, "reviewed edit");
    const token = run(["skill", "status"]).receipt.skill.content_id;
    const injector = path.join(root, "race.mjs");
    writeFileSync(
      injector,
      `import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module';
const move = fs.renameSync;
fs.renameSync = function(from, to) {
  const selected = String(from).endsWith('/SKILL.md');
  if (selected && ${JSON.stringify(timing)} === 'before-move') fs.writeFileSync(from, 'concurrent edit');
  move(from, to);
  if (selected && ${JSON.stringify(timing)} === 'after-move') fs.writeFileSync(from, 'concurrent edit', {flag:'wx'});
}; syncBuiltinESMExports();`,
    );
    const result = run(["skill", "update", "--replace", "--expected-content", token], injector);
    assert.equal(result.code, 1);
    assert.equal(readFileSync(skill, "utf8"), "concurrent edit");
    assert.ok(result.receipt.skill.backups.length > 0);
  });
}

test("another installer lock is reported without changing installed files", () => {
  const { root, run, target } = fixture();
  const before = readFileSync(path.join(target, "SKILL.md"), "utf8");
  mkdirSync(path.join(root, ".agents/skills/.projectops-workflow.lock"));
  const result = run(["skill", "update"]);
  assert.equal(result.code, 1);
  assert.match(result.receipt.skill.problems[0], /lock/);
  assert.equal(readFileSync(path.join(target, "SKILL.md"), "utf8"), before);
  assert.equal(readdirSync(path.join(root, ".agents/skills/.projectops-workflow.lock")).length, 0);
});
