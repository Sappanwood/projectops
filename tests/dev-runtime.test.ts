import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import test from "node:test";
import { newWorkspaceManifest } from "../src/catalog/workspace.js";
import { createWorkspaceManifestFile } from "../src/catalog/workspaceStore.js";

const cli = path.resolve("dist/cli.js");
async function command(root: string, ...args: string[]) {
  return new Promise<{ code: number | null; result: any }>((resolve, reject) => {
    const child = spawn(process.execPath, [cli, "dev", ...args, "--json"], { cwd: root });
    let output = "";
    let error = "";
    child.stdout.on("data", (v) => {
      output += v;
    });
    child.stderr.on("data", (v) => {
      error += v;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      try {
        resolve({ code, result: JSON.parse(output) });
      } catch {
        reject(new Error(`CLI ${args}: ${code} ${output} ${error}`));
      }
    });
  });
}
async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function rebootFixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = mkdtempSync("/tmp/pdev-reboot-");
  mkdirSync(path.join(root, "repo"));
  const port = await freePort();
  const manifest = newWorkspaceManifest("test");
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
  createWorkspaceManifestFile(root, manifest);
  const dir = path.join(root, ".pops/runtime/dev");
  mkdirSync(dir, { recursive: true });
  const boot = "00000000-0000-4000-8000-000000000000";
  const lock = { workspace: root, instance: "old-instance", version: 1, boot_id: boot };
  const ledger = {
    workspace: root,
    instance: lock.instance,
    boot_id: boot,
    pid: process.pid,
    projects: { app: { state: "running", endpoints: [], processes: [] } },
  };
  writeFileSync(path.join(dir, "lock.json"), JSON.stringify(lock));
  writeFileSync(path.join(dir, "ledger.json"), JSON.stringify(ledger));
  writeFileSync(path.join(dir, "ledger.next"), "interrupted write");
  writeFileSync(path.join(dir, "keep.txt"), "unrelated");
  t.after(async () => {
    await command(root, "manager", "stop").catch(() => {});
    rmSync(root, { recursive: true, force: true });
  });
  return { root, dir, port, boot, lock, ledger };
}

test("previous boot recovery is explicit, concurrent and preserves unrelated files", {
  timeout: 20000,
}, async (t) => {
  const f = await rebootFixture(t);
  const socketOwner = spawn(process.execPath, [
    "-e",
    'require("net").createServer().listen(process.argv[1],()=>console.log("ready"))',
    path.join(f.dir, "socket"),
  ]);
  t.after(() => {
    socketOwner.kill("SIGKILL");
  });
  await once(socketOwner.stdout, "data");
  const exited = once(socketOwner, "exit");
  socketOwner.kill("SIGKILL");
  await exited;
  assert.equal(existsSync(path.join(f.dir, "socket")), true);
  for (const action of ["status", "stop"])
    assert.equal((await command(f.root, action, "app")).result.state, "unknown");
  assert.equal(readFileSync(path.join(f.dir, "lock.json"), "utf8"), JSON.stringify(f.lock));
  const results = await Promise.all(
    Array.from({ length: 4 }, () => command(f.root, "start", "app")),
  );
  for (const r of results) {
    assert.equal(r.code, 0, JSON.stringify(r.result));
    assert.equal(r.result.state, "running");
    assert.equal(r.result.instance, results[0]!.result.instance);
  }
  assert.equal(results.filter((r) => r.result.recovered_from_boot === f.boot).length, 1);
  const currentBoot = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  for (const file of ["lock.json", "ledger.json"])
    assert.equal(JSON.parse(readFileSync(path.join(f.dir, file), "utf8")).boot_id, currentBoot);
  assert.equal(existsSync(path.join(f.dir, "ledger.next")), false);
  assert.equal(readFileSync(path.join(f.dir, "keep.txt"), "utf8"), "unrelated");
  assert.equal(await (await fetch(`http://127.0.0.1:${f.port}`)).text(), "ok");
});

