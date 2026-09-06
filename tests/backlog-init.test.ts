import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { runCli } from "../src/app.js";

function freshDir(): string {
  return mkdtempSync(path.join(tmpdir(), "pops-"));
}

function run(args: string[], cwd: string): { code: number; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = runCli(
    args,
    {
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
    },
    cwd,
  );
  return { code, stdout, stderr };
}

function setupWorkspaceWithProject(...projects: string[]): string {
  const ws = freshDir();
  assert.equal(run(["init"], ws).code, 0);
  for (const project of projects.length ? projects : ["repo-a"]) {
    mkdirSync(path.join(ws, project));
    assert.equal(run(["project", "add", project], ws).code, 0);
  }
  return ws;
}

function storeDir(ws: string, project = "repo-a"): string {
  return path.join(ws, "ops", project, "backlog");
}

function initialize(ws: string, project: string, prefix?: string): string {
  const result = run(
    [
      "backlog",
      "init",
      project,
      ...(prefix === undefined ? [] : ["--id-prefix", prefix]),
      "--json",
    ],
    ws,
  );
  assert.equal(result.code, 0, result.stderr.join("\n"));
  return JSON.parse(result.stdout.join("\n")).store.id_prefix;
}

function snapshotStore(root: string): Record<string, string> {
  const files = [
    "backlog.json",
    "INDEX.md",
    ...readdirSync(path.join(root, "items")).map((name) => `items/${name}`),
  ];
  return Object.fromEntries(
    files.map((name) => [name, readFileSync(path.join(root, name), "utf8")]),
  );
}

test("backlog init bootstraps a store for a registered project", () => {
  const ws = setupWorkspaceWithProject();

  const { code, stderr } = run(["backlog", "init", "repo-a"], ws);

  assert.equal(code, 0);
  assert.deepEqual(stderr, []);
  const manifest = JSON.parse(readFileSync(path.join(storeDir(ws), "backlog.json"), "utf8")) as {
    schema: string;
    project_id: string;
    id_prefix: string;
  };
  assert.equal(manifest.schema, "backlog/Store@1");
  assert.equal(manifest.project_id, "repo-a");
  assert.equal(manifest.id_prefix, "REP");
  assert.ok(existsSync(path.join(storeDir(ws), "items")));
  assert.ok(existsSync(path.join(storeDir(ws), "INDEX.md")));
});

test("backlog init refuses to rebuild an existing store", () => {
  const ws = setupWorkspaceWithProject();
  assert.equal(run(["backlog", "init", "repo-a"], ws).code, 0);
  const before = readFileSync(path.join(storeDir(ws), "backlog.json"), "utf8");

  const { code, stderr } = run(["backlog", "init", "repo-a"], ws);

  assert.equal(code, 1);
  assert.match(stderr.join("\n"), /already/i);
  assert.equal(readFileSync(path.join(storeDir(ws), "backlog.json"), "utf8"), before);
});

test("backlog init does not overwrite a pre-existing index", () => {
  const ws = setupWorkspaceWithProject();
  const indexFile = path.join(storeDir(ws), "INDEX.md");
  writeFileSync(indexFile, "# User content\n", "utf8");

  const { code, stderr } = run(["backlog", "init", "repo-a"], ws);

  assert.equal(code, 1);
  assert.match(stderr.join("\n"), /already|not empty/i);
  assert.equal(readFileSync(indexFile, "utf8"), "# User content\n");
  assert.equal(existsSync(path.join(storeDir(ws), "backlog.json")), false);
  assert.equal(existsSync(path.join(storeDir(ws), "items")), false);
});

test("backlog init does not adopt a pre-existing items directory", () => {
  const ws = setupWorkspaceWithProject();
  const itemsDir = path.join(storeDir(ws), "items");
  mkdirSync(itemsDir);
  writeFileSync(path.join(itemsDir, "notes.md"), "user content\n", "utf8");

  const { code } = run(["backlog", "init", "repo-a"], ws);

  assert.equal(code, 1);
  assert.equal(readFileSync(path.join(itemsDir, "notes.md"), "utf8"), "user content\n");
  assert.equal(existsSync(path.join(storeDir(ws), "backlog.json")), false);
  assert.equal(existsSync(path.join(storeDir(ws), "INDEX.md")), false);
});

test("backlog init rejects an unregistered project", () => {
  const ws = setupWorkspaceWithProject();

  const { code, stderr } = run(["backlog", "init", "nope"], ws);

  assert.equal(code, 1);
  assert.match(stderr.join("\n"), /not registered/i);
});

test("backlog init requires a workspace", () => {
  const outside = freshDir();

  const { code, stderr } = run(["backlog", "init", "repo-a"], outside);

  assert.equal(code, 1);
  assert.match(stderr.join("\n"), /workspace/i);
});

