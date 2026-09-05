import { writeFileSync } from "node:fs";
import path from "node:path";
import { test, expect } from "./fixture.js";

test("Plan lifecycle shows no report, partial and completed snapshots with return navigation", async ({
  workbench,
  page,
}) => {
  const input = path.join(workbench.root, "delivery.json");
  writeFileSync(
    input,
    JSON.stringify({
      title: "Final delivery",
      goal: "Full workflow",
      items: [
        {
          key: "first",
          title: "First delivery task",
          item_type: "task",
          priority: "P1",
          body: "First scope",
        },
        {
          key: "second",
          title: "Second delivery task",
          item_type: "task",
          priority: "P1",
          body: "Second scope",
          depends_on: ["first"],
        },
      ],
    }),
  );
  workbench.cli(["plan", "create", "alpha", "--input", input]);
  workbench.cli([
    "plan",
    "approve",
    "alpha",
    "plan-final-delivery",
    "--review-note",
    "Fixture approval",
  ]);
  const { mapping } = JSON.parse(
    workbench.cli(["plan", "materialize", "alpha", "plan-final-delivery", "--json"]),
  );
  await page.goto(`${workbench.origin}/#/projects/alpha/plans/plan-final-delivery`);
  const plan = page.locator('.plan-card[data-plan-id="plan-final-delivery"]');
  const reports = plan.getByRole("region", { name: "交付报告" });
  await expect(reports).toContainText("尚无交付报告");
  const update = (id: string, status: string) => {
    const item = JSON.parse(workbench.cli(["backlog", "show", "alpha", id, "--json"]));
    workbench.cli([
      "backlog",
      "update",
      "alpha",
      id,
      "--status",
      status,
      "--expected-revision",
      item.revision,
    ]);
  };
  update(mapping.first, "done");
  workbench.cli([
    "report",
    "create",
    "alpha",
    "plan-final-delivery",
    "--report-id",
    "report-partial",
    "--verification",
    "Fixture first task complete",
    "--partial-acceptance",
    "Fixture accepts pending second task",
  ]);
  await page.getByRole("button", { name: "Refresh workspace and project data" }).click();
  await expect(plan.getByRole("region", { name: "执行进度" })).toContainText("1/2 已完成");
  await expect(plan.getByRole("region", { name: "可开始任务" })).toContainText(mapping.second);
  await expect(reports).toContainText("partial");
  update(mapping.second, "done");
  workbench.cli([
    "report",
    "create",
    "alpha",
    "plan-final-delivery",
    "--report-id",
    "report-completed",
    "--verification",
    "Fixture all tasks complete",
  ]);
  const before = workbench.snapshot();
  await page.getByRole("button", { name: "Refresh workspace and project data" }).click();
  await expect(plan.getByRole("region", { name: "执行进度" })).toContainText("2/2 已完成");
  await expect(reports.getByRole("link")).toHaveCount(2);
  await reports.getByRole("link", { name: /report-completed/ }).click();
  await expect(page).toHaveURL(/\/reports\/report-completed\?plan=plan-final-delivery$/);
  const report = page.locator('[data-report-id="report-completed"]');
  await expect(report).toBeVisible();
  await expect(report).toContainText("Fixture all tasks complete");
  await page.reload();
  await expect(report).toContainText("Fixture all tasks complete");
  await page.getByRole("link", { name: "返回原 Plan" }).click();
  await expect(reports).toBeVisible();
  await expect(reports).toContainText("partial");
  await expect(reports).toContainText("completed");
  expect(workbench.snapshot()).toEqual(before);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
