import { test, expect } from "./fixture.js";

test("Overview details support direct URLs, reloads, new tabs and return navigation", async ({
  workbench,
  page,
  context,
}) => {
  const before = workbench.snapshot();
  const overview = `${workbench.origin}/#/projects/alpha`;
  for (const [panel, target, detail] of [
    ["card-plans-title", "/plans/plan-browser", '[data-plan-id="plan-browser"]'],
    ["card-backlog-title", "/backlog/ALP-001", '[aria-label="Backlog item detail"]'],
    ["card-reports-title", "/reports/report-browser", '[data-report-id="report-browser"]'],
    ["card-retro-title", "/retrospectives/browser", '[data-retrospective-id="browser"]'],
  ]) {
    await page.goto(overview);
    const link = page.locator(`[aria-labelledby="${panel}"] .item-title`);
    await expect(link).toHaveAttribute("href", new RegExp(target!));
    const href = await link.getAttribute("href");
    await link.click();
    await expect(page.locator(detail!)).toBeVisible();
    await page.reload();
    await expect(page.locator(detail!)).toBeVisible();
    await page.getByRole("link", { name: "返回 Overview", exact: true }).click();
    await expect(page.locator(".overview-grid")).toBeVisible();
    const tab = await context.newPage();
    await tab.goto(`${workbench.origin}/${href}`);
    await expect(tab.locator(detail!)).toBeVisible();
    await tab.getByRole("link", { name: "返回 Overview", exact: true }).click();
    await expect(tab.locator(".overview-grid")).toBeVisible();
    await tab.close();
  }
  await page.locator('[aria-labelledby="card-retro-title"] .card-link').click();
  await expect(page.locator("#retro-project")).toHaveValue("alpha");
  await page.goto(
    `${workbench.origin}/#/projects/alpha/backlog/ALP-999?from=${encodeURIComponent("#/projects/alpha")}`,
  );
  await expect(page.getByRole("link", { name: "返回 Overview", exact: true })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Backlog item detail" }).getByRole("alert"),
  ).toContainText("ITEM_NOT_FOUND");
  expect(workbench.snapshot()).toEqual(before);
});

test("Overview restores its scroll position after explicit return and browser back", async ({
  workbench,
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await page.goto(`${workbench.origin}/#/projects/alpha`);
  const link = page.locator('[aria-labelledby="card-retro-title"] .item-title');
  for (const browserBack of [false, true]) {
    await link.scrollIntoViewIfNeeded();
    const position = await page.evaluate(() => scrollY);
    expect(position).toBeGreaterThan(200);
    await link.click();
    await expect(page.locator('[data-retrospective-id="browser"]')).toBeVisible();
    if (browserBack) await page.goBack();
    else await page.getByRole("link", { name: "返回 Overview", exact: true }).click();
    await expect(page.locator(".overview-grid")).toBeVisible();
    await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(position, 0);
  }
});