test("backlog init --json emits a stable machine-readable result", () => {
  const ws = setupWorkspaceWithProject();

  const { code, stdout } = run(["backlog", "init", "repo-a", "--json"], ws);

  assert.equal(code, 0);
  const result = JSON.parse(stdout[0] ?? "null") as {
    ok: boolean;
    store: { project_id: string; id_prefix: string; root: string };
  };
  assert.equal(result.ok, true);
  assert.equal(result.store.project_id, "repo-a");
  assert.equal(result.store.id_prefix, "REP");
  assert.equal(result.store.root, "ops/repo-a/backlog");
});

test("automatic prefixes resolve mochi collisions with the first free numeric suffix", () => {
  const ws = setupWorkspaceWithProject("mochi", "mochi-write", "mochi-web", "reserved", "empty");
  assert.equal(initialize(ws, "mochi"), "MOC");
  assert.equal(initialize(ws, "reserved", "MOC3"), "MOC3");
  const before = snapshotStore(storeDir(ws, "mochi"));
  assert.equal(initialize(ws, "mochi-write"), "MOC2");
  assert.equal(initialize(ws, "mochi-web"), "MOC4");
  assert.deepEqual(snapshotStore(storeDir(ws, "mochi")), before);
  assert.deepEqual(readdirSync(storeDir(ws, "empty")), []);
});

test("custom MWT is persisted and used for MWT-001 through MWT-004", () => {
  const ws = setupWorkspaceWithProject("mochi", "mochi-write");
  initialize(ws, "mochi");
  assert.equal(initialize(ws, "mochi-write", "MWT"), "MWT");
  for (let n = 1; n <= 4; n++) {
    const result = run(
      [
        "backlog",
        "add",
        "mochi-write",
        "-T",
        `Task ${n}`,
        "-c",
        "feature",
        "--priority",
        "P1",
        "--json",
      ],
      ws,
    );
    assert.equal(result.code, 0, result.stderr.join("\n"));
    const id = `MWT-00${n}`;
    assert.equal(JSON.parse(result.stdout.join("\n")).item.id, id);
    const shown = run(["backlog", "show", "mochi-write", id, "--json"], ws);
    assert.equal(shown.code, 0);
    assert.equal(JSON.parse(shown.stdout.join("\n")).id, id);
  }
  const before = snapshotStore(storeDir(ws, "mochi-write"));
  for (const args of [[], ["--id-prefix", "NEW"], ["--id-prefix", "MWT"]]) {
    const result = run(["backlog", "init", "mochi-write", ...args], ws);
    assert.equal(result.code, 1);
    assert.match(result.stderr.join("\n"), /already/i);
    assert.deepEqual(snapshotStore(storeDir(ws, "mochi-write")), before);
  }
});

test("custom prefix conflicts identify the owner without initializing the target", () => {
  const ws = setupWorkspaceWithProject("mochi", "mochi-write");
  initialize(ws, "mochi");
  const before = snapshotStore(storeDir(ws, "mochi"));
  const result = run(["backlog", "init", "mochi-write", "--id-prefix", "MOC", "--json"], ws);
  assert.equal(result.code, 1);
  assert.match(result.stderr.join("\n"), /MOC.*mochi/);
  assert.deepEqual(result.stdout, []);
  assert.deepEqual(readdirSync(storeDir(ws, "mochi-write")), []);
  assert.deepEqual(snapshotStore(storeDir(ws, "mochi")), before);
  assert.equal(initialize(ws, "mochi-write", "MWT"), "MWT");
});

test("invalid prefixes and malformed init arguments fail before store creation", () => {
  for (const prefix of [
    "",
    "mwt",
    "Mwt",
    " MWT",
    "MWT ",
    "MWT\n",
    "MW-T",
    "MW_T",
    "中文",
    "../MWT",
  ]) {
    const ws = setupWorkspaceWithProject();
    const result = run(["backlog", "init", "repo-a", "--id-prefix", prefix], ws);
    assert.equal(result.code, 1, JSON.stringify(prefix));
    assert.match(result.stderr.join("\n"), /id-prefix.*(?:uppercase|A-Z|non-empty)/i);
    assert.deepEqual(readdirSync(storeDir(ws)), []);
  }
  for (const args of [
    ["--id-prefix"],
    ["--id-prefix", "--json"],
    ["--id-prefix", "MWT", "--id-prefix", "OTHER"],
    ["--prefix", "MWT"],
    ["extra"],
  ]) {
    const ws = setupWorkspaceWithProject();
    const result = run(["backlog", "init", "repo-a", ...args], ws);
    assert.equal(result.code, 1, args.join(" "));
    assert.match(result.stderr.join("\n"), /Usage|argument|option|id-prefix/i);
    assert.deepEqual(readdirSync(storeDir(ws)), []);
  }
});

