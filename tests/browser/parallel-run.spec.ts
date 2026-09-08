import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { test, expect } from "./fixture.js";
import { startWorkbenchServer } from "../../src/server/workbenchServer.js";
import { showExecution, verifyExecution } from "../../src/application/executionApi.js";
import type { RunnerResult } from "../../src/execution/runtime.js";

test("two independent tasks use isolated checkouts and explicit acceptance plus landing reaches completion", async ({
  workbench,
  page,
}) => {
  await workbench.stop();
  const repo = path.join(workbench.root, "alpha");
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git(repo, "init", "-q");
  git(repo, "config", "user.name", "Fixture");
  git(repo, "config", "user.email", "fixture@example.com");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "Initial");
  const draft = path.join(workbench.root, "parallel-browser.json");
  writeFileSync(
    draft,
    JSON.stringify({
      title: "Parallel browser",
      goal: "Two isolated changes",
      execution_policy: { max_parallel: 2 },
      items: [1, 2].map((n) => ({
        key: `step${n}`,
        title: `Parallel task ${n}`,
        item_type: "task",
        priority: "P1",
        body: "Implement isolated file",
        depends_on: [],
        parallel: true,
        resources: [`module${n}`],
      })),
    }),
  );
  workbench.cli(["plan", "create", "alpha", "--input", draft]);
  workbench.cli([
    "plan",
    "approve",
    "alpha",
    "plan-parallel-browser",
    "--review-note",
    "Reviewed parallel permission",
  ]);
  workbench.cli(["plan", "materialize", "alpha", "plan-parallel-browser"]);
  const attempts: { id: string; checkout: string; finish: (result: RunnerResult) => void }[] = [];
  const server = await startWorkbenchServer({
    workspaceDir: workbench.root,
    port: 0,
    staticDir: path.resolve("dist/web"),
    parallelCommands: [[process.execPath, "-e", 'console.log("landing checks passed")']],
    runner: {
      start(attempt, context) {
        writeFileSync(
          path.join(context.repo, `${attempt.item_id}.txt`),
          `Change for ${attempt.item_id}`,
        );
        git(context.repo, "add", ".");
        git(context.repo, "commit", "-qm", `Implement ${attempt.item_id}`);
        return {
          completion: new Promise((resolve) => {
            attempts.push({ id: attempt.id, checkout: context.repo, finish: resolve });
          }),
          stop() {},
        };
      },
    },
  });
  const route = `${server.origin}/#/projects/alpha/plans/plan-parallel-browser?tab=execution`;
  try {
    await page.goto(`${server.origin}/#/projects/alpha/plans/plan-browser?tab=execution`);
    await expect(
      page
        .getByRole("region", { name: "并行执行 plan-browser" })
        .getByRole("button", { name: "创建有界并行执行" }),
    ).toBeDisabled();
    await page.goto(route);
    const panel = page.getByRole("region", { name: "并行执行 plan-parallel-browser" });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("计划已显式允许并行，最大容量为 2");
    await panel.getByRole("button", { name: "创建有界并行执行" }).click();
    await expect(panel).toContainText("待启动");
    await panel.getByRole("button", { name: "启动并行任务" }).click();
    await expect.poll(() => attempts.length).toBe(2);
    expect(attempts[0]!.checkout).not.toBe(attempts[1]!.checkout);
    await expect(panel).toContainText("module1");
    await expect(panel).toContainText("module2");
    await page.reload();
    await expect(panel).toContainText(attempts[0]!.id);
    expect(attempts.length).toBe(2);
    for (const entry of attempts)
      entry.finish({ outcome: "succeeded", summary: "Independent implementation complete" });
    await expect(
      panel.locator("[data-parallel-node]").filter({ hasText: "等待人工验收" }),
    ).toHaveCount(2, { timeout: 7000 });
    for (let index = 0; index < 2; index++) {
      const entry = attempts[index]!;
      const query = { workspaceDir: workbench.root, projectId: "alpha", attemptId: entry.id };
      const current = showExecution(query);
      expect(current.ok).toBe(true);
      if (!current.ok) return;
      const verified = verifyExecution({
        ...query,
        expectedRevision: current.data.attempt.revision,
        command: "isolated checks",
        outcome: "passed",
        evidence: `Verified isolated task ${index + 1}`,
      });
      expect(verified.ok).toBe(true);
      await panel.getByRole("link", { name: new RegExp(`Parallel task ${index + 1}`) }).click();
      const task = page.getByRole("region", { name: "任务执行" });
      await task.getByLabel("验收或状态核对说明").fill("Reviewed isolated checkout");
      await task.getByRole("button", { name: "接受本次结果" }).click();
      await expect(task).toContainText("验收结论：已接受");
      await page.goto(route);
      const node = panel.locator(`[data-parallel-node="step${index + 1}"]`);
      await expect(node).toContainText("已验收，等待落地", { timeout: 7000 });
      if (index === 0) {
        await expect(node).toContainText("git commit");
        await node
          .getByLabel("重新工作说明 Parallel task 1")
          .fill("Recheck the first isolated change before landing");
        await node.getByRole("button", { name: "要求修改并重新验收 Parallel task 1" }).click();
        await expect(node).toContainText("等待依赖与资源");
        await expect(panel).toContainText("已暂停");
        await panel.getByLabel("并行恢复或终止说明").fill("Resume the requested rework");
        await panel.getByRole("button", { name: "确认恢复并行派发" }).click();
        await expect.poll(() => attempts.length, { timeout: 7000 }).toBe(3);
        const retry = attempts[2]!;
        expect(retry.checkout).not.toBe(entry.checkout);
        retry.finish({ outcome: "succeeded", summary: "Rework complete" });
        await expect(node).toContainText("等待人工验收", { timeout: 7000 });
        const retried = showExecution({ ...query, attemptId: retry.id });
        expect(retried.ok).toBe(true);
        if (!retried.ok) return;
        expect(retried.data.attempt.retry_of).toBe(entry.id);
        const checked = verifyExecution({
          ...query,
          attemptId: retry.id,
          expectedRevision: retried.data.attempt.revision,
          command: "rework checks",
          outcome: "passed",
          evidence: "Rework checks passed",
        });
        expect(checked.ok).toBe(true);
        await node.getByRole("link", { name: /Parallel task 1/ }).click();
        await task.getByLabel("验收或状态核对说明").fill("Reviewed new rework attempt");
        await task.getByRole("button", { name: "接受本次结果" }).click();
        await expect(task).toContainText("验收结论：已接受");
        await page.goto(route);
        await expect(node).toContainText("已验收，等待落地", { timeout: 7000 });
        await expect(node).toContainText(entry.id);
        await expect(node).toContainText(retry.id);
      }

      await node.getByRole("button", { name: `验证并落地 Parallel task ${index + 1}` }).click();
      await expect(node).toContainText("已落地", { timeout: 7000 });
      const historyDetail = panel.locator('.run-history[data-parallel-details^="record-"]');
      if (await historyDetail.count()) await historyDetail.locator(":scope > summary").click();
      await node.getByText(/落地结果 landed/).click();
      await expect(node).toContainText("landing checks passed");
    }
    await expect(panel).toContainText("全部落地完成", { timeout: 7000 });
    expect(git(repo, "status", "--porcelain")).toBe("");
    expect(attempts.length).toBe(3);
  } finally {
    for (const entry of attempts) entry.finish({ outcome: "stopped", summary: "Fixture cleanup" });
    await new Promise((resolve) => setImmediate(resolve));
    await server.close();
  }
});
