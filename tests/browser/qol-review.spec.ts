import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test, expect, type WorkbenchFixture } from "./fixture.js";

function markDone(workbench: WorkbenchFixture, id: string): void {
  const item = JSON.parse(workbench.cli(["backlog", "show", "alpha", id, "--json"]));
  workbench.cli([
    "backlog",
    "update",
    "alpha",
    id,
    "--status",
    "done",
    "--expected-revision",
    item.revision,
  ]);
}

test("completed backlog group preserves navigation, explicit collapse and status updates", async ({
  workbench,
  page,
}, testInfo) => {
  markDone(workbench, "ALP-001");
  for (let i = 0; i < 12; i++) {
    const { item } = JSON.parse(
      workbench.cli([
        "backlog",
        "add",
        "alpha",
        "-T",
        `Completed task ${i}`,
        "-c",
        "feature",
        "--priority",
        "P2",
        "--json",
      ]),
    );
    markDone(workbench, item.id);
  }
  const { item: active } = JSON.parse(
    workbench.cli([
      "backlog",
      "add",
      "alpha",
      "-T",
      "仍需关注的任务",
      "-c",
      "feature",
      "--priority",
      "P1",
      "--json",
    ]),
  );
  await page.goto(`${workbench.origin}/#/projects/alpha/backlog`);
  const group = page.locator('details[data-reading-key="backlog-group-done"]');
  await expect(group.locator("summary")).toContainText("13");
  await expect(group).not.toHaveAttribute("open");
  await expect(page.locator(`[data-backlog-item="${active.id}"]`)).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("backlog-collapsed-desktop.png"),
    fullPage: true,
  });
  await group.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-backlog-item="ALP-001"]')).toBeVisible();
  await group.locator("summary").click();
  await page.getByRole("tab", { name: /^Plans/ }).click();
  await page.getByRole("link", { name: /Browser plan/ }).click();
  await page.getByRole("tab", { name: "执行与结果", exact: true }).click();
  await page
    .getByRole("region", { name: "执行进度", exact: true })
    .getByRole("link", { name: /ALP-001/ })
    .click();
  await expect(page.getByRole("region", { name: "Backlog item detail" })).toContainText(
    "Browser authority",
  );
  await expect(page.locator('[data-backlog-item="ALP-001"]')).toBeVisible();
  await group.locator("summary").click();
  await page.getByRole("button", { name: "Refresh backlog", exact: true }).click();
  await expect(group).not.toHaveAttribute("open");
  await page.getByRole("link", { name: "返回原 Plan" }).click();
  await expect(page).toHaveURL(/plans\/plan-browser/);
  await page.goto(`${workbench.origin}/#/projects/alpha/backlog/${active.id}`);
  await page.getByRole("button", { name: "done", exact: true }).click();
  await expect(group.locator("summary")).toContainText("14");
  await expect(page.locator(`[data-backlog-item="${active.id}"]`)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath("backlog-mobile.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("backlog without completed tasks has no empty done group", async ({ workbench, page }) => {
  await page.goto(`${workbench.origin}/#/projects/alpha/backlog`);
  await expect(page.locator('[data-backlog-item="ALP-001"]')).toBeVisible();
  await expect(page.locator('details[data-reading-key="backlog-group-done"]')).toHaveCount(0);
});

