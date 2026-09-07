import { test, expect } from "./fixture.js";

test("cross-project dependency editor preserves conflicts, refreshes readiness and returns to origin", async ({
  workbench,
  page,
}) => {
  workbench.cli([
    "backlog",
    "add",
    "empty",
    "-T",
    "Shared staging API with a long descriptive title",
    "-c",
    "feature",
    "--priority",
    "P1",
  ]);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${workbench.origin}/#/projects/alpha/backlog/ALP-001`);
  await page.screenshot({
    path: "/tmp/projectops-cross-project-plan/pro062-before.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "编辑依赖", exact: true }).click();
  const panel = page.locator("[data-dependency-panel]");
  await panel.getByLabel("依赖项目").selectOption("empty");
  await expect(panel.getByLabel("依赖任务")).toContainText("Shared staging API");
  await panel.getByLabel("依赖任务").focus();
  await panel.getByLabel("依赖任务").selectOption("EMP-001");
  await expect(panel.getByLabel("依赖任务")).toBeFocused();
  await panel.getByRole("button", { name: "添加依赖", exact: true }).click();
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
  await panel.getByRole("button", { name: "保存依赖", exact: true }).click();
  await expect(panel).toContainText("REVISION_MISMATCH");
  await expect(panel.locator("[data-dependency-draft]")).toContainText("empty:EMP-001");
  await page.screenshot({
    path: "/tmp/projectops-cross-project-plan/pro062-conflict.png",
    fullPage: true,
  });
  await panel.getByRole("button", { name: "重读版本并保留依赖草稿" }).click();
  await panel.getByRole("button", { name: "保存依赖", exact: true }).click();
  await expect(panel).toContainText("尚未满足");
  await page.screenshot({
    path: "/tmp/projectops-cross-project-plan/pro062-desktop.png",
    fullPage: true,
  });
  await panel.locator("[data-direct-dependencies] a").click();
  await expect(page).toHaveURL(/projects\/empty\/backlog\/EMP-001\?from=/);
  await expect(panel.locator("[data-dependent-tasks]")).toContainText("alpha:ALP-001");
  await page.reload();
  await page.getByRole("link", { name: "返回来源" }).click();
  await expect(page).toHaveURL(/projects\/alpha\/backlog\/ALP-001$/);
  await page.goBack();
  await expect(page).toHaveURL(/projects\/empty\/backlog/);
  await page.goForward();
  await expect(page).toHaveURL(/projects\/alpha\/backlog\/ALP-001$/);
  const upstream = JSON.parse(workbench.cli(["backlog", "show", "empty", "EMP-001", "--json"]));
  workbench.cli([
    "backlog",
    "update",
    "empty",
    "EMP-001",
    "--status",
    "done",
    "--expected-revision",
    upstream.revision,
  ]);
  await panel.getByRole("button", { name: "刷新依赖关系" }).click();
  await expect(panel.locator("[data-direct-dependencies]")).toContainText("已满足");
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "/tmp/projectops-cross-project-plan/pro062-narrow.png",
    fullPage: false,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await panel.getByRole("button", { name: "编辑依赖", exact: true }).click();
  await panel.getByRole("button", { name: "移除 empty:EMP-001" }).click();
  await panel.getByRole("button", { name: "保存依赖", exact: true }).click();
  await expect(panel.locator("[data-direct-dependencies]")).toContainText("无直接前置");
});

test("dependency read failure recovers and invalid references retain the draft", async ({
  workbench,
  page,
}) => {
  workbench.cli([
    "backlog",
    "add",
    "empty",
    "-T",
    "Temporary upstream",
    "-c",
    "feature",
    "--priority",
    "P1",
  ]);
  await page.goto(`${workbench.origin}/#/projects/alpha/backlog/ALP-001`);
  const panel = page.locator("[data-dependency-panel]");
  await expect(panel).toContainText("无直接前置");
  await page.route("**/backlog/ALP-001/dependencies", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        error: { code: "READ_FAILED", message: "Fixture unavailable" },
      }),
    }),
  );
  await panel.getByRole("button", { name: "刷新依赖关系" }).click();
  await expect(panel).toContainText("READ_FAILED");
  await expect(panel).toContainText("无直接前置");
  await page.unroute("**/backlog/ALP-001/dependencies");
  await panel.getByRole("button", { name: "刷新依赖关系" }).click();
  await expect(panel).not.toContainText("READ_FAILED");
  await panel.getByRole("button", { name: "编辑依赖", exact: true }).click();
  await panel.getByLabel("依赖项目").selectOption("empty");
  await expect(panel.getByLabel("依赖任务")).toContainText("Temporary upstream");
  await panel.getByLabel("依赖任务").selectOption("EMP-001");
  await panel.getByRole("button", { name: "添加依赖", exact: true }).click();
  const { renameSync } = await import("node:fs");
  renameSync(
    `${workbench.root}/ops/empty/backlog/items/EMP-001.md`,
    `${workbench.root}/ops/empty/backlog/items/EMP-001.hidden`,
  );
  await panel.getByRole("button", { name: "保存依赖", exact: true }).click();
  await expect(panel.locator("[data-dependency-draft]")).toContainText("empty:EMP-001");
  await expect(panel).toContainText("NOT_FOUND");
  await page.setViewportSize({ width: 1024, height: 900 });
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "/tmp/projectops-cross-project-plan/pro062-invalid-1024.png",
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
