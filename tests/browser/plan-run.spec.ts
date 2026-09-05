import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { test, expect } from "./fixture.js";
import { startWorkbenchServer } from "../../src/server/workbenchServer.js";
import { showExecution, verifyExecution } from "../../src/application/executionApi.js";
import type { RunnerResult } from "../../src/execution/runtime.js";

test("Plan run waits for acceptance, preserves pause across reload and explicitly resumes its dependent task", async ({
  workbench,
  page,
}) => {
  await workbench.stop();
  execFileSync("git", ["init", "-q"], { cwd: path.join(workbench.root, "alpha") });
  const draft = path.join(workbench.root, "serial-browser.json");
  writeFileSync(
    draft,
    JSON.stringify({
      title: "Serial browser",
      goal: "Run tasks in order",
      items: [1, 2].map((n) => ({
        key: `step${n}`,
        title: `Serial task ${n}`,
        item_type: "task",
        priority: "P1",
        body: "Implement and verify",
        depends_on: n === 1 ? [] : ["step1"],
      })),
    }),
  );
  workbench.cli(["plan", "create", "alpha", "--input", draft]);
  workbench.cli(["plan", "approve", "alpha", "plan-serial-browser", "--review-note", "Reviewed"]);
  workbench.cli(["plan", "materialize", "alpha", "plan-serial-browser"]);
  let starts = 0,
    stops = 0,
    attemptId = "";
  let finish!: (result: RunnerResult) => void;
  const server = await startWorkbenchServer({
    workspaceDir: workbench.root,
    port: 0,
    staticDir: path.resolve("dist/web"),
    runner: {
      start(attempt) {
        starts++;
        attemptId = attempt.id;
        return {
          completion: new Promise((resolve) => {
            finish = resolve;
          }),
          stop() {
            stops++;
          },
        };
      },
    },
  });
  const route = `${server.origin}/#/projects/alpha/plans/plan-serial-browser`;
  try {
    await page.goto(route);
    const panel = page.getByRole("region", { name: "计划执行 plan-serial-browser" });
    await expect(panel).toBeVisible();
    await panel.getByRole("button", { name: "创建串行执行" }).click();
    await expect(panel).toContainText("待启动");
    expect(starts).toBe(0);
    await panel.getByRole("button", { name: "启动计划执行" }).click();
    await expect.poll(() => starts).toBe(1);
    await expect(panel).toContainText("运行中");
    await panel.getByLabel("恢复说明").fill("Keep this draft during refresh");
    await panel.getByRole("button", { name: "暂停后续任务" }).click();
    await expect(panel).toContainText("已暂停");
    expect(stops).toBe(0);
    await expect(panel.getByLabel("恢复说明")).toHaveValue("Keep this draft during refresh");
    await page.reload();
    await expect(panel).toContainText("已暂停");
    expect(starts).toBe(1);
    finish({ outcome: "succeeded", summary: "First task complete, pending acceptance" });
    await expect(panel).toContainText("等待人工验收", { timeout: 7000 });
    expect(starts).toBe(1);
    const query = { workspaceDir: workbench.root, projectId: "alpha", attemptId };
    const current = showExecution(query);
    expect(current.ok).toBe(true);
    if (!current.ok) return;
    const verified = verifyExecution({
      ...query,
      expectedRevision: current.data.attempt.revision,
      command: "serial fixture checks",
      outcome: "passed",
      evidence: "First task checks passed",
    });
    expect(verified.ok).toBe(true);
    await panel.getByRole("link", { name: /Serial task 1/ }).click();
    const task = page.getByRole("region", { name: "任务执行" });
    await task.getByLabel("验收或状态核对说明").fill("Reviewed first task");
    await task.getByRole("button", { name: "接受本次结果" }).click();
    await expect(task).toContainText("验收结论：已接受");
    await page.goto(route);
    await expect(panel).toContainText("已验收 · 依赖：无", { timeout: 7000 });
    await expect(panel).toContainText("已暂停");
    expect(starts).toBe(1);
    await panel.getByLabel("恢复说明").fill("Verified predecessor, continue the second task");
    await panel.getByRole("button", { name: "确认恢复或重试失败任务" }).click();
    await expect.poll(() => starts, { timeout: 7000 }).toBe(2);
    await expect(panel.getByRole("button", { name: "停止当前任务" })).toBeEnabled();
    await panel.getByRole("button", { name: "停止当前任务" }).click();
    await expect.poll(() => stops).toBe(1);
    finish({ outcome: "stopped", summary: "Explicit stop confirmed" });
    await expect(panel).toContainText("执行失败，需人工恢复", { timeout: 7000 });
    expect(starts).toBe(2);
    await panel.getByLabel("恢复说明").fill("Stop this scope after inspecting the terminated task");
    await panel.getByRole("button", { name: "终止计划执行" }).click();
    await expect(panel).toContainText("计划已终止");
    await expect(panel.getByRole("button", { name: "确认恢复或重试失败任务" })).toHaveCount(0);
  } finally {
    finish?.({ outcome: "stopped", summary: "Fixture cleanup" });
    await new Promise((resolve) => setImmediate(resolve));
    await server.close();
  }
});
