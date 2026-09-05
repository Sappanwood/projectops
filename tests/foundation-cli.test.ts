import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("built execution CLI records external work, rejects stale input and requires evidence before acceptance", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "pops-execution-cli-"));
  const cliPath = path.resolve("dist/cli.js");
  const call = (args: string[], expected = 0) => {
    const p = spawnSync(process.execPath, [cliPath, ...args, "--json"], {
      cwd: workspace,
      encoding: "utf8",
    });
    assert.equal(p.status, expected, `${p.stdout}\n${p.stderr}`);
    return JSON.parse(p.stdout);
  };
  try {
    call(["init"]);
    const repo = path.join(workspace, "repo");
    mkdirSync(repo);
    execFileSync("git", ["init", "-q"], { cwd: repo });
    writeFileSync(path.join(repo, "work.txt"), "fixture work");
    call(["project", "add", "repo"]);
    call(["backlog", "init", "repo"]);
    const { item } = call([
      "backlog",
      "add",
      "repo",
      "-T",
      "CLI work",
      "-c",
      "feature",
      "--priority",
      "P1",
    ]);
    const stale = call(["execution", "create", "repo", item.id, "--expected-revision", "stale"], 1);
    assert.equal(stale.error.code, "REVISION_MISMATCH");
    let a = call([
      "execution",
      "create",
      "repo",
      item.id,
      "--expected-revision",
      item.revision,
      "--instructions",
      "Explicit fixture input",
    ]).data.attempt;
    assert.equal(a.input.instructions, "Explicit fixture input");
    assert.equal(call(["execution", "list", "repo", "--item", item.id]).data.attempts.length, 1);
    a = call([
      "execution",
      "finish",
      "repo",
      a.id,
      "--expected-revision",
      a.revision,
      "--outcome",
      "succeeded",
      "--summary",
      "Fixture finished",
    ]).data.attempt;
    assert.equal(
      call(
        [
          "execution",
          "accept",
          "repo",
          a.id,
          "--expected-revision",
          a.revision,
          "--note",
          "No evidence",
        ],
        1,
      ).ok,
      false,
    );
    writeFileSync(path.join(workspace, "evidence.txt"), "Fixture assertions passed.");
    a = call([
      "execution",
      "verify",
      "repo",
      a.id,
      "--expected-revision",
      a.revision,
      "--command",
      "fixture check",
      "--outcome",
      "passed",
      "--evidence-file",
      "evidence.txt",
    ]).data.attempt;
    a = call([
      "execution",
      "accept",
      "repo",
      a.id,
      "--expected-revision",
      a.revision,
      "--note",
      "Fixture accepted",
    ]).data.attempt;
    assert.equal(a.acceptance.decision, "accepted");
    assert.equal(call(["backlog", "show", "repo", item.id]).status, "done");
    assert.equal(call(["execution", "show", "repo", a.id]).data.attempt.input.item.status, "todo");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
