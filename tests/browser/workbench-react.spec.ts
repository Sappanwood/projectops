import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "./fixture.js";

test("workbench pages share navigation and stay readable at desktop and mobile widths", async ({
  page,
  workbench,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  writeFileSync(
    path.join(workbench.root, "ops/alpha/research/review.md"),
    "# Research review\n\nA document for reviewing agent findings.\n\n## Evidence\n\nReview the source and the conclusion together.",
  );
  const output = "/tmp/projectops-workbench-polish";
  mkdirSync(output, { recursive: true });
  const before = workbench.snapshot();
  for (const [view, target] of [
    ["workspace", ""],
    ["overview", "projects/alpha"],
    ["backlog", "projects/alpha/backlog/ALP-001"],
    ["reports", "projects/alpha/reports/report-browser"],
    ["docs", "projects/alpha/docs"],
    ["research", "projects/alpha/research?path=review.md"],
    ["retrospectives", "projects/alpha/retrospectives/browser"],
  ]) {
    await page.goto(`${workbench.origin}/#/${target}`);
    await expect(
      page.getByRole("button", { name: "Refresh workspace and project data" }),
    ).toBeEnabled();
    await expect(page.locator(".state-loading")).toHaveCount(0);
    if (view === "backlog") await expect(page.locator(".reading-header")).toBeVisible();
    if (view === "reports") await expect(page.locator("[data-report-id]")).toBeVisible();
    if (view === "retrospectives")
      await expect(page.locator("[data-retrospective-id]")).toBeVisible();
    if (view === "docs" || view === "research")
      await expect(page.locator(".document-content .markdown-content")).toBeVisible();
    for (const width of [1440, 1024, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.mouse.move(0, 0);
      await page.evaluate(() => {
        document.activeElement instanceof HTMLElement && document.activeElement.blur();
        scrollTo(0, 0);
      });
      await page.screenshot({
        path: `${output}/${process.env.WORKBENCH_VISUAL_BEFORE ? "before" : "after"}-${view}-${width}.png`,
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
  }
  expect(workbench.snapshot()).toEqual(before);
  expect(errors).toEqual([]);
});

test("task editor keeps a long review draft across page navigation and refresh", async ({
  page,
  workbench,
}) => {
  await page.goto(`${workbench.origin}/#/projects/alpha/backlog/ALP-001`);
  await page.getByRole("button", { name: "编辑任务内容", exact: true }).click();
  const title = "审阅 Agent 提交的方案与验证证据，确认范围、依赖和验收要求后再推进执行";
  const body = `## 验收要求\n\n${"确认每项改动都有可阅读的依据，并保留人类尚未提交的审阅草稿。\n\n".repeat(12)}`;
  await page.getByLabel("任务标题", { exact: true }).fill(title);
  await page.getByLabel("正文与验收要求").fill(body);
  await page.getByRole("tab", { name: /^Reports/ }).click();
  await expect(page.locator("[data-report-id]")).toBeVisible();
  await page.getByRole("tab", { name: /^Backlog/ }).click();
  await page.getByRole("button", { name: /ALP-001 — Browser task/ }).click();
  await expect(page.getByLabel("任务标题", { exact: true })).toHaveValue(title);
  await page.getByRole("button", { name: "Refresh workspace and project data" }).click();
  await expect(page.getByLabel("正文与验收要求")).toHaveValue(body);
  mkdirSync("/tmp/projectops-workbench-polish", { recursive: true });
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.getByLabel("任务标题", { exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("正文与验收要求")).toBeFocused();
    await page.screenshot({ path: `/tmp/projectops-workbench-polish/editor-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  expect(JSON.parse(workbench.cli(["backlog", "show", "alpha", "ALP-001", "--json"])).title).toBe(
    "Browser task",
  );
});

test("report refresh preserves selection, expanded evidence and shows recoverable read failures", async ({
  page,
  workbench,
}) => {
  await page.goto(`${workbench.origin}/#/projects/alpha/reports/report-browser`);
  const paragraph = page.locator("[data-report-id] .markdown-content p").first();
  await expect(paragraph).toBeVisible();
  const selected = await paragraph.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    return selection.toString();
  });
  const refresh = page.getByRole("button", { name: "Refresh workspace and project data" });
  await refresh.evaluate((element: HTMLButtonElement) => element.click());
  await expect(refresh).toBeEnabled();
  await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe(selected);
  await expect(page.locator("[data-report-id][open]")).toHaveCount(1);
  await page.route("**/api/projects/alpha/read-pages", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        error: { code: "UNAVAILABLE", message: "Read temporarily unavailable" },
      }),
    }),
  );
  await refresh.click();
  await expect(page.getByRole("alert")).toContainText("Read temporarily unavailable");
  await expect(paragraph).toBeVisible();
  await page.unroute("**/api/projects/alpha/read-pages");
  await page.locator("#read-pages-retry").click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(paragraph).toBeVisible();
});
