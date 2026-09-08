import { writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type WorkbenchFixture } from "./fixture.js";

function seed(workbench: WorkbenchFixture) {
  workbench.cli([
    "backlog",
    "add",
    "empty",
    "-T",
    "既有基础服务",
    "-c",
    "feature",
    "--priority",
    "P1",
    "-b",
    "Service",
  ]);
  const input = path.join(workbench.root, "graph.json");
  writeFileSync(
    input,
    JSON.stringify({
      title: "Dependency graph",
      goal: "通过依赖关系确认前置工作、并行分支和交付顺序。",
      items: [
        { key: "prepare", title: "准备接口与数据结构", depends_on: ["empty:EMP-001"] },
        { key: "api", title: "实现 API 服务", depends_on: ["prepare"] },
        {
          key: "ui",
          project: "empty",
          title: "实现前端交互与长标题提示：<script>文本始终作为内容显示</script>",
          depends_on: ["prepare"],
        },
        { key: "ship", title: "联合验收与交付", depends_on: ["api", "ui"] },
      ].map((item) => ({
        ...item,
        item_type: "task",
        priority: "P1",
        body: "## 验收\n检查任务结果。",
      })),
    }),
  );
  workbench.cli(["plan", "create", "alpha", "--input", input]);
}

test("Plan graph supports draft focus, hover, cross-project navigation and refresh", async ({
  workbench,
  page,
}) => {
  seed(workbench);
  const url = `${workbench.origin}/#/projects/alpha/plans/plan-dependency-graph`;
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url);
  await expect(page.locator(".plan-title")).toHaveText("Dependency graph");
  const graph = page.getByRole("region", { name: "计划依赖图", exact: true });
  await expect(graph.locator("[data-graph-node]")).toHaveCount(5);
  await expect(graph.locator("[data-graph-edge]")).toHaveCount(5);
  const draft = graph.locator('[data-graph-node="ui"]');
  await expect(draft).toHaveText("ui");
  await draft.hover();
  await expect(graph.getByRole("tooltip")).toContainText("实现前端交互与长标题提示");
  await page.screenshot({ path: "/tmp/plan-graph-draft-hover.png", fullPage: true });
  await page.getByRole("button", { name: "全部折叠", exact: true }).click();
  await draft.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#plan-dependency-graph--ui")).toHaveAttribute("open", "");
  await expect(page.locator("#plan-dependency-graph--ui > summary")).toBeFocused();

  workbench.cli(["plan", "approve", "alpha", "plan-dependency-graph", "--review-note", "Fixture"]);
  const mapping = JSON.parse(
    workbench.cli(["plan", "materialize", "alpha", "plan-dependency-graph", "--json"]),
  ).mapping;
  await page.locator("#btn-refresh").click();
  const remote = graph.locator('[data-graph-node="ui"]');
  await expect(remote).toHaveText(mapping.ui);
  await remote.click();
  await expect(page).toHaveURL(/\/projects\/empty\/backlog\/EMP-002\?from=/);
  await expect(page.getByRole("region", { name: "Backlog item detail" })).toContainText(
    "实现前端交互",
  );
  await page.getByRole("link", { name: "返回原 Plan", exact: true }).click();
  await expect(graph).toBeVisible();
  await expect(page.getByRole("tab", { name: "审阅计划" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.mouse.move(0, 0);
    await graph.scrollIntoViewIfNeeded();
    await graph.locator(".plan-graph-scroll").focus();
    await remote.focus();
    await expect(remote).toBeInViewport();
    await expect(graph.getByRole("tooltip")).toContainText("实现前端交互");
    await page.screenshot({ path: `/tmp/plan-graph-${width}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  const scroller = graph.locator(".plan-graph-scroll");
  const offset = await scroller.evaluate((element) => element.scrollLeft);
  await page.locator("#btn-refresh").evaluate((element) => (element as HTMLButtonElement).click());
  await expect(remote).toBeFocused();
  expect(await scroller.evaluate((element) => element.scrollLeft)).toBe(offset);
});

test("external title loading and failure keep the graph usable with a retry on hover", async ({
  workbench,
  page,
}) => {
  seed(workbench);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/projects/empty/backlog/EMP-001", async (route) => {
    await pending;
    await route.fulfill({
      status: 503,
      json: { ok: false, error: { message: "Title unavailable" } },
    });
  });
  await page.goto(`${workbench.origin}/#/projects/alpha/plans/plan-dependency-graph`);
  const graph = page.getByRole("region", { name: "计划依赖图", exact: true });
  const external = graph.locator('[data-graph-node="empty:EMP-001"]');
  await page.locator(".plan-items").scrollIntoViewIfNeeded();
  await external.hover();
  await expect(graph.getByRole("tooltip")).toContainText("正在读取标题");
  release();
  await expect(graph.getByRole("tooltip")).toContainText("标题读取失败");
  await expect(external).toHaveAttribute("href", /backlog\/EMP-001/);
  await page.unroute("**/api/projects/empty/backlog/EMP-001");
  await graph.getByRole("heading").hover();
  await external.hover();
  await expect(graph.getByRole("tooltip")).toContainText("既有基础服务");
  await page.keyboard.press("Escape");
  await expect(graph.getByRole("tooltip")).toBeHidden();
});