test("prefix format preserves short and numeric prefixes without new schema limits", () => {
  for (const prefix of ["A", "7", "MWT2", "LONGPREFIX123"]) {
    const ws = setupWorkspaceWithProject();
    assert.equal(initialize(ws, "repo-a", prefix), prefix);
  }
  const ws = setupWorkspaceWithProject("a", "a-a", "123-repo");
  assert.equal(initialize(ws, "a"), "A");
  assert.equal(initialize(ws, "a-a"), "AA");
  assert.equal(initialize(ws, "123-repo"), "123");
});

test("prefix lookup follows manifest layout and ignores unregistered and other workspace stores", () => {
  const ws = setupWorkspaceWithProject("mochi", "mochi-write");
  initialize(ws, "mochi");
  renameSync(path.join(ws, "ops"), path.join(ws, "project-data"));
  const file = path.join(ws, ".pops/workspace.json");
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  manifest.artifact_layout.ops_root = "project-data";
  writeFileSync(file, JSON.stringify(manifest));
  mkdirSync(path.join(ws, "project-data", "unregistered", "backlog"), { recursive: true });
  writeFileSync(
    path.join(ws, "project-data", "unregistered", "backlog", "backlog.json"),
    "invalid",
  );
  const other = setupWorkspaceWithProject("mochi-write");
  initialize(other, "mochi-write", "MOC2");
  assert.equal(initialize(ws, "mochi-write"), "MOC2");
  assert.equal(
    JSON.parse(readFileSync(path.join(ws, "project-data/mochi-write/backlog/backlog.json"), "utf8"))
      .id_prefix,
    "MOC2",
  );
  assert.equal(existsSync(path.join(ws, "ops")), false);
});

test("invalid or partial registered stores block automatic and custom allocation with repair diagnostics", () => {
  const damage: Record<string, (root: string) => void> = {
    "malformed JSON": (root) => writeFileSync(path.join(root, "backlog.json"), "{"),
    "invalid schema": (root) =>
      writeFileSync(
        path.join(root, "backlog.json"),
        JSON.stringify({ schema: "backlog/Store@0", project_id: "mochi", id_prefix: "MOC" }),
      ),
    "invalid prefix": (root) =>
      writeFileSync(
        path.join(root, "backlog.json"),
        JSON.stringify({ schema: "backlog/Store@1", project_id: "mochi", id_prefix: "bad-prefix" }),
      ),
    "project mismatch": (root) =>
      writeFileSync(
        path.join(root, "backlog.json"),
        JSON.stringify({ schema: "backlog/Store@1", project_id: "other", id_prefix: "MOC" }),
      ),
    "manifest missing": (root) => unlinkSync(path.join(root, "backlog.json")),
    "items missing": (root) => rmdirSync(path.join(root, "items")),
    "index missing": (root) => unlinkSync(path.join(root, "INDEX.md")),
    "manifest is directory": (root) => {
      unlinkSync(path.join(root, "backlog.json"));
      mkdirSync(path.join(root, "backlog.json"));
    },
    "root missing": (root) => renameSync(root, `${root}-saved`),
    "root is file": (root) => {
      renameSync(root, `${root}-saved`);
      writeFileSync(root, "user content");
    },
  };
  for (const [name, corrupt] of Object.entries(damage)) {
    const ws = setupWorkspaceWithProject("mochi", "mochi-write");
    initialize(ws, "mochi");
    corrupt(storeDir(ws, "mochi"));
    for (const args of [[], ["--id-prefix", "MWT"]]) {
      const result = run(["backlog", "init", "mochi-write", ...args], ws);
      assert.equal(result.code, 1, name);
      assert.match(result.stderr.join("\n"), /mochi/);
      assert.match(result.stderr.join("\n"), /ops\/mochi\/backlog/);
      assert.match(result.stderr.join("\n"), /repair|restore|correct|inspect/i);
      assert.deepEqual(readdirSync(storeDir(ws, "mochi-write")), []);
    }
  }
});

test("unreadable registered manifest is not treated as an unused prefix", {
  skip: process.getuid?.() === 0,
}, () => {
  const ws = setupWorkspaceWithProject("mochi", "mochi-write");
  initialize(ws, "mochi");
  const file = path.join(storeDir(ws, "mochi"), "backlog.json");
  chmodSync(file, 0);
  try {
    const result = run(["backlog", "init", "mochi-write"], ws);
    assert.equal(result.code, 1);
    assert.match(result.stderr.join("\n"), /mochi.*(?:EACCES|permission)/i);
    assert.match(result.stderr.join("\n"), /repair|restore|correct|inspect/i);
    assert.deepEqual(readdirSync(storeDir(ws, "mochi-write")), []);
  } finally {
    chmodSync(file, 0o600);
  }
  assert.equal(initialize(ws, "mochi-write"), "MOC2");
});

