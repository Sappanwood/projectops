import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { runCli } from "../src/app.js";
import { startWorkbenchServer } from "../src/server/workbenchServer.js";

test("Research HTTP lists and reads Markdown under the manifest research root", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "pops-research-reader-"));
  let server;
  try {
    const io = {
      stdout() {},
      stderr(message: string) {
        throw new Error(message);
      },
    };
    assert.equal(runCli(["init"], io, root), 0);
    mkdirSync(path.join(root, "alpha"), { recursive: true });
    assert.equal(runCli(["project", "add", "alpha"], io, root), 0);
    mkdirSync(path.join(root, "ops/alpha/research/topic"), { recursive: true });
    const body = "# Research\n\nFindings.";
    writeFileSync(path.join(root, "ops/alpha/research/topic/findings.md"), body);
    writeFileSync(path.join(root, "ops/alpha/research/notes.txt"), "not listed");
    server = await startWorkbenchServer({ workspaceDir: root, port: 0 });

    const base = `${server.origin}/api/projects/alpha/research`;
    const list = await fetch(base);
    assert.equal(list.status, 200);
    const listed = (await list.json()).data;
    assert.deepEqual(listed.documents, [
      { path: "topic/findings.md", standard: false, issue: null },
    ]);
    const shown = await fetch(`${base}?path=${encodeURIComponent("topic/findings.md")}`);
    assert.equal(shown.status, 200);
    assert.deepEqual((await shown.json()).data, { path: "topic/findings.md", body });
    assert.equal(
      readFileSync(path.join(root, "ops/alpha/research/topic/findings.md"), "utf8"),
      body,
    );
    for (const target of ["../reports/secret.md", "notes.txt", "topic/../secret.md"]) {
      const response = await fetch(`${base}?path=${encodeURIComponent(target)}`);
      assert.ok(response.status >= 400, target);
    }
    assert.equal((await fetch(`${base}?path=missing.md`)).status, 404);
  } finally {
    await server?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("Research reports a broken manifest descriptor instead of showing an empty list", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "pops-research-invalid-"));
  let server;
  try {
    const io = {
      stdout() {},
      stderr(message: string) {
        throw new Error(message);
      },
    };
    assert.equal(runCli(["init"], io, root), 0);
    mkdirSync(path.join(root, "alpha"), { recursive: true });
    assert.equal(runCli(["project", "add", "alpha"], io, root), 0);
    const manifestPath = path.join(root, ".pops/workspace.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.artifact_layout.roots.research = "markdown/wrong@1";
    writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
    server = await startWorkbenchServer({ workspaceDir: root, port: 0 });
    const response = await fetch(`${server.origin}/api/projects/alpha/research`);
    assert.equal(response.status, 422);
    assert.match((await response.json()).error.message, /research artifact type/i);
  } finally {
    await server?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("Research honors a custom layout and rejects linked targets and unavailable roots", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "pops-research-boundary-"));
  const outside = mkdtempSync(path.join(tmpdir(), "pops-research-outside-"));
  let server;
  try {
    const io = {
      stdout() {},
      stderr(message: string) {
        throw new Error(message);
      },
    };
    assert.equal(runCli(["init"], io, root), 0);
    const manifestPath = path.join(root, ".pops/workspace.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.artifact_layout.ops_root = "custom-ops";
    writeFileSync(manifestPath, JSON.stringify(manifest));
    mkdirSync(path.join(root, "alpha"));
    assert.equal(runCli(["project", "add", "alpha"], io, root), 0);
    const research = path.join(root, "custom-ops/alpha/research");
    writeFileSync(path.join(research, "valid.md"), "# Actual manifest root");
    writeFileSync(path.join(outside, "secret.md"), "Private content");
    symlinkSync(path.join(outside, "secret.md"), path.join(research, "linked.md"));
    symlinkSync(outside, path.join(research, "linked-dir"));
    server = await startWorkbenchServer({ workspaceDir: root, port: 0 });
    const base = `${server.origin}/api/projects/alpha/research`;
    const listed = await (await fetch(base)).json();
    assert.deepEqual(
      listed.data.documents.map((d: { path: string }) => d.path),
      ["valid.md"],
    );
    assert.ok(listed.data.diagnostics.some((d: { path: string }) => d.path === "linked.md"));
    for (const name of ["linked.md", "linked-dir/secret.md"]) {
      const response = await fetch(`${base}?path=${encodeURIComponent(name)}`);
      assert.equal(response.status, 422);
      assert.doesNotMatch(await response.text(), /Private content/);
    }
    assert.equal((await fetch(`${base}?unexpected=1`)).status, 400);
    assert.equal((await fetch(`${base}?path=valid.md&path=other.md`)).status, 400);
    assert.equal((await fetch(base, { method: "POST" })).status, 405);
    rmSync(research, { recursive: true });
    assert.equal((await fetch(base)).status, 422);
    symlinkSync(outside, research);
    assert.equal((await fetch(base)).status, 422);
    assert.equal(readFileSync(path.join(outside, "secret.md"), "utf8"), "Private content");
  } finally {
    await server?.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
