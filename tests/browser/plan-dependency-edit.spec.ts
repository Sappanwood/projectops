import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "./fixture.js";

test("Plan dependency picker revises local and existing tasks and returns from cross-project links", async ({
  workbench,
  page,
}) => {
  workbench.cli([
    "backlog",
    "add",
    "empty",
    "-T",
    "Shared cloud API",
    "--priority",
    "P1",
    "-c",
    "feature",
    "-b",
    "Cloud prerequisite",
  ]);
  writeFileSync(
    path.join(workbench.root, "ops/alpha/plans/plan-browser.json"),
    JSON.stringify({
      schema: "plan/Plan@1",
      id: "plan-browser",
      title: "Browser plan",
      goal: "Cross-project cloud delivery",
      status: "draft",
      items: [
        {
          key: "api",
          title: "Local API client",
          item_type: "task",
          priority: "P1",
          body: "Local work",
          depends_on: [],
        },
        {
          key: "ui",
          title: "Browser task",
          item_type: "task",
          priority: "P1",
          body: "Use cloud",
          depends_on: [],
        },
      ],
    }),
  );
  await page.goto(`${workbench.origin}/#/projects/alpha/plans/plan-browser`);
  const card = page.locator('[data-plan-id="plan-browser"]');
  await page.getByRole("button", { name: "修订计划", exact: true }).click();
  const draft = page.getByLabel("计划 JSON 草案");
  await expect(draft).toHaveValue(/Cross-project cloud delivery/);
  await page.getByLabel("编辑依赖的任务").selectOption("ui");
  await page.getByLabel("Plan 内任务", { exact: true }).selectOption("api");
  await expect(draft).toHaveValue(/"api"/);
  await page.getByLabel("既有任务所属项目").focus();
  await page.getByLabel("既有任务所属项目").selectOption("empty");
  await expect(page.getByLabel("既有任务", { exact: true })).toContainText(
    "EMP-001 — Shared cloud API · todo",
  );
  await expect(page.getByLabel("既有任务所属项目")).toBeFocused();
  await page.getByLabel("既有任务", { exact: true }).selectOption("empty:EMP-001");
  await expect(draft).toHaveValue(/empty:EMP-001/);
  const fieldset = card.locator("fieldset");
  await fieldset
    .locator("li")
    .filter({ hasText: "empty:EMP-001" })
    .getByRole("button", { name: "移除" })
    .click();
  await expect(draft).not.toHaveValue(/empty:EMP-001/);
  await page.getByLabel("既有任务", { exact: true }).selectOption("empty:EMP-001");
  const validDraft = await draft.inputValue();
  const invalid = JSON.parse(validDraft);
  invalid.items[1].depends_on.push("missing:MIS-999");
  await draft.fill(JSON.stringify(invalid));
  await page.getByRole("button", { name: "预览修订" }).click();
  await expect(card.locator("[data-foundation-plan] [role=status]")).toContainText(
    /missing|PROJECT|ITEM|DEPENDENCY/i,
  );
  await expect(draft).toHaveValue(/missing:MIS-999/);
  await draft.fill(validDraft);
  await page.getByRole("button", { name: "预览修订" }).click();
  await expect(page.getByRole("button", { name: "确认应用修订" })).toBeEnabled();
  await page.getByRole("button", { name: "确认应用修订" }).click();
  await expect(card).toContainText("计划修订已保存");
  await expect(card).toContainText("Plan 内 2 项任务 · 既有依赖 1 项");
  mkdirSync("/tmp/projectops-cross-project-plan", { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "/tmp/projectops-cross-project-plan/pro062-plan-wide.png",
    fullPage: true,
  });
  await card
    .getByRole("region", { name: "既有任务依赖", exact: true })
    .getByRole("link", { name: "empty:EMP-001" })
    .click();
  await expect(page).toHaveURL(/projects\/empty\/backlog\/EMP-001/);
  await page.reload();
  await page.getByRole("link", { name: "返回来源页面" }).click();
  await expect(page).toHaveURL(/projects\/alpha\/plans\/plan-browser/);
  await expect(card).toContainText("既有依赖 1 项");
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.screenshot({
    path: "/tmp/projectops-cross-project-plan/pro062-plan-medium.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "/tmp/projectops-cross-project-plan/pro062-plan-narrow.png",
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  workbench.cli([
    "plan",
    "approve",
    "alpha",
    "plan-browser",
    "--review-note",
    "Reviewed dependency fixture",
  ]);
  const { mapping } = JSON.parse(
    workbench.cli(["plan", "materialize", "alpha", "plan-browser", "--json"]),
  );
  await page.reload();
  const uiTask = page.locator('[id="plan-browser--ui"]');
  await uiTask.locator(":scope > summary").click();
  await expect(uiTask.locator("[data-direct-dependencies]")).toContainText("Shared cloud API");
  await expect(uiTask.locator("[data-direct-dependencies]")).toContainText("尚未满足");
  await expect(page.locator('[id="plan-browser--api"] [data-dependent-tasks]')).toContainText(
    "Browser task",
  );
  await page.getByRole("button", { name: "修订计划", exact: true }).click();
  await expect(page.getByLabel("编辑依赖的任务")).toBeEnabled();
  await page.getByLabel("编辑依赖的任务").selectOption("ui");
  await card
    .locator("fieldset li")
    .filter({ hasText: "Plan 内任务" })
    .getByRole("button", { name: "移除" })
    .click();
  await page.getByRole("button", { name: "预览修订" }).click();
  await page.getByRole("button", { name: "确认应用修订" }).click();
  await expect(card).toContainText("计划修订已保存");
  const mapped = JSON.parse(workbench.cli(["backlog", "show", "alpha", mapping.ui, "--json"]));
  expect(mapped.depends_on).toEqual(["empty:EMP-001"]);
  await expect(uiTask.locator("[data-direct-dependencies]")).not.toContainText("Local API client");
  await expect(uiTask.locator("[data-direct-dependencies]")).toContainText("直接前置 (1)");
  const external = JSON.parse(workbench.cli(["backlog", "show", "empty", "EMP-001", "--json"]));
  workbench.cli([
    "backlog",
    "update",
    "empty",
    "EMP-001",
    "--status",
    "done",
    "--expected-revision",
    external.revision,
  ]);
  await uiTask.getByRole("button", { name: "刷新依赖关系" }).click();
  await expect(uiTask.locator("[data-direct-dependencies]")).toContainText("已满足");
  await expect(uiTask.locator("[data-direct-dependencies]")).not.toContainText("尚未满足");
  await page.getByRole("button", { name: "Refresh workspace and project data" }).click();
  await expect(card.getByRole("region", { name: "可开始任务", exact: true })).toContainText(
    "Browser task",
  );
  await page.screenshot({
    path: "/tmp/projectops-cross-project-plan/pro062-plan-materialized.png",
    fullPage: true,
  });
});