test("shared Mermaid reading renders flowchart and sequence, preserves errors and blocks remote resources", async ({
  workbench,
  page,
}, testInfo) => {
  const body = [
    "# 图表阅读",
    "正文仍然可读。",
    "```mermaid\nflowchart TD\n A[开始] --> B{判断}\n B --> C[通过]\n B --> D[重试]\n```",
    "```mermaid\nsequenceDiagram\n participant A as 用户\n participant B as 服务\n A->>B: 读取\n B-->>A: 结果\n```",
    "```mermaid\nflowchart TD\n" +
      Array.from(
        { length: 8 },
        (_, i) => `Root[架构入口] --> N${i}[Application component ${i}]`,
      ).join("\n") +
      "\n```",
    "```mermaid\nthis is not a diagram\n```",
    "```ts\nconst ordinary = '<safe>';\n```",
    '```mermaid\nflowchart LR\n X@{ img: "https://mermaid-resource.invalid/remote.png", label: "外部图片" }\n```',
    '```mermaid\n%%{init: {"themeCSS": "@import url(https://mermaid-resource.invalid/remote.css);", "securityLevel":"loose"}}%%\nflowchart LR\n A[点击] --> B[安全]\n click A "javascript:window.__mermaidUnsafe = true"\n```',
  ].join("\n\n");
  writeFileSync(path.join(workbench.root, "alpha/README.md"), body);
  const before = workbench.snapshot();
  const remote: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith("http") && !request.url().startsWith(workbench.origin))
      remote.push(request.url());
  });
  await page.goto(`${workbench.origin}/#/projects/alpha/docs`);
  const diagrams = page.locator(".mermaid-diagram svg");
  await expect(diagrams.nth(0)).toBeVisible();
  await expect(diagrams.nth(0)).toContainText("判断");
  await expect(diagrams.nth(1)).toBeVisible();
  await expect(diagrams.nth(1)).toContainText("读取");
  const wideGraph = diagrams.nth(2);
  await expect(wideGraph).toBeVisible();
  expect(
    await wideGraph.evaluate(
      (svg) => svg.getBoundingClientRect().width > svg.parentElement!.clientWidth,
    ),
  ).toBe(true);
  await expect(
    page.locator(".mermaid-fallback").filter({ hasText: "this is not a diagram" }),
  ).toBeVisible();
  await expect(page.locator(".markdown-content")).toContainText("const ordinary = '<safe>';");
  await expect(page.locator("[data-mermaid-source]")).toHaveCount(0);
  expect(remote).toEqual([]);
  expect(await page.evaluate(() => "__mermaidUnsafe" in window)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("mermaid-desktop.png"), fullPage: true });
  await page.getByText("查看 Markdown 源码", { exact: true }).click();
  await expect(page.locator(".source-body")).toHaveText(body);
  await page.getByText("返回阅读视图", { exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("mermaid-mobile.png"), fullPage: true });
  expect(workbench.snapshot()).toEqual(before);
});

test("Research reads nested Markdown, restores navigation and distinguishes loading, empty and errors", async ({
  workbench,
  page,
}, testInfo) => {
  mkdirSync(path.join(workbench.root, "ops/alpha/research/topic"), { recursive: true });
  writeFileSync(
    path.join(workbench.root, "ops/alpha/research/overview.md"),
    "# 调研概览\n\n[研究结果](topic/findings.md#结论)\n",
  );
  writeFileSync(
    path.join(workbench.root, "ops/alpha/research/topic/findings.md"),
    "# 研究结果\n\n## 结论\n\n正文证据。\n\n[调研概览](../overview.md)\n",
  );
  const before = workbench.snapshot();
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/projects/alpha/research", async (route) => {
    await hold;
    await route.continue();
  });
  await page.goto(`${workbench.origin}/#/projects/alpha/research`);
  await expect(page.getByRole("tabpanel")).toContainText("正在读取");
  await expect(page.getByRole("tabpanel")).not.toContainText("暂无 Research 文档");
  release();
  await page.getByRole("link", { name: "overview.md", exact: true }).click();
  await page.locator(".markdown-content").getByRole("link", { name: "研究结果" }).click();
  await expect(page.getByRole("heading", { name: "结论", exact: true })).toBeFocused();
  await page.reload();
  await expect(page.locator(".markdown-content")).toContainText("正文证据");
  await page.screenshot({ path: testInfo.outputPath("research-desktop.png"), fullPage: true });
  await page.locator(".markdown-content").getByRole("link", { name: "调研概览" }).click();
  await page.goBack();
  await expect(page.locator(".markdown-content")).toContainText("正文证据");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("research-mobile.png"), fullPage: true });
  await page.goto(`${workbench.origin}/#/projects/alpha/research?path=missing.md`);
  await expect(page.getByRole("alert")).toContainText("文档不存在");
  await page.route("**/api/projects/alpha/research?*", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: { message: "读取暂不可用" } }),
    }),
  );
  await page.goto(`${workbench.origin}/#/projects/alpha/research?path=overview.md`);
  await expect(page.getByRole("alert")).toContainText("读取暂不可用");
  await page.unroute("**/api/projects/alpha/research?*");
  await page.getByRole("button", { name: "重试读取" }).click();
  await expect(page.locator(".markdown-content")).toContainText("调研概览");
  await page.goto(`${workbench.origin}/#/projects/empty/research`);
  await expect(page.getByRole("tabpanel")).toContainText("暂无 Research 文档");
  expect(workbench.snapshot()).toEqual(before);
});