test("previous boot recovery also handles ledger-only residue and restart", async (t) => {
  const f = await rebootFixture(t);
  rmSync(path.join(f.dir, "lock.json"));
  const result = await command(f.root, "restart", "app");
  assert.equal(result.code, 0, JSON.stringify(result.result));
  assert.equal(result.result.recovered_from_boot, f.boot);
  assert.equal(result.result.state, "running");
});

test("previous boot recovery handles lock-only interrupted bootstrap", async (t) => {
  const f = await rebootFixture(t);
  rmSync(path.join(f.dir, "ledger.json"));
  const result = await command(f.root, "start", "app");
  assert.equal(result.code, 0, JSON.stringify(result.result));
  assert.equal(result.result.recovered_from_boot, f.boot);
  assert.equal(result.result.state, "running");
});

test("recovery leaves an external port owner alive and reports startup failure", async (t) => {
  const f = await rebootFixture(t);
  const external = createServer();
  await new Promise<void>((resolve) => external.listen(f.port, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => external.close(() => resolve())));
  const result = await command(f.root, "start", "app");
  assert.equal(result.code, 1);
  assert.equal(result.result.state, "failed");
  assert.equal(result.result.recovered_from_boot, f.boot);
  assert.equal(external.listening, true);
  assert.match(result.result.issue, /externally occupied/);
});

test("recovery refuses corrupt records and static runtime symlinks", async (t) => {
  const { symlinkSync } = await import("node:fs");
  const f = await rebootFixture(t);
  writeFileSync(path.join(f.dir, "ledger.json"), "{");
  assert.equal((await command(f.root, "start", "app")).code, 1);
  assert.equal(readFileSync(path.join(f.dir, "ledger.json"), "utf8"), "{");
  assert.equal(readFileSync(path.join(f.dir, "lock.json"), "utf8"), JSON.stringify(f.lock));
  writeFileSync(path.join(f.dir, "ledger.json"), JSON.stringify(f.ledger));
  rmSync(path.join(f.dir, "ledger.next"));
  symlinkSync(path.join(f.dir, "keep.txt"), path.join(f.dir, "ledger.next"));
  const result = await command(f.root, "start", "app");
  assert.equal(result.code, 1);
  assert.match(result.result.error.message, /Unsafe dev runtime symlink/);
  assert.equal(readFileSync(path.join(f.dir, "keep.txt"), "utf8"), "unrelated");
  assert.equal(readFileSync(path.join(f.dir, "lock.json"), "utf8"), JSON.stringify(f.lock));
});

