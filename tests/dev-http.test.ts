import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { newWorkspaceManifest } from "../src/catalog/workspace.js";
import { createWorkspaceManifestFile } from "../src/catalog/workspaceStore.js";
import { startWorkbenchServer } from "../src/server/workbenchServer.js";
const exec = promisify(execFile);
const cli = path.resolve("dist/cli.js");
test("dev HTTP is fixed-workspace, query-only until start, interoperates with CLI and survives Workbench close", {
  timeout: 30000,
}, async (t) => {
  const root = mkdtempSync("/tmp/p055-http-");
  mkdirSync(root + "/repo");
  const manifest = newWorkspaceManifest("dev http");
  manifest.projects.empty = { path: "repo" };
  createWorkspaceManifestFile(root, manifest);
  let server = await startWorkbenchServer({ workspaceDir: root, port: 0 });
  const port = server.port;
  await server.close();
  manifest.projects.app = {
    path: "repo",
    dev: {
      host: "127.0.0.1",
      endpoints: { web: { port } },
      processes: {
        web: {
          command: [
            process.execPath,
            "-e",
            'require("http").createServer((q,s)=>s.end("ok")).listen(Number(process.argv[1]),"127.0.0.1")',
            String(port),
          ],
          cwd: ".",
          env: {},
        },
      },
    },
  };
  writeFileSync(root + "/.pops/workspace.json", JSON.stringify(manifest));
  server = await startWorkbenchServer({ workspaceDir: root, port: 0 });
  const command = async (...args: string[]) =>
    JSON.parse(
      (await exec(process.execPath, [cli, "dev", ...args, "--json"], { cwd: root })).stdout,
    );
  t.after(async () => {
    await server.close();
    await command("manager", "stop").catch(() => {});
    rmSync(root, { recursive: true, force: true });
  });
  const query = async (id = "app") => fetch(server.origin + "/api/projects/" + id + "/dev");
  const post = async (body: unknown, origin = server.origin, id = "app") =>
    fetch(server.origin + "/api/projects/" + id + "/dev", {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify(body),
    });
  assert.equal((await query()).status, 200);
  assert.equal((await (await query()).json()).data.status.manager, "stopped");
  assert.equal(existsSync(root + "/.pops/runtime"), false);
  assert.equal((await (await query("empty")).json()).data.configured, false);
  assert.equal((await post({ action: "start", workspace: "/tmp" })).status, 400);
  assert.equal((await post({ action: "manager-stop" })).status, 400);
  assert.equal((await post({ action: "start" }, "http://evil.test")).status, 403);
  assert.equal((await command("start", "app")).state, "running");
  const first = (await (await query()).json()).data.status;
  assert.equal(first.state, "running");
  const restarted = (await (await post({ action: "restart" })).json()).data.status;
  assert.equal(restarted.state, "running");
  assert.notEqual(restarted.instance, first.instance);
  await server.close();
  assert.equal(await (await fetch("http://127.0.0.1:" + port)).text(), "ok");
  server = await startWorkbenchServer({ workspaceDir: root, port: 0 });
  assert.equal((await (await query()).json()).data.status.state, "running");
  assert.equal((await (await post({ action: "stop" })).json()).data.status.state, "stopped");
  assert.equal((await command("status", "app")).state, "stopped");
  manifest.projects.self = {
    path: "repo",
    dev: { ...manifest.projects.app.dev!, endpoints: { web: { port: server.port } } },
  };
  writeFileSync(root + "/.pops/workspace.json", JSON.stringify(manifest));
  assert.equal((await (await query("self")).json()).data.hosts_workbench, true);
  assert.equal((await post({ action: "stop" }, server.origin, "self")).status, 400);
  assert.equal((await post({ action: "restart" }, server.origin, "self")).status, 400);
});
