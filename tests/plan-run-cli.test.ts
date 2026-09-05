import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCli } from "../src/app.js";

test("Plan run CLI lists an initialized empty project and rejects malformed mutations", () => {
  const root = mkdtempSync(path.join(tmpdir(), "run-cli-"));
  const call = (args: string[]) => {
    let text = "";
    const exit = runCli(args, { stdout: (s) => (text += s), stderr: (s) => (text += s) }, root);
    return { exit, text };
  };
  assert.equal(call(["init"]).exit, 0);
  mkdirSync(path.join(root, "repo"));
  assert.equal(call(["project", "add", "repo"]).exit, 0);
  const result = call(["plan-run", "list", "repo", "--json"]);
  assert.equal(result.exit, 0, result.text);
  assert.deepEqual(JSON.parse(result.text).data.runs, []);
  const failed = call(["plan-run", "pause", "repo", "run-invalid", "--json"]);
  assert.equal(failed.exit, 1);
  assert.equal(JSON.parse(failed.text).ok, false);
});
