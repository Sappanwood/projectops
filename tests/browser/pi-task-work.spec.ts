import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { test, expect } from './fixture.js';
import { startWorkbenchServer } from '../../src/server/workbenchServer.js';
import { showExecution, verifyExecution } from '../../src/application/executionApi.js';
import type { Runner, RunnerResult } from '../../src/execution/runtime.js';

test('task work streams progress, preserves draft and focus, steers, reloads and requires explicit acceptance', async ({ workbench, page }) => {
  execFileSync('git', ['init', '-q'], { cwd: path.join(workbench.root, 'alpha') });
  let context!: Parameters<Runner['start']>[1];
  let attemptId = '';
  let finish!: (result: RunnerResult) => void;
  const received: string[] = [];
  const server = await startWorkbenchServer({ workspaceDir: workbench.root, port: 0, staticDir: path.resolve('dist/web'), runner: {
    start(attempt, value) {
      context = value; attemptId = attempt.id;
      return { completion: new Promise(resolve => { finish = resolve; }), stop() {}, steer(message) { received.push(message); } };
    },
  } });
  try {
    await page.goto(`${server.origin}/#/projects/alpha/backlog/ALP-001`);
    const panel = page.getByRole('region', { name: '任务执行' });
    await panel.getByLabel('本次工作指示').fill('Implement the task');
    await panel.getByRole('button', { name: '开始工作' }).click();
    await expect(panel.getByRole('heading', { name: '工作进展', exact: true })).toBeVisible();
    context.emit({ type: 'session', text: 'controlled-session' });
    context.emit({ type: 'text', text: 'Inspecting <script>unsafe</script>' });
    context.emit({ type: 'tool', text: 'read README.md' });
    const field = panel.getByLabel('追加工作指示');
    await field.fill('Keep the public API');
    await field.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(5, 9));
    await expect(panel).toContainText('read README.md', { timeout: 7000 });
    await expect(field).toHaveValue('Keep the public API');
    await expect(field).toBeFocused();
    expect(await field.evaluate((element: HTMLTextAreaElement) => [element.selectionStart, element.selectionEnd])).toEqual([5, 9]);
    await expect(panel.locator('script')).toHaveCount(0);
    await panel.getByRole('button', { name: '发送追加指示' }).click();
    await expect.poll(() => received).toEqual(['Keep the public API']);
    await expect(field).toHaveValue('');
    await page.reload();
    await expect(panel).toContainText('Keep the public API');
    await expect(panel).toContainText('controlled-session');
    finish({ outcome: 'succeeded', summary: 'Implemented with controlled runner' });
    await expect(panel).toContainText('执行成功（尚需验收）', { timeout: 7000 });
    await expect(panel.getByRole('button', { name: '接受本次结果' })).toBeDisabled();
    expect(JSON.parse(workbench.cli(['backlog', 'show', 'alpha', 'ALP-001', '--json'])).status).not.toBe('done');
    const query = { workspaceDir: workbench.root, projectId: 'alpha', attemptId };
    const shown = showExecution(query); expect(shown.ok).toBe(true); if (!shown.ok) return;
    const verified = verifyExecution({ ...query, expectedRevision: shown.data.attempt.revision, command: 'controlled assertions', outcome: 'passed', evidence: 'Controlled assertions passed <script>unsafe</script>' });
    expect(verified.ok).toBe(true);
    await panel.getByRole('button', { name: '刷新执行记录' }).click();
    await panel.getByRole('button', { name: '查看验证证据正文' }).click();
    await expect(panel.getByLabel('验证证据正文')).toHaveText('Controlled assertions passed <script>unsafe</script>');
    await expect(panel.locator('script')).toHaveCount(0);
    await panel.getByLabel('验收或状态核对说明').fill('Reviewed result and evidence');
    await panel.getByRole('button', { name: '接受本次结果' }).click();
    await expect(panel).toContainText('验收结论：已接受');
    await expect(panel).toContainText('read README.md');
    expect(JSON.parse(workbench.cli(['backlog', 'show', 'alpha', 'ALP-001', '--json'])).status).toBe('done');
    if (verified.ok) writeFileSync(path.join(workbench.root, 'ops/alpha/executions', verified.data.attempt.verifications[0]!.evidence_ref), 'Tampered evidence');
    await panel.getByRole('button', { name: '查看验证证据正文' }).click();
    await expect(panel.getByRole('alert')).toContainText('证据不可读');
    await expect(panel.getByLabel('验证证据正文')).toHaveCount(0);
  } finally { finish?.({ outcome: 'stopped', summary: 'Fixture cleanup' }); await new Promise(resolve => setImmediate(resolve)); await server.close(); }
});

test('repeated start clicks launch once and failed work waits for explicit retry with history preserved', async ({ workbench, page }) => {
  execFileSync('git', ['init', '-q'], { cwd: path.join(workbench.root, 'alpha') });
  let starts = 0;
  let finish!: (result: RunnerResult) => void;
  const server = await startWorkbenchServer({ workspaceDir: workbench.root, port: 0, staticDir: path.resolve('dist/web'), runner: {
    start() { starts++; return { completion: new Promise(resolve => { finish = resolve; }), stop() {} }; },
  } });
  try {
    await page.goto(`${server.origin}/#/projects/alpha/backlog/ALP-001`);
    const panel = page.getByRole('region', { name: '任务执行' });
    const start = panel.getByRole('button', { name: '开始工作' });
    await expect(start).toBeEnabled();
    await start.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
    await expect(panel).toContainText('运行中');
    expect(starts).toBe(1);
    finish({ outcome: 'failed', summary: 'Controlled runner failed: fix the input' });
    await expect(panel).toContainText('执行失败', { timeout: 7000 });
    await expect(panel).toContainText('Controlled runner failed: fix the input');
    expect(starts).toBe(1);
    await expect(panel.locator('[data-execution-id]')).toHaveCount(1);
    await page.reload();
    await expect(panel).toContainText('Controlled runner failed: fix the input');
    expect(starts).toBe(1);
    await panel.getByLabel('本次工作指示').fill('Corrected input for retry');
    await panel.getByRole('button', { name: '用当前任务版本重试' }).click();
    await expect.poll(() => starts).toBe(2);
    await expect(panel.locator('[data-execution-id]')).toHaveCount(2);
    await panel.locator('[data-execution-id]').filter({ hasText: '执行失败' }).click();
    await expect(panel).toContainText('Controlled runner failed: fix the input');
    expect(JSON.parse(workbench.cli(['backlog', 'show', 'alpha', 'ALP-001', '--json'])).status).not.toBe('done');
  } finally { finish?.({ outcome: 'stopped', summary: 'Fixture cleanup' }); await new Promise(resolve => setImmediate(resolve)); await server.close(); }
});
