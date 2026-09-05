import { writeFileSync } from "node:fs";
import path from "node:path";
import { test, expect } from "./fixture.js";

test("Plan progress refreshes CLI state and diagnoses unreadable tasks without writes", async ({
  workbench,
  page,
}) => {
  await page.goto(`${workbench.origin}/#/projects/alpha/plans`);
  const plan = page.locator(".plan-card").filter({ hasText: "Browser plan" });
  await plan.locator(":scope > summary").click();
  const progress = plan.getByRole("region", { name: "执行进度" });
  await expect(progress).toContainText("0/1 已完成");
  await expect(progress).toContainText("待开始 1");
  await expect(progress.getByRole("progressbar")).toHaveAttribute("value", "0");
  const loaded = JSON.parse(workbench.cli(["backlog", "show", "alpha", "ALP-001", "--json"]));
  workbench.cli([
    "backlog",
    "update",
    "alpha",
    "ALP-001",
    "--status",
    "done",
    "--expected-revision",
    loaded.revision,
  ]);
  const before = workbench.snapshot();
  await page.getByRole("button", { name: "Refresh workspace and project data" }).click();
  await expect(progress).toBeVisible();
  await expect(progress).toContainText("1/1 已完成");
  await expect(progress).toContainText("100%");
  await expect(progress.getByRole("progressbar")).toHaveAttribute("value", "1");
  await expect(plan.locator(":scope > summary")).toContainText("已批准");
  expect(workbench.snapshot()).toEqual(before);
  writeFileSync(path.join(workbench.root, "ops/alpha/backlog/items/ALP-001.md"), "broken");
  const broken = workbench.snapshot();
  await page.getByRole("button", { name: "Refresh workspace and project data" }).click();
  await expect(progress).toContainText("0/1 已完成");
  await expect(progress).toContainText("无法读取 1");
  await expect(progress).toContainText("无法读取 ALP-001");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(progress).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(workbench.snapshot()).toEqual(broken);
});
