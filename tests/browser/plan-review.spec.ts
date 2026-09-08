import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "./fixture.js";

test("draft opens a dedicated review with continuous reading and secondary execution", async ({
  workbench,
  page,
}) => {
  const input = path.join(workbench.root, "review.json");
  writeFileSync(
    input,
    JSON.stringify({
      title: "Review first",
      goal: "人类审阅完整方案。".repeat(40),
      items: Array.from({ length: 12 }, (_, i) => ({
        key: `task${i}`,
        title: `任务 ${i + 1}：审阅方案与验收要求`,
        item_type: "task",
        priority: "P1",
        body: `## 范围\n第 ${i + 1} 项方案正文。\n\n## 验收\n能够连续阅读与定位。`,
      })),
    }),
  );
  workbench.cli(["plan", "create", "alpha", "--input", input]);
  const beforeNavigation = workbench.snapshot();
  await page.goto(`${workbench.origin}/#/projects/alpha/plans/plan-review-first`);
  const card = page.locator('[data-plan-id="plan-review-first"]');
  await expect(card).toBeVisible();
  mkdirSync("/tmp/projectops-review-visual", { recursive: true });
  if (process.env.REVIEW_BEFORE) {
    for (const width of [1440, 1024, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.screenshot({ path: `/tmp/projectops-review-visual/before-${width}.png` });
    }
  }
  await expect(page.getByRole("tab", { name: "审阅计划", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator('[data-plan-id="plan-browser"]')).toHaveCount(0);
  await expect(card.locator(".plan-task[open]")).toHaveCount(12);
  await expect(card.getByRole("region", { name: "执行工作区", exact: true })).not.toBeVisible();
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: `/tmp/projectops-review-visual/after-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await card.locator(".plan-toc-button").nth(5).click();
  await page.screenshot({ path: "/tmp/projectops-review-visual/after-tasks-1440.png" });
  const reviewTab = page.getByRole("tab", { name: "审阅计划", exact: true });
  await reviewTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "执行与结果", exact: true })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(reviewTab).toBeFocused();
  await card.getByRole("button", { name: "全部折叠", exact: true }).click();
  await expect(card.locator(".plan-task[open]")).toHaveCount(0);
  await card.getByRole("button", { name: "全部展开", exact: true }).click();
  await expect(card.locator(".plan-task[open]")).toHaveCount(12);
  await page.getByRole("tab", { name: "执行与结果", exact: true }).click();
  await expect(page).toHaveURL(/tab=execution/);
  await expect(card.getByRole("region", { name: "执行工作区", exact: true })).toBeVisible();
  await expect(card.locator(".plan-task").first()).not.toBeVisible();
  await page.goBack();
  await expect(page.getByRole("tab", { name: "审阅计划", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("link", { name: "返回 Plans", exact: true }).click();
  await expect(page.locator(".plan-list-row").first()).toContainText("Review first");
  expect(workbench.snapshot()).toEqual(beforeNavigation);
});
