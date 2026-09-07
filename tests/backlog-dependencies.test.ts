import { execFileSync } from "node:child_process";
import {
  getBacklogDependencies,
  readTaskReference,
} from "../src/application/backlogDependencies.js";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  renameSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runCli } from "../src/app.js";

function fixture(t: test.TestContext) {
  const ws = mkdtempSync(path.join(tmpdir(), "pops-deps-"));
  t.after(() => rmSync(ws, { recursive: true, force: true }));
  const run = (args: string[]) => {
    const out: string[] = [],
      err: string[] = [];
    const code = runCli(
      [...args, "--json"],
      { stdout: (v) => out.push(v), stderr: (v) => err.push(v) },
      ws,
    );
    return { code, value: out.length ? JSON.parse(out[0]!) : null, error: err.join("\n") };
  };
  assert.equal(run(["init"]).code, 0);
  for (const project of ["ccp", "mochi", "write"]) {
    mkdirSync(path.join(ws, project));
    assert.equal(run(["project", "add", project]).code, 0);
    assert.equal(run(["backlog", "init", project]).code, 0);
  }
  const add = (project: string, deps?: string) =>
    run([
      "backlog",
      "add",
      project,
      "-T",
      "Task",
      "-c",
      "feature",
      "--priority",
      "P1",
      ...(deps === undefined ? [] : ["--depends-on", deps]),
    ]);
  const show = (project: string, id: string) => run(["backlog", "show", project, id]).value;
  const edit = (project: string, id: string, deps: string, rev = show(project, id).revision) =>
    run(["backlog", "update", project, id, "--depends-on", deps, "--expected-revision", rev]);
  const file = (project: string, id: string) =>
    path.join(ws, "ops", project, "backlog", "items", `${id}.md`);
  return { ws, run, add, show, edit, file };
}

test("cross-project chains, shared facilities and revision-protected replacement/removal", (t) => {
  const c = fixture(t);
  assert.equal(c.add("ccp").code, 0);
  const before = readFileSync(c.file("ccp", "CCP-001"), "utf8");
  assert.equal(c.add("mochi", "ccp:CCP-001").code, 0);
  assert.equal(c.add("write", "mochi:MOC-001,ccp:CCP-001").code, 0);
  assert.equal(c.add("write", "ccp:CCP-001").code, 0);
  const revision = c.show("write", "WRI-001").revision;
  assert.equal(c.edit("write", "WRI-001", "WRI-002").code, 0);
  assert.equal(c.edit("write", "WRI-001", "", revision).code, 1);
  assert.deepEqual(c.show("write", "WRI-001").depends_on, ["WRI-002"]);
  assert.equal(c.edit("write", "WRI-001", "").code, 0);
  assert.deepEqual(c.show("write", "WRI-001").depends_on, []);
  assert.equal(readFileSync(c.file("ccp", "CCP-001"), "utf8"), before);
});

test("invalid identities and reachable cross-project cycles fail without writes", (t) => {
  const c = fixture(t);
  c.add("ccp");
  assert.equal(c.add("mochi", "ccp:CCP-001").code, 0);
  assert.equal(c.add("write", "mochi:MOC-001").code, 0);
  const before = readFileSync(c.file("ccp", "CCP-001"), "utf8");
  for (const [refs, diagnostic] of [
    ["write:WRI-001", /cycl/i],
    ["CCP-001", /self/i],
    ["mochi:MOC-001,mochi:MOC-001", /duplicate/i],
    ["missing:NON-001", /missing/],
    ["mochi:MOC-999", /MOC-999/],
  ] as const) {
    const result = c.edit("ccp", "CCP-001", refs);
    assert.equal(result.code, 1);
    assert.match(result.error, diagnostic);
    assert.equal(readFileSync(c.file("ccp", "CCP-001"), "utf8"), before);
  }
  assert.equal(c.add("mochi", "MOC-001,mochi:MOC-001").code, 1);
  writeFileSync(c.file("mochi", "MOC-001"), "corrupt");
  const corrupt = c.edit("ccp", "CCP-001", "mochi:MOC-001");
  assert.equal(corrupt.code, 1);
  assert.match(corrupt.error, /mochi:MOC-001/);
  assert.equal(readFileSync(c.file("ccp", "CCP-001"), "utf8"), before);
});

