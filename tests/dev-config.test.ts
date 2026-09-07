import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runAsyncCli, runCli } from "../src/app.js";
import { checkDevProject, inspectDevConfiguration } from "../src/application/devApi.js";
import { newWorkspaceManifest } from "../src/catalog/workspace.js";
import {
  createWorkspaceManifestFile,
  loadWorkspace,
  saveWorkspace,
} from "../src/catalog/workspaceStore.js";

const descriptor = () => ({
  host: "127.0.0.1",
  endpoints: { web: { port: 23451 }, api: { port: 23452 } },
  processes: {
    web: {
      command: ["npm", "run", "dev", "--", "--port", "${WEB_PORT}", "--strictPort"],
      cwd: ".",
      env: { URL: "${API_ORIGIN}" },
    },
    api: { command: ["node", "api.js"], cwd: "server", env: { PORT: "${API_PORT}" } },
  },
});
function fixture(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(path.join(tmpdir(), "pops-dev-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, "repo/server"), { recursive: true });
  const manifest = newWorkspaceManifest("test");
  manifest.projects.app = { path: "repo", dev: descriptor() };
  createWorkspaceManifestFile(root, manifest);
  return { root, manifest };
}
test("optional descriptor and resolved multi-process endpoints", (t) => {
  const { root, manifest } = fixture(t);
  const result = inspectDevConfiguration(root);
  assert.deepEqual(result.problems, []);
  assert.equal(result.projects[0]?.processes[0]?.command[5], "23451");
  assert.equal(result.projects[0]?.processes[0]?.env.URL, "http://127.0.0.1:23452");
  delete manifest.projects.app!.dev;
  saveWorkspace(root, manifest);
  assert.equal(loadWorkspace(root).manifest.projects.app?.dev, undefined);
  assert.deepEqual(inspectDevConfiguration(root).projects, []);
});
test("schema rejects malformed argv and unknown variables", (t) => {
  const { root, manifest } = fixture(t);
  for (const command of [[], [""], ["node", "${UNKNOWN}"], ["node", "$HOME"]]) {
    manifest.projects.app!.dev!.processes.web!.command = command;
    saveWorkspace(root, manifest);
    assert.throws(() => loadWorkspace(root), /dev|command|variable/);
  }
});
test("duplicates, port range and lexical cwd escape fail", (t) => {
  const { root, manifest } = fixture(t);
  manifest.projects.other = { path: "repo", dev: descriptor() };
  saveWorkspace(root, manifest);
  assert.match(
    inspectDevConfiguration(root)
      .problems.map((p) => p.issue)
      .join(" "),
    /duplicate/,
  );
  const stdout: string[] = [];
  assert.equal(
    runCli(
      ["project", "doctor", "--json"],
      { stdout: (s) => stdout.push(s), stderr: (s) => stdout.push(s) },
      root,
    ),
    1,
  );
  assert.match(stdout.join(" "), /duplicate dev port/);
  delete manifest.projects.other;
  manifest.projects.app!.dev!.endpoints.web!.port = 65536;
  saveWorkspace(root, manifest);
  assert.throws(() => loadWorkspace(root), /port/);
  manifest.projects.app!.dev = descriptor();
  manifest.projects.app!.dev!.processes.web!.cwd = "../";
  saveWorkspace(root, manifest);
  assert.throws(() => loadWorkspace(root), /cwd/);
});
test("static symlink cwd escape is rejected", (t) => {
  const { root, manifest } = fixture(t);
  symlinkSync(tmpdir(), path.join(root, "repo/outside"));
  manifest.projects.app!.dev!.processes.web!.cwd = "outside";
  saveWorkspace(root, manifest);
  assert.match(
    inspectDevConfiguration(root)
      .problems.map((p) => p.issue)
      .join(" "),
    /outside/,
  );
});
test("check distinguishes external occupied and manager-owned endpoints", async (t) => {
  const { root, manifest } = fixture(t);
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  manifest.projects.app!.dev!.endpoints = { web: { port: address.port } };
  manifest.projects.app!.dev!.processes = {
    web: { command: ["node", "app.js"], cwd: ".", env: {} },
  };
  saveWorkspace(root, manifest);
  assert.equal((await checkDevProject(root, "app")).ports[0]?.status, "external");
  assert.equal(
    (
      await checkDevProject(root, "app", [
        { project: "app", endpoint: "web", host: "127.0.0.1", port: address.port },
      ])
    ).ports[0]?.status,
    "managed",
  );
  const out: string[] = [];
  assert.equal(
    await runAsyncCli(
      ["dev", "check", "app", "--json"],
      { stdout: (s) => out.push(s), stderr: (s) => out.push(s) },
      root,
    ),
    1,
  );
  assert.equal(JSON.parse(out[0]!).ports[0].status, "external");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  const free = await checkDevProject(root, "app");
  assert.equal(free.ok, true);
  assert.equal(free.ports[0]?.status, "free");
});
test("ports CLI is read-only and rejects unsupported flags", async (t) => {
  const { root } = fixture(t);
  const out: string[] = [];
  const io = { stdout: (s: string) => out.push(s), stderr: (s: string) => out.push(s) };
  assert.equal(await runAsyncCli(["dev", "ports", "--json"], io, root), 0);
  assert.equal(JSON.parse(out[0]!).ports.length, 2);
  assert.equal(await runAsyncCli(["dev", "ports", "--all"], io, root), 1);
});

test("schema rejects a non-string host even when coercion matches loopback", (t) => {
  const { root, manifest } = fixture(t);
  Object.assign(manifest.projects.app!.dev!, { host: ["127.0.0.1"] });
  saveWorkspace(root, manifest);
  assert.throws(() => loadWorkspace(root), /dev host/);
});
