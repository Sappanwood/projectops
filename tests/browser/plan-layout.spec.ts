import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "./fixture.js";

for (const width of [1440, 1024, 390]) {
  test(`Plan reading and run history stay usable at ${width}px`, async ({ workbench, page }) => {
    await page.setViewportSize({ width, height: 1000 });
    execFileSync("git", ["init", "-q"], { cwd: path.join(workbench.root, "alpha") });
    const input = path.join(workbench.root, "layout.json");
    writeFileSync(
      input,
      JSON.stringify({
        title: "Layout fixture",
        goal: "明确目标：在长任务列表中找到当前工作和下一步操作。".repeat(8),
        execution_policy: { max_parallel: 2 },
        items: Array.from({ length: 12 }, (_, i) => ({
          key: `task${i}`,
          title: `${i + 1} 长任务标题：保持目标、任务状态与当前执行操作的阅读顺序 `.repeat(3),
          item_type: "task",
          priority: "P1",
          body: "## 验收\n保持导航和执行控制可用。",
          parallel: true,
          resources: [`area${i}`],
        })),
      }),
    );
    workbench.cli(["plan", "create", "alpha", "--input", input]);
    workbench.cli([
      "plan",
      "approve",
      "alpha",
      "plan-layout-fixture",
      "--review-note",
      "Fixture only",
    ]);
    workbench.cli(["plan", "materialize", "alpha", "plan-layout-fixture"]);
    const plan = JSON.parse(
      workbench.cli(["plan", "show", "alpha", "plan-layout-fixture", "--json"]),
    );
    const created = JSON.parse(
      workbench.cli([
        "plan-run",
        "create",
        "alpha",
        "plan-layout-fixture",
        "--expected-revision",
        plan.revision,
        "--json",
      ]),
    );
    const base = created.data.run;
    let serial: any[] = [],
      parallel: any[] = [];
    await page.route("**/api/projects/alpha/plan-runs?*", (route) =>
      route.fulfill({
        json: {
          ok: true,
          data: {
            runs:
              new URL(route.request().url()).searchParams.get("plan_id") === "plan-layout-fixture"
                ? serial
                : [],
          },
        },
      }),
    );
    await page.route("**/api/projects/alpha/parallel-runs?*", (route) =>
      route.fulfill({
        json: {
          ok: true,
          data: {
            runs:
              new URL(route.request().url()).searchParams.get("plan_id") === "plan-layout-fixture"
                ? parallel
                : [],
          },
        },
      }),
    );
    for (const scenario of [
      "empty",
      "serial",
      "parallel",
      "failed",
      "paused",
      "unknown",
      "completed",
    ]) {
      const run = structuredClone(base);
      run.state =
        scenario === "completed"
          ? "completed"
          : ["failed", "paused", "unknown"].includes(scenario)
            ? "paused"
            : "running";
      run.nodes[0].state =
        scenario === "unknown"
          ? "unknown"
          : scenario === "failed"
            ? "failed"
            : scenario === "completed"
              ? "accepted"
              : "running";
      const history = [1, 2].map((i) => ({
        ...structuredClone(run),
        id: `history-${i}`,
        state: "completed",
        created_at: `2026-01-0${i}`,
      }));
      serial = scenario === "empty" || scenario === "parallel" ? [] : [run, ...history];
      parallel =
        scenario !== "parallel"
          ? []
          : [
              {
                ...run,
                capacity: 2,
                integration_head: "a".repeat(40),
                workspace: { integrationDir: "fixture/integration" },
                commands: [["fixture-check"]],
                nodes: run.nodes.map((node: any) => ({
                  ...node,
                  state: node.key === "task0" ? "awaiting_landing" : node.state,
                  parallel: true,
                  resources: ["area"],
                  workspace: null,
                  landings: [],
                })),
              },
            ];
      await page.goto(
        `${workbench.origin}/#/projects/alpha/plans/plan-layout-fixture?tab=execution`,
      );
      await page.reload();
      await expect(page.locator('[data-plan-id="plan-layout-fixture"]')).toBeVisible();
      const panel = page.locator(
        scenario === "parallel"
          ? '[data-parallel-panel="plan-layout-fixture"]'
          : '[data-plan-run-panel="plan-layout-fixture"]',
      );
      await expect(panel).toContainText(
        scenario === "empty"
          ? "尚无计划执行"
          : scenario === "parallel"
            ? "运行中"
            : scenario === "unknown"
              ? "状态未知"
              : scenario === "failed"
                ? "执行失败"
                : scenario === "completed"
                  ? "全部验收完成"
                  : scenario === "paused"
                    ? "已暂停"
                    : "运行中",
      );
      if (process.env.PLAN_VISUAL) {
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({
          path: `/tmp/pro041-visual/${process.env.PLAN_VISUAL}-${width}-${scenario}.png`,
          fullPage: true,
        });
      }
      {
        await expect(page.getByRole("region", { name: "执行工作区", exact: true })).toBeVisible();
        const card = page.locator('[data-plan-id="plan-layout-fixture"]');
        await expect(card.getByRole("tab", { name: "执行与结果", exact: true })).toHaveAttribute(
          "aria-selected",
          "true",
        );
        if (process.env.PLAN_VISUAL)
          await card
            .locator(".plan-workspace")
            .screenshot({ path: `/tmp/pro041-visual/after-${width}-${scenario}-workspace.png` });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        if (width === 390 && ["serial", "parallel"].includes(scenario)) {
          const selectors =
            scenario === "serial"
              ? [".run-nodes a"]
              : [".run-nodes a", '[data-parallel-land="task0"]', '[data-parallel-rework="task0"]'];
          if (scenario === "parallel")
            await panel.locator('[data-parallel-rework-note="task0"]').fill("请重新检查工作结果");
          for (const selector of selectors) {
            const control = panel.locator(selector).first();
            await expect(control).toBeEnabled();
            await control.focus();
            const previous = await control.elementHandle();
            await page.waitForResponse((response) =>
              response.url().includes(scenario === "serial" ? "/plan-runs?" : "/parallel-runs?"),
            );
            await expect
              .poll(() => previous!.evaluate((element) => element.isConnected))
              .toBe(false);
            await expect.soft(control).toBeFocused({ timeout: 1000 });
          }
        }
        if (serial.length) {
          const historySection = panel.locator('[data-run-details="history"]');
          await expect(historySection).not.toHaveAttribute("open", "");
          await historySection.locator("summary").focus();
          await page.keyboard.press("Enter");
          await expect(historySection).toHaveAttribute("open", "");
          await panel.getByRole("button", { name: "刷新计划执行", exact: true }).click();
          await expect(historySection).toHaveAttribute("open", "");
          if (["failed", "unknown"].includes(scenario)) {
            await historySection.getByRole("button", { name: /history-1/ }).click();
            await expect(panel.locator(".run-current [role=alert]")).toBeVisible();
            await panel.locator(".run-current button").click();
          }
          if (!["completed"].includes(scenario)) {
            await panel.locator('[data-plan-run-field="note"]').fill("保留阅读位置与草稿");
            await expect(panel.locator('[data-plan-run-field="note"]')).toBeFocused();
            await panel.locator(".run-nodes").evaluate((element) => {
              element.scrollTop = 100;
            });
            const scrollY = await page.evaluate(() => window.scrollY);
            await page.waitForResponse((response) => response.url().includes("/plan-runs?"));
            await expect(panel.locator('[data-plan-run-field="note"]')).toBeFocused();
            expect(await panel.locator(".run-nodes").evaluate((element) => element.scrollTop)).toBe(
              100,
            );
            expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);
            await expect
              .poll(() => panel.locator('[data-plan-run-field="note"]').inputValue())
              .toBe("保留阅读位置与草稿");
          }
        }
      }
    }
  });
}