for (const scenario of [
  "legacy",
  "same-boot",
  "mixed-boot",
  "wrong-workspace",
  "invalid-boot",
] as const) {
  test(`reboot recovery refuses ${scenario} evidence without changing files`, async (t) => {
    const f = await rebootFixture(t);
    const currentBoot = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
    if (scenario === "legacy") {
      Reflect.deleteProperty(f.lock, "boot_id");
      Reflect.deleteProperty(f.ledger, "boot_id");
    } else if (scenario === "same-boot") f.lock.boot_id = f.ledger.boot_id = currentBoot;
    else if (scenario === "mixed-boot") f.ledger.boot_id = currentBoot;
    else if (scenario === "wrong-workspace") f.lock.workspace = "/tmp/another-workspace";
    else f.lock.boot_id = f.ledger.boot_id = "invalid";
    writeFileSync(path.join(f.dir, "lock.json"), JSON.stringify(f.lock));
    writeFileSync(path.join(f.dir, "ledger.json"), JSON.stringify(f.ledger));
    const result = await command(f.root, "start", "app");
    assert.equal(result.code, 1);
    assert.equal(result.result.state, "unknown");
    assert.equal(readFileSync(path.join(f.dir, "lock.json"), "utf8"), JSON.stringify(f.lock));
    assert.equal(readFileSync(path.join(f.dir, "ledger.json"), "utf8"), JSON.stringify(f.ledger));
    assert.equal(readFileSync(path.join(f.dir, "ledger.next"), "utf8"), "interrupted write");
  });
}
test("independent built CLI owns two processes after CLI exit, restart and isolated stop", {
  timeout: 40000,
}, async (t) => {
  const root = mkdtempSync("/tmp/pdev-");
  mkdirSync(path.join(root, "repo"));
  writeFileSync(
    path.join(root, "repo/server.cjs"),
    'require("http").createServer((q,s)=>s.end("ok")).listen(Number(process.argv[2]),"127.0.0.1")',
  );
  const manifest = newWorkspaceManifest("test");
  const ports = await Promise.all([freePort(), freePort(), freePort()]);
  for (const [id, values] of [
    ["app", ports.slice(0, 2)],
    ["other", ports.slice(2)],
  ] as const) {
    manifest.projects[id] = {
      path: "repo",
      dev: {
        host: "127.0.0.1",
        endpoints: Object.fromEntries(values.map((port, i) => [`p${i}`, { port }])),
        processes: Object.fromEntries(
          values.map((port, i) => [
            `p${i}`,
            { command: [process.execPath, "server.cjs", String(port)], cwd: ".", env: {} },
          ]),
        ),
      },
    };
  }
  createWorkspaceManifestFile(root, manifest);
  t.after(async () => {
    await command(root, "manager", "stop").catch(() => {});
    rmSync(root, { recursive: true, force: true });
  });
  assert.equal((await command(root, "status", "app")).result.state, "stopped");
  const concurrent = await Promise.all([
    command(root, "start", "app"),
    command(root, "start", "app"),
  ]);
  for (const value of concurrent) {
    assert.equal(value.code, 0);
    assert.equal(value.result.state, "running");
  }
  const first = (await command(root, "status", "app")).result;
  assert.equal(first.processes.length, 2);
  assert.equal((await command(root, "check", "app")).result.ports[0].status, "managed");
  assert.equal(await (await fetch(`http://127.0.0.1:${ports[0]}`)).text(), "ok");
  assert.equal((await command(root, "start", "other")).result.state, "running");
  const restarted = (await command(root, "restart", "app")).result;
  assert.equal(restarted.state, "running");
  assert.notEqual(restarted.instance, first.instance);
  assert.equal((await command(root, "stop", "app")).result.state, "stopped");
  assert.equal((await command(root, "status", "other")).result.state, "running");
  const failing = (await command(root, "start", "app")).result;
  process.kill(failing.processes[0].pid, "SIGTERM");
  let failed;
  for (let i = 0; i < 60; i++) {
    failed = (await command(root, "status", "app")).result;
    if (failed.state === "failed") break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(failed.state, "failed");
  assert.match(failed.issue, /exited/);
  assert.ok(
    (await command(root, "check", "app")).result.ports.every((p: any) => p.status === "free"),
  );
  assert.equal((await command(root, "status", "other")).result.state, "running");
  assert.equal(await (await fetch(`http://127.0.0.1:${ports[2]}`)).text(), "ok");
  assert.equal((await command(root, "manager", "stop")).code, 0);
  assert.equal((await command(root, "status", "other")).result.state, "stopped");
});

test("rollback, timeout, external listener and natural leader exit clean only owned groups", {
  timeout: 40000,
}, async (t) => {
  const root = mkdtempSync("/tmp/pdev-");
  mkdirSync(path.join(root, "repo"));
  const ports = await Promise.all([freePort(), freePort(), freePort()]);
  const manifest = newWorkspaceManifest("test");
  const endpoint = { web: { port: ports[0]! } };
  const serverCode =
    'require("http").createServer((q,s)=>s.end("ok")).listen(Number(process.argv[1]),"127.0.0.1")';
  const processSpec = (command: string[]) => ({ command, cwd: ".", env: {} });
  manifest.projects.rollback = {
    path: "repo",
    dev: {
      host: "127.0.0.1",
      endpoints: endpoint,
      processes: {
        web: processSpec([process.execPath, "-e", serverCode, String(ports[0])]),
        bad: processSpec(["/nonexistent/pops-fixture"]),
      },
    },
  };
  manifest.projects.timeout = {
    path: "repo",
    dev: {
      host: "127.0.0.1",
      endpoints: { web: { port: ports[1]! } },
      processes: { sleeper: processSpec([process.execPath, "-e", "setInterval(()=>{},1000)"]) },
    },
  };
  manifest.projects.external = {
    path: "repo",
    dev: {
      host: "127.0.0.1",
      endpoints: { web: { port: ports[2]! } },
      processes: { sleeper: processSpec([process.execPath, "-e", "setInterval(()=>{},1000)"]) },
    },
  };
  createWorkspaceManifestFile(root, manifest);
  const external = createServer();
  await new Promise<void>((resolve, reject) => {
    external.on("error", reject);
    external.listen(ports[2], "127.0.0.1", resolve);
  });
  t.after(async () => {
    await command(root, "manager", "stop").catch(() => {});
    external.close();
    rmSync(root, { recursive: true, force: true });
  });
  assert.equal((await command(root, "start", "external")).result.state, "failed");
  assert.equal(external.listening, true);
  assert.equal((await command(root, "start", "rollback")).result.state, "failed");
  assert.equal((await command(root, "check", "rollback")).result.ports[0].status, "free");
  assert.equal((await command(root, "start", "timeout")).result.state, "failed");
  assert.equal((await command(root, "status", "timeout")).result.processes[0].state, "stopped");
  assert.equal(external.listening, true);
});

test("leader exits before TERM-resistant descendant; group cleanup and failed diagnostics", {
  timeout: 20000,
}, async (t) => {
  const root = mkdtempSync("/tmp/pdev-");
  mkdirSync(path.join(root, "repo"));
  const port = await freePort();
  writeFileSync(
    path.join(root, "repo/child.cjs"),
    'process.on("SIGTERM",()=>{});require("http").createServer((q,s)=>s.end("ok")).listen(Number(process.argv[2]),"127.0.0.1")',
  );
  writeFileSync(
    path.join(root, "repo/leader.cjs"),
    'require("child_process").spawn(process.execPath,["child.cjs",process.argv[2]],{stdio:"inherit"});setTimeout(()=>process.exit(3),700)',
  );
  const manifest = newWorkspaceManifest("test");
  manifest.projects.app = {
    path: "repo",
    dev: {
      host: "127.0.0.1",
      endpoints: { web: { port } },
      processes: {
        web: { command: [process.execPath, "leader.cjs", String(port)], cwd: ".", env: {} },
      },
    },
  };
  createWorkspaceManifestFile(root, manifest);
  t.after(async () => {
    await command(root, "manager", "stop").catch(() => {});
    rmSync(root, { recursive: true, force: true });
  });
  assert.equal((await command(root, "start", "app")).result.state, "running");
  let status;
  for (let i = 0; i < 60; i++) {
    status = (await command(root, "status", "app")).result;
    if (status.state === "failed") break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(status.state, "failed");
  assert.match(status.issue, /exited/);
  assert.equal((await command(root, "check", "app")).result.ports[0].status, "free");
});

test("manager SIGTERM stops services; abnormal loss retains unknown without PID-based takeover", {
  timeout: 20000,
}, async (t) => {
  const root = mkdtempSync("/tmp/pdev-");
  mkdirSync(path.join(root, "repo"));
  const port = await freePort();
  const manifest = newWorkspaceManifest("test");
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
  createWorkspaceManifestFile(root, manifest);
  const { readFileSync, existsSync, unlinkSync } = await import("node:fs");
  const ledgerFile = path.join(root, ".pops/runtime/dev/ledger.json");
  let managedPid: number | undefined;
  t.after(async () => {
    if (managedPid)
      try {
        process.kill(-managedPid, "SIGKILL");
      } catch {}
    await command(root, "manager", "stop").catch(() => {});
    rmSync(root, { recursive: true, force: true });
  });
  assert.equal((await command(root, "start", "app")).result.state, "running");
  process.kill(JSON.parse(readFileSync(ledgerFile, "utf8")).pid, "SIGTERM");
  for (let i = 0; i < 50 && existsSync(path.join(root, ".pops/runtime/dev/lock.json")); i++)
    await new Promise((r) => setTimeout(r, 30));
  assert.equal((await command(root, "status", "app")).result.state, "stopped");
  const running = (await command(root, "start", "app")).result;
  managedPid = running.processes[0].pid;
  process.kill(JSON.parse(readFileSync(ledgerFile, "utf8")).pid, "SIGKILL");
  await new Promise((r) => setTimeout(r, 100));
  const status = (await command(root, "status", "app")).result;
  assert.equal(status.state, "unknown");
  assert.match(status.issue, /verify all recorded process groups manually/);
  assert.equal((await command(root, "restart", "app")).result.state, "unknown");
  assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), "ok");
  assert.equal((await command(root, "manager", "stop")).result.state, "unknown");
  process.kill(-managedPid!, "SIGKILL");
  managedPid = undefined;
  await new Promise((r) => setTimeout(r, 100));
  for (const file of ["socket", "lock.json", "ledger.json"]) {
    const target = path.join(root, ".pops/runtime/dev", file);
    if (existsSync(target)) unlinkSync(target);
  }
  assert.equal((await command(root, "status", "app")).result.state, "stopped");
});

