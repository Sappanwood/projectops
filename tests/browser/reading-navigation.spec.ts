import { test, expect } from "./fixture.js";

test("Report links navigate to Docs and Backlog and return to the report", async ({workbench,page}) => {
  const before = workbench.snapshot();
  await page.goto(`${workbench.origin}/#/projects/alpha/reports/report-browser`);
  const report = page.locator('[data-report-id="report-browser"]');
  await expect(report.locator('.markdown-content')).toContainText('Browser report body');
  await report.getByRole('link',{name:'README.md',exact:true}).click();
  await expect(page.locator('.document-content')).toContainText('项目概览');
  await page.reload();
  await page.getByRole('link',{name:'返回来源页面'}).click();
  await expect(report.locator('.markdown-content')).toBeVisible();
  await report.getByRole('link',{name:'ALP-001',exact:true}).click();
  await expect(page.getByRole('region',{name:'Backlog item detail'})).toContainText('Browser task');
  await page.getByRole('link',{name:'返回来源页面'}).click();
  await expect(report.locator('.markdown-content')).toBeVisible();
  expect(workbench.snapshot()).toEqual(before);
});

test("Retrospective detail and filters survive reload and task round trips", async ({workbench,page}) => {
  const before = workbench.snapshot();
  await page.goto(`${workbench.origin}/#/projects/alpha/retrospectives/browser?filter_project=alpha&status=inbox&task=ALP-001`);
  const retro = page.locator('[data-retrospective-id="browser"]');
  await expect(retro.locator('.markdown-content')).toContainText('Browser retrospective body');
  await retro.getByRole('link',{name:'ALP-001',exact:true}).click();
  await page.getByRole('link',{name:'返回来源页面'}).click();
  await expect(retro.locator('.markdown-content')).toBeVisible();
  await page.reload();
  await expect(page.locator('#retro-task')).toHaveValue('ALP-001');
  await expect(retro.locator('.markdown-content')).toBeVisible();
  await page.goto(`${workbench.origin}/#/projects/alpha/retrospectives/missing`);
  await expect(page.getByRole('alert')).toContainText('回顾不存在');
  expect(workbench.snapshot()).toEqual(before);
});
