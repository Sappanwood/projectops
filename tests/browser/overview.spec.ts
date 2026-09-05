import { test, expect } from "./fixture.js";

test("Overview keeps long titles, IDs and metadata readable at every viewport", async ({ workbench, page }, testInfo) => {
  await page.route("**/api/projects/alpha", async route => {
    const response = await route.fetch();
    const payload = await response.json();
    for (const item of [...payload.data.plans, ...payload.data.reports, ...payload.data.backlog.recent]) {
      item.title = "完整标题需要换行阅读而不能隐藏".repeat(8);
      item.id += "-" + "unbroken".repeat(24);
    }
    for (const item of payload.data.retrospectives.recent) {
      item.id += "-" + "unbroken".repeat(24);
      item.path += "unbroken".repeat(24);
    }
    await route.fulfill({ response, json: payload });
  });
  await page.goto(`${workbench.origin}/#/projects/alpha`);
  await expect(page.locator(".overview-card")).toHaveCount(5);
  await expect(page.locator(".overview-card .item-title").first()).toContainText("完整标题需要换行阅读而不能隐藏");
  for (const width of [375, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.locator(".overview-card, .overview-card .item-title, .workbench-header, .project-nav").evaluateAll(elements =>
      elements.filter(element => element.scrollWidth > element.clientWidth + 1).map(element => element.className));
    expect(overflow, `overflow at ${width}px`).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator(".overview-card h3")).toHaveText(["Plans (1)", "Backlog", "Reports (1)", "Retrospectives", "Project Docs"]);
    const cards = await page.locator(".overview-card").evaluateAll(elements => elements.map(element => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    }));
    if (width >= 1024) {
      expect(cards[0]!.y).toBe(cards[1]!.y);
      expect(cards[4]!.width).toBeGreaterThan(cards[0]!.width * 2);
    } else expect(cards[1]!.y).toBeGreaterThan(cards[0]!.y);
    await page.screenshot({ path: testInfo.outputPath(`overview-${width}.png`), fullPage: true });
  }
});