test("HTTP creates tasks, resolves dependency identity and edits with revision", async (t) => {
  const c = fixture(t);
  c.add("ccp");
  const { startWorkbenchServer } = await import("../src/server/workbenchServer.js");
  const server = await startWorkbenchServer({ workspaceDir: c.ws, port: 0 });
  t.after(() => server.close());
  const call = async (url: string, method = "GET", body?: unknown) => {
    const response = await fetch(`${server.origin}${url}`, {
      method,
      headers: { origin: server.origin, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };
  const added = await call("/api/projects/mochi/backlog", "POST", {
    title: "Service",
    category: "feature",
    priority: "P1",
    depends_on: ["ccp:CCP-001"],
  });
  assert.equal(added.status, 200);
  const item = added.body.data.item;
  const query = await call(`/api/projects/mochi/backlog/${item.id}/dependencies`);
  assert.equal(query.status, 200);
  assert.equal(query.body.data.dependencies[0].reference.project, "ccp");
  assert.equal(query.body.data.dependencies[0].item.title, "Task");
  const changed = await call(`/api/projects/mochi/backlog/${item.id}`, "PATCH", {
    depends_on: [],
    expected_revision: item.revision,
  });
  assert.equal(changed.status, 200);
  assert.deepEqual(changed.body.data.result.depends_on, []);
  assert.equal(
    (
      await call(`/api/projects/mochi/backlog/${item.id}`, "PATCH", {
        depends_on: ["ccp:CCP-001"],
        expected_revision: item.revision,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await call(`/api/projects/mochi/backlog/${item.id}`, "PATCH", {
        depends_on: [1],
        expected_revision: changed.body.data.revision,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call("/api/projects/mochi/backlog", "POST", {
        title: "Bad",
        category: "feature",
        priority: "P1",
        workspaceDir: "/tmp",
      })
    ).status,
    400,
  );
});

test("reference reads diagnose damaged and misowned targets without scanning unrelated projects", (t) => {
  const c = fixture(t);
  c.add("ccp");
  c.add("mochi", "ccp:CCP-001");
  const target = c.file("ccp", "CCP-001");
  const valid = readFileSync(target, "utf8");
  writeFileSync(target, valid.replace("project: ccp", "project: mochi"));
  const mismatched = readTaskReference(c.ws, { project: "ccp", item: "CCP-001" });
  assert.equal(mismatched.ok, false);
  writeFileSync(target, "corrupt");
  const query = getBacklogDependencies({
    workspaceDir: c.ws,
    projectId: "mochi",
    itemId: "MOC-001",
  });
  assert.equal(query.ok, true);
  if (query.ok) {
    assert.equal(query.data.dependencies.length, 0);
    assert.match(query.data.diagnostics[0]!.message, /ccp:CCP-001/);
  }
  assert.equal(c.add("write").code, 0);
});

test("built CLI creates, edits and clears cross-project dependency references", (t) => {
  const c = fixture(t);
  c.add("ccp");
  const cli = path.resolve("dist/cli.js");
  const invoke = (args: string[]) =>
    JSON.parse(
      execFileSync(process.execPath, [cli, ...args, "--json"], { cwd: c.ws, encoding: "utf8" }),
    );
  const added = invoke([
    "backlog",
    "add",
    "mochi",
    "-T",
    "Built CLI",
    "-c",
    "feature",
    "--priority",
    "P1",
    "--depends-on",
    "ccp:CCP-001",
  ]);
  assert.deepEqual(added.item.depends_on, ["ccp:CCP-001"]);
  const edited = invoke([
    "backlog",
    "update",
    "mochi",
    added.item.id,
    "--depends-on",
    "",
    "--expected-revision",
    added.item.revision,
  ]);
  assert.deepEqual(edited.result.depends_on, []);
});

test("dependency targets outside their declared store are rejected before writes", (t) => {
  const c = fixture(t);
  c.add("ccp");
  const target = c.file("ccp", "CCP-001");
  const moved = path.join(c.ws, "outside.md");
  renameSync(target, moved);
  symlinkSync(moved, target);
  const result = c.add("mochi", "ccp:CCP-001");
  assert.equal(result.code, 1);
  assert.match(result.error, /ccp:CCP-001.*outside/);
  assert.equal(c.run(["backlog", "list", "mochi"]).value.items.length, 0);
});
