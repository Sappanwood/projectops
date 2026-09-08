import { test, expect } from "./fixture.js";

test("task edits preserve conflicting input and Plan revisions require preview", async ({
  workbench,
  page,
}) => {
  await page.goto(`${workbench.origin}/#/projects/alpha/backlog/ALP-001`);
  await page.getByRole("button", { name: "编辑任务内容" }).click();
  await page.getByLabel("任务标题").fill("Clarified browser task");
  await page.getByLabel("正文与验收要求").fill("## Acceptance\nKeep all evidence");
  const item = JSON.parse(workbench.cli(["backlog", "show", "alpha", "ALP-001", "--json"]));
  workbench.cli([
    "backlog",
    "update",
    "alpha",
    "ALP-001",
    "--status",
    "in_progress",
    "--expected-revision",
    item.revision,
  ]);
  await page.getByRole("button", { name: "保存任务内容" }).click();
  await expect(page.locator("[data-foundation-editor]")).toContainText("REVISION_MISMATCH");
  await expect(page.getByLabel("任务标题")).toHaveValue("Clarified browser task");
  await expect(page.getByLabel("正文与验收要求")).toHaveValue("## Acceptance\nKeep all evidence");
  await page.getByRole("button", { name: "重读版本并保留草稿" }).click();
  await page.getByRole("button", { name: "保存任务内容" }).click();
  await expect(page.locator("[data-foundation-editor]")).toContainText("任务内容已保存");
  expect(JSON.parse(workbench.cli(["backlog", "show", "alpha", "ALP-001", "--json"])).title).toBe(
    "Clarified browser task",
  );
  await page.getByRole("tab", { name: /^Plans/ }).click();
  await page.getByRole("link", { name: /Browser plan/ }).click();
  await page.getByRole("button", { name: "修订计划" }).click();
  const input = page.getByLabel("计划 JSON 草案");
  await expect(input).toHaveValue(/Validate production UI/);
  const draft = JSON.parse(await input.inputValue());
  draft.goal = "Clarified goal";
  await input.fill(JSON.stringify(draft));
  await page.getByRole("button", { name: "预览修订" }).click();
  await expect(page.locator("[data-foundation-plan]")).toContainText("受影响任务");
  await page.getByRole("button", { name: "确认应用修订" }).click();
  await expect(page.locator("[data-foundation-plan]")).toContainText("计划修订已保存");
});

test("execution evidence supports explicit acceptance after page reload", async ({
  workbench,
  page,
}) => {
  const { execFileSync } = await import("node:child_process");
  const { createExecution, finishExecution, verifyExecution } = await import(
    "../../src/application/executionApi.js"
  );
  execFileSync("git", ["init"], { cwd: `${workbench.root}/alpha`, stdio: "ignore" });
  const query = { workspaceDir: workbench.root, projectId: "alpha", itemId: "ALP-001" };
  const created = createExecution(query);
  expect(created.ok).toBe(true);
  if (!created.ok) return;
  const first = created.data.attempt;
  const ended = finishExecution({
    ...query,
    attemptId: first.id,
    expectedRevision: first.revision,
    outcome: "succeeded",
    summary: "Browser implementation evidence",
  });
  expect(ended.ok).toBe(true);
  if (!ended.ok) return;
  const verified = verifyExecution({
    ...query,
    attemptId: first.id,
    expectedRevision: ended.data.attempt.revision,
    command: "fixture assertions",
    outcome: "passed",
    evidence: "All assertions passed",
  });
  expect(verified.ok).toBe(true);
  if (!verified.ok) return;
  await page.goto(`${workbench.origin}/#/projects/alpha/backlog/ALP-001`);
  const panel = page.getByRole("region", { name: "任务执行" });
  await expect(panel).toContainText("Browser implementation evidence");
  await expect(panel).toContainText("fixture assertions");
  await panel.getByText("查看冻结输入", { exact: true }).click();
  await expect(panel).toContainText("Browser authority");
  await panel.getByText("查看 diff 与文件", { exact: true }).click();
  await expect(panel).toContainText("README.md");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload();
  await expect(panel).toContainText(first.id);
  await panel.getByLabel("验收或状态核对说明").fill("Reviewed browser evidence");
  const reverified = verifyExecution({
    ...query,
    attemptId: first.id,
    expectedRevision: verified.data.attempt.revision,
    command: "recheck",
    outcome: "passed",
    evidence: "Checked again",
  });
  expect(reverified.ok).toBe(true);
  await panel.getByRole("button", { name: "接受本次结果" }).click();
  await expect(panel).toContainText("REVISION_MISMATCH");
  await expect(panel.getByLabel("验收或状态核对说明")).toHaveValue("Reviewed browser evidence");
  expect(JSON.parse(workbench.cli(["backlog", "show", "alpha", "ALP-001", "--json"])).status).toBe(
    "todo",
  );
  await panel.getByRole("button", { name: "接受本次结果" }).click();
  await expect(panel).toContainText("验收结论：已接受");
  expect(JSON.parse(workbench.cli(["backlog", "show", "alpha", "ALP-001", "--json"])).status).toBe(
    "done",
  );
});

