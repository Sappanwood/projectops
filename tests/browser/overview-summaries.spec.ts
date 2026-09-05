import { writeFileSync } from "node:fs";
import path from "node:path";
import { test, expect } from "./fixture.js";

test("Overview counts active previews and refreshes live progress without changing report outcomes", async ({
  workbench,
  page,
}) => {
  for (let i = 0; i < 6; i++)
    workbench.cli([
      "backlog",
      "add",
      "alpha",
      "-T",
      `Pending ${i}`,
      "-c",
      "feature",
      "--priority",
      "P1",
    ]);
  workbench.cli(["backlog", "update", "alpha", "ALP-007", "--status", "in_progress"]);
  await page.goto(`${workbench.origin}/#/projects/alpha`);
  const backlog = page.locator('[aria-labelledby="card-backlog-title"]');
  const plan = page.locator('[aria-labelledby="card-plans-title"]');
  const reports = page.locator('[aria-labelledby="card-reports-title"]');
  await expect(backlog).toContainText("展示 5 / 共 7 条");
  await expect(backlog.locator(".item-title").first()).toHaveText("Pending 5");
  await expect(plan).toContainText("任务完成 0 / 1 · 0%");
  const api = await page.request.get(`${workbench.origin}/api/projects/alpha`);
  const data = (await api.json()).data;
  expect(data.backlog.mode).toBe("active");
  expect(data.plans[0].execution.counts.todo).toBe(1);
  for (let i = 1; i <= 7; i++)
    workbench.cli([
      "backlog",
      "update",
      "alpha",
      `ALP-${String(i).padStart(3, "0")}`,
      "--status",
      "done",
    ]);
  await page.getByRole("button", { name: "Refresh workspace and project data" }).click();
  await expect(backlog).toContainText("当前没有进行中或待办任务");
  await expect(backlog).toContainText("最近更新");
  await expect(plan).toContainText("任务完成 1 / 1 · 100%");
  await expect(plan).toContainText("approved");
  await expect(reports).toContainText("partial");
});

test("Overview limits Plan previews and distinguishes domain errors from empty lists", async ({
  workbench,
  page,
}) => {
  for (let i = 0; i < 6; i++)
    writeFileSync(
      path.join(workbench.root, `ops/alpha/plans/plan-new-${i}.json`),
      JSON.stringify({
        schema: "plan/Plan@1",
        id: `plan-new-${i}`,
        title: `Draft ${i}`,
        goal: "Fixture",
        status: "draft",
        items: [
          {
            key: "one",
            title: "Fixture",
            item_type: "task",
            priority: "P1",
            body: "Fixture",
            depends_on: [],
          },
        ],
      }),
    );
  writeFileSync(path.join(workbench.root, "ops/alpha/reports/report-broken.md"), "bad");
  await page.goto(`${workbench.origin}/#/projects/alpha`);
  const plans = page.locator('[aria-labelledby="card-plans-title"]');
  await expect(plans).toContainText("展示 5 / 共 7 条");
  await expect(plans.locator(".item-row")).toHaveCount(5);
  await expect(plans).toContainText("未开始执行");
  const reports = page.locator('[aria-labelledby="card-reports-title"]');
  await expect(reports).toContainText("展示 1 / 已读取 1 条");
  await expect(reports).toContainText("部分数据无法读取");
  await expect(reports.getByRole("link", { name: "Browser report" })).toBeVisible();
  await page.goto(`${workbench.origin}/#/projects/empty`);
  await expect(page.locator('[aria-labelledby="card-plans-title"]')).toContainText("暂无计划");
  await expect(page.locator('[aria-labelledby="card-backlog-title"]')).toContainText("暂无任务");
});
