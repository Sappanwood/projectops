import { writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "./fixture.js";

test("Plan overview renders Markdown and preserves source, selection and safe reading", async ({
  workbench,
  page,
}, testInfo) => {
  const goal = `在已有隔离故事中，完成从自然语言意图到可核实创作成果的闭环。

## 本轮交付

自然语言意图 → 自主检索与读取 → 草稿或授权创建章节 → 核实成果。

- **资产检索与读取**：限定当前故事，展示实际引用来源。
- **独立草稿与授权保存**：保存精确版本，仅创建新章。
- **会话接入与验收**：保留原会话和手动采纳路径。

## 范围边界

沿用已有故事。不包含覆盖正文、完整编辑器、跨 session 延续及生产发布。

## 验收依据

| 验证 | 证明内容 |
| --- | --- |
| 确定性测试 | 协议、状态、隔离与幂等 |
| 真实模型 smoke | 自主取材与创作行为 |

两类证据均需具备。真实模型不可用时保留未完成验收。

## 交付收口

1. 核对全部任务的验收证据与上游前置。
2. 更新 epic，再完成 Plan 并生成 Report。

参考 [设计说明](https://example.com/creative-engine)。

原始示例：<script>window.overviewInjected = true</script>
[不可执行链接](javascript:alert)
`;
  const input = path.join(workbench.root, "overview.json");
  writeFileSync(
    input,
    JSON.stringify({
      title: "Creative overview",
      goal,
      items: [
        {
          key: "verify",
          title: "验收创作切片",
          item_type: "task",
          priority: "P1",
          body: "核对成果与证据。",
        },
      ],
    }),
  );
  const { plan } = JSON.parse(
    workbench.cli(["plan", "create", "alpha", "--input", input, "--json"]),
  );
  const before = workbench.snapshot();
  await page.goto(`${workbench.origin}/#/projects/alpha/plans/${plan.id}`);
  const overview = page.locator(".plan-goal");
  await expect(overview).toBeVisible();
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({ path: testInfo.outputPath(`overview-${width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await expect(overview.getByRole("heading", { name: "本轮交付" })).toBeVisible();
  await expect(overview.getByRole("listitem")).toHaveCount(5);
  await expect(overview.getByRole("table")).toBeVisible();
  await expect(overview.getByRole("link", { name: "设计说明" })).toHaveAttribute(
    "href",
    "https://example.com/creative-engine",
  );
  await expect(overview.getByRole("link", { name: "不可执行链接" })).toHaveCount(0);
  await expect(overview.locator("script")).toHaveCount(0);
  await expect(overview).toContainText("<script>window.overviewInjected = true</script>");
  const selected = await overview.getByRole("heading", { name: "本轮交付" }).evaluate((element) => {
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
    return selection.toString();
  });
  await page
    .getByRole("button", { name: "Refresh workspace and project data" })
    .evaluate((element: HTMLButtonElement) => element.click());
  await expect(
    page.getByRole("button", { name: "Refresh workspace and project data" }),
  ).toBeEnabled();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(selected);
  expect(workbench.snapshot()).toEqual(before);
});
