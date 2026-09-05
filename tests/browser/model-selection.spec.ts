import path from 'node:path';
import { test, expect } from './fixture.js';
import { startWorkbenchServer } from '../../src/server/workbenchServer.js';
import type { ExecutionAttempt } from '../../src/execution/attempt.js';
import type { RunnerResult } from '../../src/execution/runtime.js';

test('header selection persists, refreshes local availability, and leaves active work unchanged', async ({ workbench, page }) => {
  const one = { provider: 'fixture', id: 'one' }, two = { provider: 'fixture', id: 'two' };
  let models = [{ ...one, name: 'One' }, { ...two, name: 'Two' }];
  const received: ExecutionAttempt[] = [];
  let finish: ((result: RunnerResult) => void) | undefined;
  const server = await startWorkbenchServer({ workspaceDir: workbench.root, port: 0, staticDir: path.resolve('dist/web'), runner: {
    async listModels() { return models; }, async resolveModel(_repo, selected) { return selected ?? one; },
    start(attempt, context) {
      received.push(attempt); context.recordModel?.(attempt.input.model!);
      return { completion: new Promise(resolve => { finish = resolve; }), stop() {} };
    },
  } });
  try {
    await page.goto(`${server.origin}/#/projects/alpha/backlog/ALP-001`);
    const select = page.getByLabel('模型', { exact: true });
    await expect(select).toBeEnabled();
    await select.selectOption(JSON.stringify(one));
    await page.getByRole('button', { name: '开始工作', exact: true }).click();
    await expect.poll(() => received.length).toBe(1);
    await expect(page.getByText('实际模型：fixture/one', { exact: true })).toBeVisible();
    await select.selectOption(JSON.stringify(two));
    expect(received[0]!.input.model).toEqual(one);
    await page.reload();
    await expect(select).toHaveValue(JSON.stringify(two));
    models = [{ ...one, name: 'One' }];
    await page.getByRole('button', { name: 'Refresh workspace and project data' }).click();
    await expect(page.locator('#model-selection-status')).toHaveText('所选模型不可用，请刷新或重新选择');
    expect(received).toHaveLength(1);
    models = [{ ...one, name: 'One' }, { ...two, name: 'Two' }];
    await page.getByRole('button', { name: 'Refresh workspace and project data' }).click();
    await expect(page.locator('#model-selection-status')).toContainText('仅用于新任务');
  } finally {
    finish?.({ outcome: 'stopped', summary: 'cleanup' });
    await new Promise(resolve => setImmediate(resolve)); await server.close();
  }
});
