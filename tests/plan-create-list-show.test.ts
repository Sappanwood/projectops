import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

function setupWorkspace(): string {
  const ws = freshDir();
  assert.equal(run(["init"], ws).code, 0);
  mkdirSync(path.join(ws, "repo-a"));
  assert.equal(run(["project", "add", "repo-a"], ws).code, 0);
  return ws;
}

function writeDraft(ws: string): string {
  const draftPath = path.join(ws, "release-workflow.json");
  writeFileSync(
    draftPath,
    JSON.stringify({
      title: "Release workflow",
      goal: "Publish a repeatable release.",
      items: [
        {
          key: "prepare",
          title: "Prepare release",
          item_type: "task",
          priority: "P1",
          body: "Update release notes.",
        },
        {
          key: "publish",
          title: "Publish release",
          item_type: "task",
          priority: "P1",
          body: "Publish the package.",
          depends_on: ["prepare"],
        },
      ],
    }, null, 2),
    "utf8",
  );
  return draftPath;
}

function writeManifest(ws: string, mutate: (manifest: Record<string, unknown>) => void): void {
  const manifestPath = path.join(ws, ".pops", "workspace.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  mutate(manifest);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

test("plan create writes a versioned plan and list/show return stable JSON", () => {
  const ws = setupWorkspace();
  const draftPath = writeDraft(ws);

  const created = run(["plan", "create", "repo-a", "--input", draftPath, "--json"], ws);

  assert.equal(created.code, 0);
  const createResult = JSON.parse(created.stdout[0] ?? "null") as { ok: boolean; plan: Record<string, unknown> };
  assert.equal(createResult.ok, true);
  assert.equal(createResult.plan.id, "plan-release-workflow");
  assert.equal(createResult.plan.schema, "plan/Plan@1");
  assert.equal(createResult.plan.goal, "Publish a repeatable release.");
  assert.ok(existsSync(path.join(ws, "ops", "repo-a", "plans", "plan-release-workflow.json")));

  const listed = run(["plan", "list", "repo-a", "--json"], ws);
  assert.equal(listed.code, 0);
  const listResult = JSON.parse(listed.stdout[0] ?? "null") as {
    ok: boolean;
    plans: { id: string; title: string; goal: string; item_count: number }[];
  };
  assert.deepEqual(listResult, {
    ok: true,
    plans: [{ id: "plan-release-workflow", title: "Release workflow", goal: "Publish a repeatable release.", item_count: 2 }],
  });

  const shown = run(["plan", "show", "repo-a", "plan-release-workflow", "--json"], ws);
  assert.equal(shown.code, 0);
  const plan = JSON.parse(shown.stdout[0] ?? "null") as {
    id: string;
    items: { key: string; depends_on: string[] }[];
  };
  assert.equal(plan.id, "plan-release-workflow");
  assert.deepEqual(plan.items[1], { key: "publish", title: "Publish release", item_type: "task", priority: "P1", body: "Publish the package.", depends_on: ["prepare"] });
});

test("plan create fails without overwriting an existing plan", () => {
  const ws = setupWorkspace();
  const draftPath = writeDraft(ws);
  assert.equal(run(["plan", "create", "repo-a", "--input", draftPath], ws).code, 0);
  const planPath = path.join(ws, "ops", "repo-a", "plans", "plan-release-workflow.json");
  const original = readFileSync(planPath, "utf8");

  const duplicate = run(["plan", "create", "repo-a", "--input", draftPath], ws);

  assert.equal(duplicate.code, 1);
  assert.match(duplicate.stderr.join("\n"), /already exists/i);
  assert.equal(readFileSync(planPath, "utf8"), original);
});

test("plan commands reject a missing or incorrect plans descriptor before writing", () => {
  const missing = setupWorkspace();
  const missingDraft = writeDraft(missing);
  writeManifest(missing, (manifest) => {
    delete (manifest.artifact_layout as { roots: Record<string, string> }).roots.plans;
  });

  for (const args of [
    ["plan", "create", "repo-a", "--input", missingDraft],
    ["plan", "list", "repo-a"],
    ["plan", "show", "repo-a", "plan-release-workflow"],
  ]) {
    const result = run(args, missing);
    assert.equal(result.code, 1);
    assert.match(result.stderr.join("\n"), /plans artifact type/i);
  }
  assert.equal(existsSync(path.join(missing, "ops", "repo-a", "plans", "plan-release-workflow.json")), false);

  const mismatch = setupWorkspace();
  const mismatchDraft = writeDraft(mismatch);
  writeManifest(mismatch, (manifest) => {
    (manifest.artifact_layout as { roots: Record<string, string> }).roots.plans = "markdown/plan@1";
  });
  const result = run(["plan", "create", "repo-a", "--input", mismatchDraft], mismatch);
  assert.equal(result.code, 1);
  assert.match(result.stderr.join("\n"), /plans artifact type/i);
  assert.equal(existsSync(path.join(mismatch, "ops", "repo-a", "plans", "plan-release-workflow.json")), false);
});

test("plan create gives non-ASCII titles a stable id and retains no-clobber behavior", () => {
  const ws = setupWorkspace();
  const draftPath = path.join(ws, "chinese-plan.json");
  writeFileSync(draftPath, JSON.stringify({
    title: "发布计划",
    goal: "发布版本。",
    items: [],
  }), "utf8");

  const created = run(["plan", "create", "repo-a", "--input", draftPath, "--json"], ws);
  assert.equal(created.code, 0);
  const plan = JSON.parse(created.stdout[0] ?? "null") as { plan: { id: string } };
  assert.equal(plan.plan.id, "plan-u53d1-u5e03-u8ba1-u5212");
  const planPath = path.join(ws, "ops", "repo-a", "plans", `${plan.plan.id}.json`);
  const original = readFileSync(planPath, "utf8");

  const duplicate = run(["plan", "create", "repo-a", "--input", draftPath], ws);
  assert.equal(duplicate.code, 1);
  assert.match(duplicate.stderr.join("\n"), /already exists/i);
  assert.equal(readFileSync(planPath, "utf8"), original);
});

test("plan create rejects a plans-root symlink that escapes the workspace", () => {
  const ws = setupWorkspace();
  const draftPath = writeDraft(ws);
  const plansRoot = path.join(ws, "ops", "repo-a", "plans");
  const outside = freshDir();
  try {
    rmSync(plansRoot, { recursive: true, force: true });
    symlinkSync(outside, plansRoot, "dir");

    const result = run(["plan", "create", "repo-a", "--input", draftPath], ws);

    assert.equal(result.code, 1);
    assert.match(result.stderr.join("\n"), /plans root.*outside/i);
    assert.equal(existsSync(path.join(outside, "plan-release-workflow.json")), false);
  } finally {
    rmSync(ws, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
