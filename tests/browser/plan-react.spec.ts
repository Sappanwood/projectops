import { mkdirSync } from "node:fs";
import { expect, test } from "./fixture.js";

test("Plan refresh preserves the text being reviewed and task expansion", async ({
  workbench,
  page,
}) => {
  await page.goto(`${workbench.origin}/#/projects/alpha/plans/plan-browser`);
  const goal = page.locator(".plan-goal");
  await expect(goal).toBeVisible();
  await page.getByRole("button", { name: "全部折叠", exact: true }).click();
  const selected = await goal.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    return selection.toString();
  });
  expect(selected.length).toBeGreaterThan(0);
  const before = workbench.snapshot();
  mkdirSync("/tmp/projectops-plan-polish", { recursive: true });
  if (process.env.PLAN_VISUAL_BEFORE) {
    for (const width of [1440, 1024, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.screenshot({ path: `/tmp/projectops-plan-polish/before-${width}.png` });
    }
  }
  await page
    .getByRole("button", { name: "Refresh workspace and project data" })
    .evaluate((element: HTMLButtonElement) => element.click());
  await expect(
    page.getByRole("button", { name: "Refresh workspace and project data" }),
  ).toBeEnabled();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(selected);
  await expect(page.locator(".plan-task[open]")).toHaveCount(0);
  expect(workbench.snapshot()).toEqual(before);
});

test("Plan React page navigates across workbench pages and returns without browser errors", async ({
  workbench,
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${workbench.origin}/#/projects/alpha/plans/plan-browser`);
  await expect(page.locator(".plan-goal")).toHaveText("Validate production UI");
  mkdirSync("/tmp/projectops-plan-polish", { recursive: true });
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: `/tmp/projectops-plan-polish/after-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.getByRole("tab", { name: /^Backlog/ }).click();
  await expect(page.getByRole("button", { name: /ALP-001 — Browser task/ })).toBeVisible();
  await page.getByRole("tab", { name: /^Plans/ }).click();
  await expect(page.locator(".plan-list-row")).toContainText("Browser plan");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "/tmp/projectops-plan-polish/list-1440.png" });
  await page.locator(".plan-list-row").click();
  await page.getByRole("tab", { name: "审阅计划", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "执行与结果", exact: true })).toBeFocused();
  await expect(page.getByRole("region", { name: "执行进度", exact: true })).toBeVisible();
  await page.screenshot({ path: "/tmp/projectops-plan-polish/execution-1440.png" });
  expect(errors).toEqual([]);
});