test("runtime static symlinks are rejected and status does not initialize runtime", async (t) => {
  const { existsSync, symlinkSync } = await import("node:fs");
  const root = mkdtempSync("/tmp/pdev-");
  createWorkspaceManifestFile(root, newWorkspaceManifest("test"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal((await command(root, "status", "app")).result.state, "stopped");
  assert.equal(existsSync(path.join(root, ".pops/runtime")), false);
  symlinkSync("/tmp", path.join(root, ".pops/runtime"));
  const result = await command(root, "start", "app");
  assert.equal(result.code, 1);
  assert.match(result.result.error.message, /Unsafe dev runtime directory/);
});

test("bounded logs, fixed IPC identity/actions and oversized requests leave manager usable", {
  timeout: 20000,
}, async (t) => {
  const { readFileSync, statSync } = await import("node:fs");
  const { createConnection } = await import("node:net");
  const root = mkdtempSync("/tmp/pdev-");
  mkdirSync(path.join(root, "repo"));
  const port = await freePort();
  const manifest = newWorkspaceManifest("test");
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
            'console.log("x".repeat(20000));console.error("tail-marker");require("http").createServer((q,s)=>s.end("ok")).listen(Number(process.argv[1]),"127.0.0.1")',
            String(port),
          ],
          cwd: ".",
          env: { PRIVATE_TEST: "never-return-env" },
        },
      },
    },
  };
  createWorkspaceManifestFile(root, manifest);
  t.after(async () => {
    await command(root, "manager", "stop").catch(() => {});
    rmSync(root, { recursive: true, force: true });
  });
  assert.equal((await command(root, "start", "app")).result.state, "running");
  const status = (await command(root, "status", "app")).result;
  assert.ok(status.processes[0].log.length <= 4096);
  assert.match(status.processes[0].log, /tail-marker/);
  assert.equal(JSON.stringify(status).includes("never-return-env"), false);
  const socketPath = path.join(root, ".pops/runtime/dev/socket");
  assert.equal(statSync(socketPath).mode & 0o777, 0o600);
  const lock = JSON.parse(readFileSync(path.join(root, ".pops/runtime/dev/lock.json"), "utf8"));
  const raw = (body: string) =>
    new Promise<string>((resolve, reject) => {
      const socket = createConnection(socketPath);
      let output = "";
      socket.setTimeout(3000, () => {
        socket.destroy();
        reject(new Error("fixture IPC timeout"));
      });
      socket.on("error", reject);
      socket.on("connect", () => socket.write(body));
      socket.on("data", (chunk) => {
        output += chunk.toString();
      });
      socket.on("close", () => resolve(output));
    });
  const identity = { version: 1, instance: lock.instance, workspace: root, project: "app" };
  assert.match(
    await raw(`${JSON.stringify({ ...identity, version: 999, action: "stop" })}\n`),
    /identity mismatch/,
  );
  assert.match(
    await raw(`${JSON.stringify({ ...identity, action: "exec" })}\n`),
    /Invalid dev action/,
  );
  assert.equal(await raw("x".repeat(5000)), "");
  assert.equal((await command(root, "status", "app")).result.state, "running");
});

