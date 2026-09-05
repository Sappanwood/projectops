import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCli } from "../src/app.js";
test("parallel run CLI lists current scope and rejects unknown actions in JSON", () => {
  const root = mkdtempSync(path.join(tmpdir(), "parallel-cli-"));
  const call = (args: string[]) => {
    let out = "";
    const exit = runCli(args, { stdout: (t) => (out += t), stderr: (t) => (out += t) }, root);
    return { exit, out };
  };
  assert.equal(call(["init"]).exit, 0);
  mkdirSync(path.join(root, "repo"));
  assert.equal(call(["project", "add", "repo"]).exit, 0);
  const listed = call(["parallel-run", "list", "repo", "--json"]);
  assert.equal(listed.exit, 0, listed.out);
  assert.deepEqual(JSON.parse(listed.out).data.runs, []);
  const bad = call(["parallel-run", "surprise", "repo", "--json"]);
  assert.equal(bad.exit, 1);
  assert.equal(JSON.parse(bad.out).ok, false);
});
