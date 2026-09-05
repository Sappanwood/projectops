import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test, expect } from "./fixture.js";

test("Docs reads standard and additional documents, headings and source without writes", async ({workbench, page}, testInfo) => {
  mkdirSync(path.join(workbench.root, 'alpha/docs/guide'), {recursive:true});
  writeFileSync(path.join(workbench.root, 'alpha/README.md'), '# 项目阅读\n\n[使用指南](docs/guide/use.md#步骤)\n\n| 名称 | 结果 |\n| --- | --- |\n| 检查 | passed |\n');
  writeFileSync(path.join(workbench.root, 'alpha/docs/guide/use.md'), '# 使用指南\n\n[概览](../../README.md)\n\n## 步骤\n\n- [x] 已完成\n\n> 注意阅读\n');
  const before = workbench.snapshot();
  await page.goto(`${workbench.origin}/#/projects/alpha/docs`);
  await expect(page.getByRole('heading', {name:'项目阅读',exact:true})).toBeVisible();
  await expect(page.locator('.markdown-content table')).toContainText('passed');
  await page.screenshot({path:testInfo.outputPath('docs-desktop.png'),fullPage:true});
  await page.locator('.markdown-content').getByRole('link',{name:'使用指南'}).click();
  await expect(page.getByRole('heading',{name:'步骤',exact:true})).toBeVisible();
  await expect(page).toHaveURL(/section=/);
  await page.reload();
  await expect(page.locator('.markdown-content blockquote')).toContainText('注意阅读');
  await page.getByText('查看 Markdown 源码',{exact:true}).click();
  await expect(page.locator('.source-body')).toContainText('- [x] 已完成');
  await page.getByText('返回阅读视图',{exact:true}).click();
  await page.getByRole('navigation',{name:'章节目录'}).getByRole('link',{name:'步骤'}).click();
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('docs-mobile.png'),fullPage:true});
  expect(workbench.snapshot()).toEqual(before);
});

test("Docs retries failed reads, shows missing documents and discards late project responses", async ({workbench,page}) => {
  await page.route('**/api/projects/alpha/docs?*', route => route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:{message:'Temporary read failure'}})}));
  await page.goto(`${workbench.origin}/#/projects/alpha/docs`);
  await expect(page.getByRole('alert')).toContainText('Temporary read failure');
  await page.unroute('**/api/projects/alpha/docs?*');
  await page.getByRole('button',{name:'重试读取'}).click();
  await expect(page.locator('.markdown-content')).toContainText('项目概览');
  await page.goto(`${workbench.origin}/#/projects/alpha/docs?path=docs%2Fmissing.md`);
  await expect(page.getByRole('alert')).toContainText('文档不存在');
  let release!: () => void;
  let started!: () => void;
  const pending = new Promise<void>(resolve => {release = resolve;});
  const seen = new Promise<void>(resolve => {started = resolve;});
  await page.route('**/api/projects/alpha/docs?*', async route => {started(); await pending; await route.continue();});
  await page.goto(`${workbench.origin}/#/projects/alpha/docs`);
  await seen;
  await page.getByRole('combobox',{name:'Select active project'}).selectOption('empty');
  await expect(page.getByRole('alert')).toContainText('文档不存在');
  const response = page.waitForResponse(r => r.url().includes('/api/projects/alpha/docs?'));
  release();
  await response;
  await expect(page.getByRole('alert')).toContainText('文档不存在');
  await expect(page.locator('.document-content')).not.toContainText('项目概览');
});

test("Document navigation restores the reading position with browser back and forward", async ({workbench,page}) => {
  const body = '# Long document\n\n' + Array.from({length:35},(_,i) => `## Section ${i}\n\nReading paragraph ${i}.\n`).join('\n') + '\n[Related](docs/related.md)';
  writeFileSync(path.join(workbench.root,'alpha/README.md'),body);
  writeFileSync(path.join(workbench.root,'alpha/docs/related.md'),'# Related document\n\nDetails.');
  await page.goto(`${workbench.origin}/#/projects/alpha/docs?path=README.md`);
  const related = page.locator('.markdown-content').getByRole('link',{name:'Related',exact:true});
  await related.scrollIntoViewIfNeeded();
  const position = await page.evaluate(() => scrollY);
  await related.click();
  await expect(page.getByRole('heading',{name:'Related document',exact:true})).toBeVisible();
  await page.goBack();
  await expect(related).toBeVisible();
  await expect.poll(async () => Math.abs(await page.evaluate(() => scrollY) - position)).toBeLessThan(5);
  await page.goForward();
  await expect(page.getByRole('heading',{name:'Related document',exact:true})).toBeVisible();
});