test("controlled runner survives reload, separates stop request and confirmation, and records a retry", async ({
  workbench,
  page,
}) => {
  const { execFileSync } = await import("node:child_process");
  const { startWorkbenchServer } = await import("../../src/server/workbenchServer.js");
  const path = await import("node:path");
  execFileSync("git", ["init"], { cwd: `${workbench.root}/alpha`, stdio: "ignore" });
  let finish!: (result: { outcome: "stopped"; summary: string }) => void;
  let stopRequested = false;
  let starts = 0;
  const server = await startWorkbenchServer({
    workspaceDir: workbench.root,
    port: 0,
    staticDir: path.resolve("dist/web"),
    runner: {
      start() {
        starts++;
        return {
          completion: new Promise((resolve) => {
            finish = resolve;
          }),
          stop() {
            stopRequested = true;
          },
        };
      },
    },
  });
  try {
    await page.goto(`${server.origin}/#/projects/alpha/backlog/ALP-001`);
    const panel = page.getByRole("region", { name: "任务执行" });
    await panel.getByRole("button", { name: "开始工作" }).click();
    await expect(panel).toContainText("运行中");
    await page.reload();
    await expect(panel.getByRole("button", { name: "请求停止" })).toBeVisible();
    expect(starts).toBe(1);
    await panel.getByRole("button", { name: "请求停止" }).click();
    await expect(panel).toContainText("已请求停止，等待确认");
    expect(stopRequested).toBe(true);
    await expect(panel.getByRole("button", { name: "用当前任务版本重试" })).toHaveCount(0);
    finish({ outcome: "stopped", summary: "Runner confirmed stopped" });
    await panel.getByRole("button", { name: "刷新执行记录" }).click();
    await expect(panel).toContainText("Runner confirmed stopped");
    await panel.getByRole("button", { name: "用当前任务版本重试" }).click();
    await expect.poll(() => starts).toBe(2);
    await expect(panel.locator("[data-execution-id]")).toHaveCount(2);
    finish({ outcome: "stopped", summary: "Retry cleanup" });
  } finally {
    await server.close();
  }
});

test("failed verification and missing evidence remain visible; rework preserves the decision", async ({
  workbench,
  page,
}) => {
  const { execFileSync } = await import("node:child_process");
  const { rmSync } = await import("node:fs");
  const { createExecution, finishExecution, verifyExecution } = await import(
    "../../src/application/executionApi.js"
  );
  execFileSync("git", ["init"], { cwd: `${workbench.root}/alpha`, stdio: "ignore" });
  const query = { workspaceDir: workbench.root, projectId: "alpha", itemId: "ALP-001" };
  const created = createExecution(query);
  expect(created.ok).toBe(true);
  if (!created.ok) return;
  const ended = finishExecution({
    ...query,
    attemptId: created.data.attempt.id,
    expectedRevision: created.data.attempt.revision,
    outcome: "succeeded",
    summary: "Needs more work",
  });
  expect(ended.ok).toBe(true);
  if (!ended.ok) return;
  const verified = verifyExecution({
    ...query,
    attemptId: ended.data.attempt.id,
    expectedRevision: ended.data.attempt.revision,
    command: "failed check",
    outcome: "failed",
    evidence: "Regression remains",
  });
  expect(verified.ok).toBe(true);
  if (!verified.ok) return;
  rmSync(
    `${workbench.root}/ops/alpha/executions/${verified.data.attempt.verifications[0]!.evidence_ref}`,
  );
  await page.goto(`${workbench.origin}/#/projects/alpha/backlog/ALP-001`);
  const panel = page.getByRole("region", { name: "任务执行" });
  await expect(panel).toContainText("失败");
  await expect(panel).toContainText("证据不可读");
  await expect(panel.getByRole("button", { name: "接受本次结果" })).toBeDisabled();
  await panel.getByLabel("验收或状态核对说明").fill("Fix regression and attach evidence");
  await panel.getByRole("button", { name: "要求继续修改" }).click();
  await expect(panel).toContainText("验收结论：要求继续修改");
  await expect(panel).toContainText("Fix regression and attach evidence");
  expect(JSON.parse(workbench.cli(["backlog", "show", "alpha", "ALP-001", "--json"])).status).toBe(
    "todo",
  );
});

test("orphaned runtime work requires an explicit inspection before interruption confirmation", async ({
  workbench,
  page,
}) => {
  const { createExecution } = await import("../../src/application/executionApi.js");
  const { startWorkbenchServer } = await import("../../src/server/workbenchServer.js");
  const path = await import("node:path");
  const created = createExecution({
    workspaceDir: workbench.root,
    projectId: "alpha",
    itemId: "ALP-001",
    origin: "runtime",
  });
  expect(created.ok).toBe(true);
  const server = await startWorkbenchServer({
    workspaceDir: workbench.root,
    port: 0,
    staticDir: path.resolve("dist/web"),
  });
  try {
    await page.goto(`${server.origin}/#/projects/alpha/backlog/ALP-001`);
    const panel = page.getByRole("region", { name: "任务执行" });
    await expect(panel).toContainText("运行状态待确认");
    await expect(panel.getByRole("button", { name: "已核对停止，确认中断" })).toBeDisabled();
    await panel.getByLabel("验收或状态核对说明").fill("Inspected old process: stopped");
    await panel.getByRole("button", { name: "已核对停止，确认中断" }).click();
    await expect(panel).toContainText("已停止");
    await expect(panel).toContainText("启动不可用：服务端尚未配置 runner");
    await expect(panel.getByRole("button", { name: "用当前任务版本重试" })).toBeDisabled();
  } finally {
    await server.close();
  }
});
