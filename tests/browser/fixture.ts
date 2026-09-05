import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test as base } from "@playwright/test";
import { serializeReport } from "../../src/report/report.js";
import { serializeRetrospective } from "../../src/retrospective/retrospective.js";

const repo = path.resolve(import.meta.dirname, "../..");
export type WorkbenchFixture = {
  root: string;
  origin: string;
  cli(args: string[]): string;
  snapshot(): Record<string, string>;
  stop(): Promise<void>;
};

export const test = base.extend<{ workbench: WorkbenchFixture }>({
  workbench: async ({}, use) => {
    const root = mkdtempSync(path.join(tmpdir(), "pops-browser-"));
    let child: ChildProcess | undefined;
    let stopped = false;
    const stop = async () => {
      if (stopped || child === undefined) return;
      await stopServer(child);
      stopped = true;
    };
    try {
      const cli = (args: string[]) => execFileSync(process.execPath, [path.join(repo, "dist/cli.js"), ...args], {
        cwd: root, encoding: "utf8", timeout: 10_000,
      });
      cli(["init"]);
      for (const project of ["alpha", "empty"]) {
        mkdirSync(path.join(root, project));
        cli(["project", "add", project]);
        cli(["backlog", "init", project]);
      }
      cli(["docs", "scaffold", "alpha"]);
      cli(["backlog", "add", "alpha", "-T", "Browser task", "-c", "feature", "--priority", "P1", "-b", "## Intent\nBrowser authority <script>unsafe</script>"]);
      seedReadPages(root);
      child = spawn(process.execPath, [path.join(repo, "dist/workbench.js"), "--workspace", root, "--port", "0"], {
        cwd: root, stdio: ["ignore", "pipe", "pipe"],
      });
      const origin = await serverOrigin(child);
      await use({ root, origin, cli, snapshot: () => snapshot(root), stop });
    } finally {
      try { await stop(); }
      finally { rmSync(root, { recursive: true, force: true }); }
    }
  },
});
export { expect } from "@playwright/test";

function serverOrigin(child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => finish(new Error(`Workbench startup timed out: ${output}`)), 10_000);
    const finish = (error?: Error, origin?: string) => {
      clearTimeout(timer);
      child.stdout?.off("data", onData);
      child.stderr?.off("data", onData);
      child.off("exit", onExit);
      child.off("error", onError);
      if (error) reject(error); else resolve(origin!);
    };
    const onData = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-8192);
      const match = /ProjectOps Workbench listening at (http:\/\/127\.0\.0\.1:\d+)/.exec(output);
      if (match) finish(undefined, match[1]);
    };
    const onExit = (code: number | null) => finish(new Error(`Workbench exited (${code}): ${output}`));
    const onError = (error: Error) => finish(error);
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("exit", onExit);
    child.once("error", onError);
  });
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  const force = setTimeout(() => child.kill("SIGKILL"), 2_000);
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    child.kill("SIGTERM");
    await Promise.race([exited, new Promise<never>((_, reject) => {
      deadline = setTimeout(() => reject(new Error("Workbench process did not exit after SIGKILL")), 4_000);
    })]);
  } finally { clearTimeout(force); clearTimeout(deadline); }
}

function snapshot(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) {
      for (const [name, body] of Object.entries(snapshot(target))) files[`${entry.name}/${name}`] = body;
    } else {
      assert.ok(entry.isFile(), "Fixture contains a non-regular entry");
      files[entry.name] = readFileSync(target, "utf8");
    }
  }
  return files;
}

function seedReadPages(root: string): void {
  const ops = path.join(root, "ops/alpha");
  writeFileSync(path.join(ops, "plans/plan-browser.json"), JSON.stringify({
    schema: "plan/Plan@1", id: "plan-browser", title: "Browser plan", goal: "Validate production UI", status: "approved",
    approval: { approved_at: "2026-09-05", review_note: "Browser review approved" },
    materialization: { materialized_at: "2026-09-05", mapping: { ui: "ALP-001" } },
    items: [{ key: "ui", title: "Browser task", item_type: "task", priority: "P1", body: "Verify UI", depends_on: [] }],
  }));
  writeFileSync(path.join(ops, "reports/report-browser.md"), serializeReport({
    schema: "report/Report@1", id: "report-browser", title: "Browser report", project: "alpha", created_at: "2026-09-05",
    outcome: "partial", plan: "project-ops:plans/plan-browser.json", backlog: [{ id: "ALP-001", status: "todo" }],
    verification: ["Browser checks"], deviations: ["Accepted pending task"], workarounds: ["Isolated fixtures"], repo_docs: ["README.md"], body: "## Evidence\nBrowser report body",
  }));
  writeFileSync(path.join(root, "retrospectives/inbox/browser.md"), serializeRetrospective({
    schema: "retrospective/Retrospective@1", id: "browser", created_at: "2026-09-05", project: "alpha", task: "ALP-001", status: "inbox",
    trigger: "workflow-friction", harness: "test", model: null, body: "## Evidence\nBrowser retrospective body",
  }));
}
