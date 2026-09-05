import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runCli } from "../src/app.js";
import {
  createExecution,
  finishExecution,
  verifyExecution,
} from "../src/application/executionApi.js";
import { getExecutionEvidence } from "../src/application/executionEvidence.js";
import { startWorkbenchServer } from "../src/server/workbenchServer.js";

test("evidence reader binds exact attempt reference, verifies digest and rejects missing or escaping evidence", async () => {
  const workspaceDir = mkdtempSync(path.join(tmpdir(), "pops-evidence-"));
  const cli = (...args: string[]) => {
    const output: string[] = [];
    assert.equal(
      runCli(args, { stdout: (s) => output.push(s), stderr: (s) => output.push(s) }, workspaceDir),
      0,
      output.join(""),
    );
    return JSON.parse(output.join(""));
  };
  cli("init", "--json");
  mkdirSync(path.join(workspaceDir, "repo"));
  cli("project", "add", "repo", "--json");
  cli("backlog", "init", "repo", "--json");
  execFileSync("git", ["init", "-q"], { cwd: path.join(workspaceDir, "repo") });
  const query = { workspaceDir, projectId: "repo" };
  const verified = (title: string, evidence: string) => {
    const { item } = cli(
      "backlog",
      "add",
      "repo",
      "-T",
      title,
      "-c",
      "feature",
      "--priority",
      "P1",
      "-b",
      "Implement",
      "--json",
    );
    const created = createExecution({ ...query, itemId: item.id });
    assert.ok(created.ok);
    const ended = finishExecution({
      ...query,
      attemptId: created.data.attempt.id,
      expectedRevision: created.data.attempt.revision,
      outcome: "succeeded",
      summary: "Complete",
    });
    assert.ok(ended.ok);
    const result = verifyExecution({
      ...query,
      attemptId: ended.data.attempt.id,
      expectedRevision: ended.data.attempt.revision,
      command: "npm test",
      outcome: "passed",
      evidence,
    });
    assert.ok(result.ok);
    return result.data.attempt;
  };
  const body = "Actual verification output <script>unsafe</script>\nAssertions: 7 passed";
  const first = verified("First", body),
    second = verified("Second", "x".repeat(70000));
  const ref = first.verifications[0]!.evidence_ref;
  const input = { ...query, attemptId: first.id, ref };
  const server = await startWorkbenchServer({ workspaceDir, port: 0 });
  const url = `${server.origin}/api/projects/repo/executions/${first.id}/evidence`;
  try {
    const result = getExecutionEvidence(input);
    assert.ok(result.ok);
    assert.equal(result.data.body, body);
    assert.equal(result.data.truncated, false);
    const large = getExecutionEvidence({
      ...query,
      attemptId: second.id,
      ref: second.verifications[0]!.evidence_ref,
    });
    assert.ok(large.ok);
    assert.equal(large.data.body.length, 65536);
    assert.equal(large.data.truncated, true);
    const shown = await fetch(`${url}?ref=${encodeURIComponent(ref)}`);
    assert.equal(shown.status, 200);
    assert.equal((await shown.json()).data.body, body);
    assert.equal((await fetch(url)).status, 400);
    assert.equal((await fetch(`${url}?ref=${encodeURIComponent(ref)}&extra=yes`)).status, 400);
    assert.equal(
      getExecutionEvidence({ ...input, ref: second.verifications[0]!.evidence_ref }).ok,
      false,
    );
    assert.equal(
      (await fetch(`${url}?ref=${encodeURIComponent(second.verifications[0]!.evidence_ref)}`))
        .status,
      400,
    );
    assert.equal(getExecutionEvidence({ ...input, ref: "../workspace.json" }).ok, false);
    const target = path.join(workspaceDir, "ops/repo/executions", ref);
    writeFileSync(target, "Altered output");
    assert.equal(getExecutionEvidence(input).ok, false);
    assert.equal((await fetch(`${url}?ref=${encodeURIComponent(ref)}`)).status, 400);
    rmSync(target);
    assert.equal(getExecutionEvidence(input).ok, false);
    const outside = path.join(workspaceDir, "outside.txt");
    writeFileSync(outside, body);
    symlinkSync(outside, target);
    assert.equal(getExecutionEvidence(input).ok, false);
  } finally {
    await server.close();
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});