test("init rejects invalid backlog descriptors and static store escape without writes", () => {
  for (const type of [undefined, "backlog/store@0"]) {
    const ws = setupWorkspaceWithProject();
    const file = path.join(ws, ".pops/workspace.json");
    const manifest = JSON.parse(readFileSync(file, "utf8"));
    manifest.artifact_layout.roots.backlog = type;
    writeFileSync(file, JSON.stringify(manifest));
    const result = run(["backlog", "init", "repo-a"], ws);
    assert.equal(result.code, 1);
    assert.match(result.stderr.join("\n"), /backlog.*type|descriptor/i);
    assert.deepEqual(readdirSync(storeDir(ws)), []);
  }
  const ws = setupWorkspaceWithProject();
  const outside = freshDir();
  rmdirSync(storeDir(ws));
  symlinkSync(outside, storeDir(ws));
  const result = run(["backlog", "init", "repo-a"], ws);
  assert.equal(result.code, 1);
  assert.deepEqual(readdirSync(outside), []);
});

test("workspace init lock rejects contenders and permits retry without changing the held lock", () => {
  const ws = setupWorkspaceWithProject();
  const lock = path.join(ws, ".pops/runtime/backlog-init.lock");
  mkdirSync(lock, { recursive: true });
  const result = run(["backlog", "init", "repo-a"], ws);
  assert.equal(result.code, 1);
  assert.match(result.stderr.join("\n"), /busy|lock/i);
  assert.match(result.stderr.join("\n"), /retry|running/i);
  assert.equal(existsSync(lock), true);
  assert.deepEqual(readdirSync(storeDir(ws)), []);
  rmdirSync(lock);
  assert.equal(initialize(ws, "repo-a"), "REP");
  assert.equal(existsSync(lock), false);
});

test("concurrent built CLI initializations cannot publish duplicate prefixes", async () => {
  const ws = setupWorkspaceWithProject("mochi", "mochi-write", "mochi-web");
  const cli = path.resolve("dist/cli.js");
  const results = await Promise.all(
    ["mochi", "mochi-write", "mochi-web"].map(
      (project) =>
        new Promise<{ project: string; code: number | null; stderr: string }>((resolve, reject) => {
          const child = spawn(process.execPath, [cli, "backlog", "init", project, "--json"], {
            cwd: ws,
            timeout: 10_000,
          });
          let stderr = "";
          child.stderr.on("data", (data) => {
            stderr += data;
          });
          child.on("error", reject);
          child.on("close", (code, signal) => {
            if (signal) reject(new Error(`Initialization terminated: ${signal}`));
            else resolve({ project, code, stderr });
          });
        }),
    ),
  );
  const prefixes: string[] = [];
  for (const result of results) {
    if (result.code !== 0) {
      assert.equal(result.code, 1, result.stderr);
      assert.match(result.stderr, /busy|lock/i);
      assert.deepEqual(readdirSync(storeDir(ws, result.project)), []);
      initialize(ws, result.project);
    }
    prefixes.push(
      JSON.parse(readFileSync(path.join(storeDir(ws, result.project), "backlog.json"), "utf8"))
        .id_prefix,
    );
  }
  assert.deepEqual(prefixes.sort(), ["MOC", "MOC2", "MOC3"]);
  assert.equal(existsSync(path.join(ws, ".pops/runtime/backlog-init.lock")), false);
});

test("built CLI help and custom prefix smoke use the documented option", () => {
  const ws = setupWorkspaceWithProject("mochi-write");
  const cli = path.resolve("dist/cli.js");
  const invoke = (...args: string[]) => {
    const result = spawnSync(process.execPath, [cli, ...args], {
      cwd: ws,
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout);
    return result.stdout;
  };
  assert.match(invoke("backlog", "init", "--help"), /--id-prefix/);
  const receipt = JSON.parse(
    invoke("backlog", "init", "mochi-write", "--id-prefix", "MWT", "--json"),
  );
  assert.equal(receipt.store.id_prefix, "MWT");
  for (let n = 1; n <= 4; n++) {
    const added = JSON.parse(
      invoke(
        "backlog",
        "add",
        "mochi-write",
        "-T",
        `Task ${n}`,
        "-c",
        "feature",
        "--priority",
        "P1",
        "--json",
      ),
    );
    assert.equal(added.item.id, `MWT-00${n}`);
    assert.equal(
      JSON.parse(invoke("backlog", "show", "mochi-write", added.item.id, "--json")).id,
      added.item.id,
    );
  }
});