test("manager stop during an in-flight start drains it and does not orphan the new group", {
  timeout: 20000,
}, async (t) => {
  const root = mkdtempSync("/tmp/pdev-");
  mkdirSync(path.join(root, "repo"));
  const port = await freePort();
  const manifest = newWorkspaceManifest("test");
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
            'setTimeout(()=>require("http").createServer((q,s)=>s.end("ok")).listen(Number(process.argv[1]),"127.0.0.1"),400)',
            String(port),
          ],
          cwd: ".",
          env: {},
        },
      },
    },
  };
  createWorkspaceManifestFile(root, manifest);
  t.after(async () => {
    await command(root, "manager", "stop").catch(() => {});
    rmSync(root, { recursive: true, force: true });
  });
  const starting = command(root, "start", "app");
  for (let i = 0; i < 50; i++) {
    if ((await command(root, "status", "app")).result.state === "starting") break;
    await new Promise((r) => setTimeout(r, 20));
  }
  const stopped = await command(root, "manager", "stop");
  await starting;
  assert.equal(stopped.code, 0);
  assert.equal((await command(root, "status", "app")).result.state, "stopped");
  assert.equal((await command(root, "check", "app")).result.ports[0].status, "free");
});

for (const action of ["project-stop", "manager-stop", "manager-term"] as const) {
  test(`invalid edited manifest preserves owner snapshot for ${action}`, {
    timeout: 15000,
  }, async (t) => {
    const { existsSync, readFileSync } = await import("node:fs");
    const root = mkdtempSync("/tmp/pdev-");
    mkdirSync(path.join(root, "repo"));
    const port = await freePort();
    const manifest = newWorkspaceManifest("test");
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
    createWorkspaceManifestFile(root, manifest);
    const manifestFile = path.join(root, ".pops/workspace.json");
    const lockFile = path.join(root, ".pops/runtime/dev/lock.json");
    const valid = readFileSync(manifestFile, "utf8");
    let servicePid: number | undefined;
    t.after(async () => {
      writeFileSync(manifestFile, valid);
      await command(root, "manager", "stop").catch(() => {});
      if (servicePid)
        try {
          process.kill(-servicePid, "SIGKILL");
        } catch {}
      rmSync(root, { recursive: true, force: true });
    });
    const started = await command(root, "start", "app");
    assert.equal(started.result.state, "running");
    servicePid = started.result.processes[0].pid;
    const managerPid = JSON.parse(
      readFileSync(path.join(root, ".pops/runtime/dev/ledger.json"), "utf8"),
    ).pid;
    const edited = JSON.parse(valid);
    edited.projects.app.dev.endpoints.web.port = "editing";
    writeFileSync(manifestFile, JSON.stringify(edited));
    if (action === "project-stop") {
      const status = await command(root, "status", "app");
      assert.equal(status.code, 0);
      assert.equal(status.result.state, "running");
      assert.equal(status.result.endpoints[0].port, port);
      assert.equal((await command(root, "stop", "app")).result.state, "stopped");
      assert.equal((await command(root, "start", "app")).code, 1);
    } else if (action === "manager-stop") {
      assert.equal((await command(root, "manager", "stop")).code, 0);
    } else {
      process.kill(managerPid, "SIGTERM");
      for (let i = 0; i < 80 && existsSync(lockFile); i++)
        await new Promise((resolve) => setTimeout(resolve, 25));
      assert.equal(existsSync(lockFile), false);
    }
    assert.equal((await command(root, "status", "app")).result.state, "stopped");
    const probe = createServer();
    await new Promise<void>((resolve, reject) => {
      probe.once("error", reject);
      probe.listen(port, "127.0.0.1", resolve);
    });
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    if (action !== "project-stop") {
      assert.equal((await command(root, "start", "app")).code, 1);
      assert.equal(existsSync(lockFile), false);
    }
  });
}
