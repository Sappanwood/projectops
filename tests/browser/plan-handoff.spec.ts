import { writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "./fixture.js";

test("copy uses displayed revision and external revision preserves the local draft", async ({
  workbench,
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async () => {
          throw new Error("Denied");
        },
      },
    }),
  );
  await page.goto(`${workbench.origin}/#/projects/alpha/plans/plan-browser`);
  await page.getByRole("button", { name: "复制计划引用", exact: true }).click();
  const copied = page.getByLabel("手动复制上下文");
  const current = JSON.parse(workbench.cli(["plan", "show", "alpha", "plan-browser", "--json"]));
  await expect(copied).toHaveValue(new RegExp(current.revision));
  await expect(copied).toHaveValue(/pops plan show alpha plan-browser --json/);
  await page.getByRole("button", { name: "复制任务上下文", exact: true }).click();
  await expect(copied).toHaveValue(/Task key: ui/);
  await expect(copied).toHaveValue(/Verify UI/);
  await page.getByRole("button", { name: "修订计划", exact: true }).click();
  const editor = page.getByLabel("计划 JSON 草案");
  await expect(editor).toHaveValue(/Validate production UI/);
  await expect(editor).toBeEnabled();
  const local = JSON.parse(await editor.inputValue());
  local.goal = "Local unsaved goal";
  await editor.fill(JSON.stringify(local));
  await page.getByRole("button", { name: "预览修订", exact: true }).click();
  await expect(page.getByRole("button", { name: "确认应用修订" })).toBeEnabled();
  const input = path.join(workbench.root, "external.json");
  writeFileSync(input, JSON.stringify({ ...current, goal: "External reviewed goal" }));
  const args = [
    "plan",
    "revise",
    "alpha",
    "plan-browser",
    "--input",
    input,
    "--expected-revision",
    current.revision,
  ];
  const preview = JSON.parse(workbench.cli([...args, "--json"]));
  workbench.cli([...args, "--confirm", preview.confirmation_token]);
  await page.getByRole("tab", { name: "执行与结果", exact: true }).click();
  await page.getByRole("tab", { name: "审阅计划", exact: true }).click();
  await expect(editor).toHaveValue(JSON.stringify(local));
  await page.getByRole("button", { name: "Refresh workspace and project data" }).click();
  await expect(page.locator(".plan-goal")).toHaveText("External reviewed goal");
  await expect(editor).toHaveValue(JSON.stringify(local));
  await expect(page.locator("[data-foundation-plan]")).toContainText("版本已变化");
  await expect(page.getByRole("button", { name: "确认应用修订" })).toHaveCount(0);
  await page.getByRole("button", { name: "重读版本并保留计划草案" }).click();
  await page.getByRole("button", { name: "预览修订", exact: true }).click();
  await page.getByRole("button", { name: "确认应用修订" }).click();
  await expect(page.locator(".plan-goal")).toHaveText("Local unsaved goal");
});

test("execution tab and reading position survive task navigation and a refresh", async ({
  workbench,
  page,
}) => {
  await page.goto(`${workbench.origin}/#/projects/alpha/plans/plan-browser?tab=execution`);
  const progress = page.getByRole("region", { name: "执行进度", exact: true });
  await progress.getByRole("link", { name: /ALP-001/ }).click();
  await page.getByRole("link", { name: "返回原 Plan", exact: true }).click();
  await expect(page).toHaveURL(/tab=execution/);
  await expect(progress).toBeVisible();
  await page.getByRole("tab", { name: "审阅计划", exact: true }).click();
  await page.getByRole("button", { name: "修订计划", exact: true }).click();
  const editor = page.getByLabel("计划 JSON 草案");
  await expect(editor).toHaveValue(/Validate production UI/);
  await expect(editor).toBeEnabled();
  await editor.focus();
  const position = await page.evaluate(() => scrollY);
  await page.getByRole("tab", { name: "执行与结果", exact: true }).click();
  await page.goBack();
  await expect(editor).toBeVisible();
  await editor.focus();
  await page.evaluate(() => document.getElementById("btn-refresh")!.click());
  await expect(page.getByText("正在刷新，暂显示上次读取内容。", { exact: true })).toHaveCount(0);
  await expect(editor).toBeFocused();
  expect(Math.abs((await page.evaluate(() => scrollY)) - position)).toBeLessThan(80);
});

test("copy success, failed refresh and missing plan keep clear feedback and recoverable draft", async ({
  workbench,
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (text: string) => {
          (window as unknown as { copied: string }).copied = text;
        },
      },
    });
  });
  await page.goto(`${workbench.origin}/#/projects/alpha/plans/plan-browser`);
  await page.getByRole("button", { name: "复制计划引用", exact: true }).click();
  await expect(page.getByText("已复制当前阅读版本的上下文。", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { copied: string }).copied)).toContain(
    "Reference: project-ops:plans/plan-browser.json",
  );
  await page.getByRole("button", { name: "修订计划", exact: true }).click();
  const editor = page.getByLabel("计划 JSON 草案");
  await expect(editor).toHaveValue(/Validate production UI/);
  await editor.fill("unsaved draft to recover");
  await page.route("**/api/projects/alpha/read-pages", (route) =>
    route.fulfill({
      status: 500,
      json: { ok: false, error: { code: "READ_FAILED", message: "Fixture read failed" } },
    }),
  );
  await page.getByRole("button", { name: "Refresh workspace and project data" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Fixture read failed" })).toContainText(
    "刷新未成功",
  );
  await expect(editor).toHaveValue("unsaved draft to recover");
  await page.unroute("**/api/projects/alpha/read-pages");
  const { rmSync } = await import("node:fs");
  rmSync(path.join(workbench.root, "ops/alpha/plans/plan-browser.json"));
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByText("Plan 不存在或无法读取。", { exact: true })).toBeVisible();
  await expect(editor).toHaveValue("unsaved draft to recover");
});

test("manual refresh discovers a run created outside the App", async ({ workbench, page }) => {
  const input = path.join(workbench.root, "fresh-run.json");
  writeFileSync(
    input,
    JSON.stringify({
      title: "Refresh runs",
      goal: "Refresh run facts",
      items: [
        { key: "task", title: "Run task", item_type: "task", priority: "P1", body: "Verify" },
      ],
    }),
  );
  workbench.cli(["plan", "create", "alpha", "--input", input]);
  workbench.cli([
    "plan",
    "approve",
    "alpha",
    "plan-refresh-runs",
    "--review-note",
    "Isolated fixture",
  ]);
  workbench.cli(["plan", "materialize", "alpha", "plan-refresh-runs"]);
  await page.goto(`${workbench.origin}/#/projects/alpha/plans/plan-refresh-runs`);
  await expect(page.locator("[data-plan-run-panel]")).toContainText("尚无计划执行");
  const { execFileSync } = await import("node:child_process");
  execFileSync("git", ["init", "-q"], { cwd: path.join(workbench.root, "alpha") });
  const plan = JSON.parse(workbench.cli(["plan", "show", "alpha", "plan-refresh-runs", "--json"]));
  workbench.cli([
    "plan-run",
    "create",
    "alpha",
    "plan-refresh-runs",
    "--expected-revision",
    plan.revision,
  ]);
  await page.getByRole("button", { name: "Refresh workspace and project data" }).click();
  await expect(page.locator("[data-plan-run-notice]")).toContainText("1 个未结束运行");
  await page.getByRole("link", { name: "查看串行执行", exact: true }).click();
  await expect(page.getByRole("button", { name: "启动计划执行", exact: true })).toBeVisible();
});
