import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runCli } from '../src/app.js';
import { startWorkbenchServer } from '../src/server/workbenchServer.js';
import type { RunnerResult } from '../src/execution/runtime.js';

test('HTTP steer requires same origin, JSON, exact revision and a message; persists accepted instructions', async () => {
  const workspaceDir = mkdtempSync(path.join(tmpdir(), 'pops-steer-http-'));
  const cli = (...args: string[]) => {
    const output: string[] = [];
    assert.equal(runCli(args, { stdout: s => output.push(s), stderr: s => output.push(s) }, workspaceDir), 0, output.join(''));
    return JSON.parse(output.join(''));
  };
  cli('init', '--json'); mkdirSync(path.join(workspaceDir, 'repo'));
  cli('project', 'add', 'repo', '--json'); cli('backlog', 'init', 'repo', '--json');
  const { item } = cli('backlog', 'add', 'repo', '-T', 'Steer work', '-c', 'feature', '--priority', 'P1', '-b', 'Implement', '--json');
  const received: string[] = [];
  let finish!: (result: RunnerResult) => void;
  const server = await startWorkbenchServer({ workspaceDir, port: 0, runner: { start() {
    return { completion: new Promise<RunnerResult>(resolve => { finish = resolve; }), stop() {}, steer(message: string) { received.push(message); } };
  } } });
  const base = `${server.origin}/api/projects/repo/executions`;
  const post = (suffix: string, body: unknown, origin = server.origin, contentType = 'application/json') => fetch(`${base}/${suffix}`, {
    method: 'POST', headers: { origin, 'content-type': contentType }, body: JSON.stringify(body),
  });
  try {
    const started = await (await post('start', { item_id: item.id, expected_revision: item.revision })).json();
    const a = started.data.attempt;
    const suffix = `${a.id}/steer`;
    const input = { expected_revision: a.revision, message: 'Keep the existing API' };
    assert.equal((await post(suffix, input, 'https://example.com')).status, 403);
    assert.equal((await post(suffix, input, server.origin, 'text/plain')).status, 415);
    assert.equal((await post(suffix, { expected_revision: a.revision })).status, 400);
    assert.equal((await post(suffix, { message: 'Missing revision' })).status, 400);
    assert.equal((await post(suffix, { ...input, workspace: '/tmp' })).status, 400);
    assert.equal((await post(suffix, { ...input, expected_revision: 'stale' })).status, 409);
    assert.deepEqual(received, []);
    const response = await post(suffix, input);
    assert.equal(response.status, 200);
    assert.deepEqual(received, [input.message]);
    const detail = await (await fetch(`${base}/${a.id}`)).json();
    assert.ok(detail.data.attempt.progress.events.some((event: { text: string }) => event.text.includes(input.message)));
  } finally { finish?.({ outcome: 'stopped', summary: 'Fixture cleanup' }); await new Promise(resolve => setImmediate(resolve)); await server.close(); rmSync(workspaceDir, { recursive: true, force: true }); }
});
