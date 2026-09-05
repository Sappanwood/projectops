import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test, expect } from "./fixture.js";

test("Overview standard documents open directly, reload and return while unreadable entries explain failures", async ({
  workbench,
  page,
  context,
}, testInfo) => {
  const overview = `${workbench.origin}/#/projects/alpha`;
  const before = workbench.snapshot();
  for (const name of ["README.md", "AGENTS.md", "docs/PRODUCT_SPEC.md", "docs/ARCHITECTURE.md"]) {
    await page.goto(overview);
    const link = page
      .locator('[aria-labelledby="card-docs-title"]')
      .getByRole("link", { name, exact: true });
    await link.focus();
    await expect(link).toBeFocused();
    const href = await link.getAttribute("href");
    await page.keyboard.press("Enter");
    await expect(page.locator(".document-path")).toContainText(name);
    await page.reload();
    await expect(page.locator(".document-content .markdown-content")).toBeVisible();
    await page.getByRole("link", { name: "返回 Overview", exact: true }).click();
    await expect(page.locator(".overview-grid")).toBeVisible();
    const tab = await context.newPage();
    await tab.goto(`${workbench.origin}/${href}`);
    await expect(tab.locator(".document-content .markdown-content")).toBeVisible();
    await tab.close();
  }
  expect(workbench.snapshot()).toEqual(before);
  await page.screenshot({ path: testInfo.outputPath("overview-standard.png"), fullPage: true });
  rmSync(path.join(workbench.root, "alpha/AGENTS.md"));
  writeFileSync(
    path.join(workbench.root, "alpha/docs/PRODUCT_SPEC.md"),
    "Readable without heading",
  );
  await page.goto(overview);
  await page.getByRole("button", { name: "Refresh workspace and project data" }).click();
  const docs = page.locator('[aria-labelledby="card-docs-title"]');
  await expect(docs).toContainText("文档不存在");
  await expect(docs.getByRole("link", { name: "AGENTS.md", exact: true })).toHaveCount(0);
  await docs.getByRole("link", { name: "docs/PRODUCT_SPEC.md", exact: true }).click();
  await expect(page.locator(".document-content")).toContainText("Readable without heading");
});

test("Overview shows readable retrospective previews, scoped counts and partial diagnostics", async ({
  workbench,
  page,
}) => {
  const root = path.join(workbench.root, "retrospectives/inbox");
  const body = readFileSync(path.join(root, "browser.md"), "utf8");
  for (let i = 0; i < 6; i++)
    writeFileSync(
      path.join(root, `preview-${i}.md`),
      body
        .replace("id: browser", `id: preview-${i}`)
        .replace("2026-09-05", `2026-09-0${i + 1}`)
        .replace("Browser retrospective body", `Readable preview ${i}`),
    );
  writeFileSync(path.join(root, "broken.md"), "bad");
  await page.goto(`${workbench.origin}/#/projects/alpha`);
  const retro = page.locator('[aria-labelledby="card-retro-title"]');
  await expect(retro).toContainText("展示 5 / 已读取 7 条");
  await expect(retro).toContainText("部分数据无法读取");
  await expect(retro.locator(".item-title").first()).toHaveText("Readable preview 5");
  await expect(retro.locator(".item-row")).toHaveCount(5);
  await expect(retro.locator(".item-row")).not.toContainText([
    "inbox/",
    "inbox/",
    "inbox/",
    "inbox/",
    "inbox/",
  ]);
  await retro.locator(".item-title").first().click();
  await expect(page.locator('[data-retrospective-id="preview-5"] .markdown-content')).toContainText(
    "Readable preview 5",
  );
});
