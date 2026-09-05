import { completePlan } from '../src/application/planComplete.js';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runCli } from '../src/app.js';
import { createPlanRun, showPlanRun, validatePlanRunCompletion, PlanRunRuntime } from '../src/application/planRunApi.js';
import { computePlanRevision } from '../src/application/planRevision.js';
import { readPlan, updatePlan } from '../src/plan/planFs.js';
import { showBacklogItem, updateBacklogItemStatus, updateBacklogItemContent } from '../src/application/backlogApi.js';
import { createExecution, decideExecution, finishExecution, showExecution, verifyExecution } from '../src/application/executionApi.js';
import { ExecutionRuntime, type RunnerResult } from '../src/execution/runtime.js';
import type { ApplicationResult } from '../src/application/result.js';
import type { PlanRun } from '../src/planRun/planRun.js';

function data<T>(result: ApplicationResult<T>): T {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error('Unexpected application failure');
  return result.data;
}
function setup(chain = true) {
  const workspaceDir = mkdtempSync(path.join(tmpdir(), 'plan-run-'));
  const cli = (args: string[]) => {
    const output: string[] = [];
    assert.equal(runCli(args, { stdout: x => output.push(x), stderr: x => output.push(x) }, workspaceDir), 0, output.join('\n'));
  };
  cli(['init']);
  const repo = path.join(workspaceDir, 'repo');
  mkdirSync(repo);
  cli(['project', 'add', 'repo']);
  cli(['backlog', 'init', 'repo']);
  execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
  writeFileSync(path.join(repo, 'code.txt'), 'initial');
  const planId = 'plan-chain';
  writeFileSync(path.join(workspaceDir, 'ops/repo/plans', `${planId}.json`), JSON.stringify({
    schema: 'plan/Plan@1', id: planId, title: 'Chain', goal: 'Deliver both tasks', status: 'approved',
    approval: { approved_at: new Date().toISOString(), review_note: 'Fixture approval' },
    items: ['first', 'second'].map((key, i) => ({ key, title: key, item_type: 'task', priority: 'P1', body: `Implement ${key}`, depends_on: chain && i ? ['first'] : [] })),
  }));
  cli(['plan', 'materialize', 'repo', planId]);
  const q = { workspaceDir, projectId: 'repo', planId };
  const plan = readPlan(path.join(workspaceDir, 'ops/repo/plans'), planId);
  const controls: Array<(result: RunnerResult) => void> = [];
  const execution = new ExecutionRuntime({ start() { return { completion: new Promise<RunnerResult>(resolve => controls.push(resolve)), stop() {} }; } });
  const scheduler = new PlanRunRuntime(execution);
  const create = (instructions?: string) => data(createPlanRun({ ...q, expectedRevision: computePlanRevision(plan), ...(instructions === undefined ? {} : { instructions }) })).run;
  const mutation = (run: PlanRun) => ({ ...q, runId: run.id, expectedRevision: run.revision });
  const current = (run: PlanRun) => data(showPlanRun({ ...q, runId: run.id })).run;
  const finish = async (outcome: RunnerResult['outcome'] = 'succeeded') => {
    controls.at(-1)!({ outcome, summary: outcome });
    await new Promise(resolve => setImmediate(resolve));
  };
  const accept = (run: PlanRun) => {
    const attemptId = run.nodes.find(n => n.attempt_ids.length && n.state !== 'accepted')!.attempt_ids.at(-1)!;
    let attempt = data(showExecution({ ...q, attemptId })).attempt;
    attempt = data(verifyExecution({ ...q, attemptId, expectedRevision: attempt.revision, command: 'fixture-check', outcome: 'passed', evidence: 'fixture assertions passed' })).attempt;
    return data(decideExecution({ ...q, attemptId, expectedRevision: attempt.revision, decision: 'accepted', note: 'Fixture reviewed' })).attempt;
  };
  return { q, repo, plan, scheduler, execution, controls, create, mutation, current, finish, accept };
}

test('serial run persists its model for successors after reload', async () => {
  const f = setup();
  const model = { provider: 'fixture', id: 'one' };
  let run = data(createPlanRun({ ...f.q, expectedRevision: computePlanRevision(f.plan), model })).run;
  model.id = 'two';
  run = data(f.scheduler.advance(f.mutation(run))).run;
  const first = data(showExecution({ ...f.q, attemptId: run.nodes[0]!.attempt_ids[0]! })).attempt;
  assert.deepEqual(first.input.model, { provider: 'fixture', id: 'one' });
  await f.finish(); f.accept(run);
  const reloaded = new PlanRunRuntime(f.execution);
  run = data(reloaded.advance(f.mutation(f.current(run)))).run;
  const second = data(showExecution({ ...f.q, attemptId: run.nodes[1]!.attempt_ids[0]! })).attempt;
  assert.deepEqual(second.input.model, first.input.model);
  await f.finish('stopped');
});

test('serial plan run freezes inputs and dispatches successor only after verification and acceptance', async () => {
  const f = setup();
  let run = f.create();
  assert.equal(run.plan_revision, computePlanRevision(f.plan));
  assert.equal(run.nodes[0]!.input.body.trim(), 'Implement first');
  run = data(f.scheduler.advance(f.mutation(run))).run;
  assert.equal(f.controls.length, 1);
  await f.finish();
  run = data(f.scheduler.advance(f.mutation(run))).run;
  assert.equal(run.nodes[0]!.state, 'awaiting_acceptance');
  assert.equal(f.controls.length, 1);
  f.accept(run);
  run = data(f.scheduler.advance(f.mutation(run))).run;
  assert.equal(run.nodes[0]!.state, 'accepted');
  assert.equal(f.controls.length, 2);
  await f.finish();
  f.accept(run);
  run = data(f.scheduler.advance(f.mutation(run))).run;
  assert.equal(run.state, 'completed');
  assert.equal(run.nodes.every(n => n.state === 'accepted'), true);
  assert.ok(completePlan({ ...f.q, expectedRevision: computePlanRevision(f.plan) }).ok);
  assert.ok(validatePlanRunCompletion({ ...f.q, runId: run.id }).ok);
});

test('two ready tasks use stable selection and capacity one across repeated advance', () => {
  const f = setup(false);
  let run = data(f.scheduler.advance(f.mutation(f.create()))).run;
  assert.equal(run.nodes[0]!.state, 'running');
  run = data(f.scheduler.advance(f.mutation(run))).run;
  assert.equal(run.nodes[1]!.state, 'pending');
  assert.equal(f.controls.length, 1);
});

test('failure pauses dispatch; explicit resume retains history and starts a retry', async () => {
  const f = setup();
  let run = data(f.scheduler.advance(f.mutation(f.create()))).run;
  const first = run.nodes[0]!.attempt_ids[0];
  await f.finish('failed');
  run = data(f.scheduler.advance(f.mutation(run))).run;
  assert.equal(run.state, 'paused');
  assert.equal(f.controls.length, 1);
  run = data(f.scheduler.advance(f.mutation(run))).run;
  assert.equal(f.controls.length, 1);
  run = data(f.scheduler.resume({ ...f.mutation(run), note: 'Failure inspected; retry approved' })).run;
  run = data(f.scheduler.advance(f.mutation(run))).run;
  assert.deepEqual(run.nodes[0]!.attempt_ids.slice(0, 1), [first]);
  assert.equal(run.nodes[0]!.attempt_ids.length, 2);
});

test('legacy done status cannot satisfy reuse without accepted attempt evidence and a note', () => {
  const f = setup();
  const item = data(showBacklogItem({ ...f.q, itemId: 'REP-001' })).item;
  data(updateBacklogItemStatus({ ...f.q, itemId: item.id, status: 'done', expectedRevision: item.revision }));
  const result = createPlanRun({ ...f.q, expectedRevision: computePlanRevision(f.plan) });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error.message, /reuse|accepted/i);
});

test('input and repository baseline drift block dispatch and are rechecked on resume', () => {
  const f = setup();
  let run = f.create();
  const item = data(showBacklogItem({ ...f.q, itemId: 'REP-002' })).item;
  data(updateBacklogItemContent({ ...f.q, itemId: item.id, title: 'Changed scope', expectedRevision: item.revision }));
  run = data(f.scheduler.advance(f.mutation(run))).run;
  assert.equal(run.state, 'paused');
  assert.match(run.diagnostics.join(' '), /input/i);
  assert.equal(f.scheduler.resume({ ...f.mutation(run), note: 'Try again' }).ok, false);
  assert.equal(f.controls.length, 0);
  const g = setup();
  let other = g.create();
  writeFileSync(path.join(g.repo, 'code.txt'), 'external modification');
  other = data(g.scheduler.advance(g.mutation(other))).run;
  assert.equal(other.state, 'paused');
  assert.match(other.diagnostics.join(' '), /baseline/i);
});

test('restart uncertainty pauses plan and prevents redispatch or resume', () => {
  const f = setup();
  let run = data(f.scheduler.advance(f.mutation(f.create()))).run;
  new ExecutionRuntime().recover(f.q);
  run = data(f.scheduler.advance(f.mutation(run))).run;
  assert.equal(run.nodes[0]!.state, 'unknown');
  assert.equal(run.state, 'paused');
  assert.equal(f.scheduler.resume({ ...f.mutation(run), note: 'Resume without confirming' }).ok, false);
  assert.equal(f.controls.length, 1);
});

test('reusing a completed node requires accepted current evidence and an explicit note', () => {
  const f = setup();
  const q = { ...f.q, itemId: 'REP-001' };
  let attempt = data(createExecution(q)).attempt;
  attempt = data(finishExecution({ ...q, attemptId: attempt.id, expectedRevision: attempt.revision, outcome: 'succeeded', summary: 'Fixture complete' })).attempt;
  attempt = data(verifyExecution({ ...q, attemptId: attempt.id, expectedRevision: attempt.revision, command: 'check', outcome: 'passed', evidence: 'verified' })).attempt;
  attempt = data(decideExecution({ ...q, attemptId: attempt.id, expectedRevision: attempt.revision, decision: 'accepted', note: 'reviewed' })).attempt;
  const request = { ...f.q, expectedRevision: computePlanRevision(f.plan) };
  assert.equal(createPlanRun({ ...request, reuse: [{ itemId: q.itemId, attemptId: attempt.id, note: '' }] }).ok, false);
  const run = data(createPlanRun({ ...request, reuse: [{ itemId: q.itemId, attemptId: attempt.id, note: 'Confirmed applicable to this run baseline' }] })).run;
  assert.equal(run.nodes[0]!.state, 'accepted');
  assert.equal(run.nodes[0]!.reuse_note, 'Confirmed applicable to this run baseline');
  assert.equal(data(f.scheduler.advance(f.mutation(run))).run.nodes[1]!.state, 'running');
});

test('pause keeps current work but prevents successor dispatch; stop waits for confirmation', async () => {
  const f = setup();
  let run = data(f.scheduler.advance(f.mutation(f.create()))).run;
  run = data(f.scheduler.pause({ ...f.mutation(run), note: 'Inspect current work' })).run;
  await f.finish();
  f.accept(run);
  run = data(f.scheduler.advance(f.mutation(run))).run;
  assert.equal(run.state, 'paused');
  assert.equal(f.controls.length, 1);
  run = data(f.scheduler.resume({ ...f.mutation(run), note: 'Continue inspected plan' })).run;
  run = data(f.scheduler.advance(f.mutation(run))).run;
  run = data(f.scheduler.stopCurrent(f.mutation(run))).run;
  assert.equal(run.state, 'paused');
  assert.equal(f.scheduler.resume({ ...f.mutation(run), note: 'Too soon' }).ok, false);
  await f.finish('stopped');
  run = data(f.scheduler.advance(f.mutation(run))).run;
  assert.equal(run.nodes[1]!.state, 'failed');
});

test('a completed run cannot be followed by dispatch using acceptance from changed code', async () => {
  const f = setup();
  let run = data(f.scheduler.advance(f.mutation(f.create()))).run;
  await f.finish();
  f.accept(run);
  writeFileSync(path.join(f.repo, 'code.txt'), 'changed after acceptance');
  run = data(f.scheduler.advance(f.mutation(run))).run;
  assert.equal(run.state, 'paused');
  assert.equal(f.controls.length, 1);
  assert.match(run.diagnostics.join(' '), /baseline|accepted/i);
});

test('stopping an obsolete scope preserves its history and allows creating a new snapshot', () => {
  const f = setup();
  let run = f.create();
  const revised = { ...f.plan, goal: 'New approved scope' };
  updatePlan(path.join(f.q.workspaceDir, 'ops/repo/plans'), revised);
  run = data(f.scheduler.advance(f.mutation(run))).run;
  assert.equal(run.state, 'paused');
  assert.equal(f.scheduler.resume({ ...f.mutation(run), note: 'Old scope cannot resume' }).ok, false);
  assert.equal(f.scheduler.closeStopped({ ...f.mutation(run), note: '' }).ok, false);
  run = data(f.scheduler.closeStopped({ ...f.mutation(run), note: 'Superseded by approved revision' })).run;
  assert.equal(run.state, 'stopped');
  const next = data(createPlanRun({ ...f.q, expectedRevision: computePlanRevision(revised) })).run;
  assert.notEqual(next.id, run.id);
  assert.equal(f.current(run).plan_revision, computePlanRevision(f.plan));
});

test('scope termination refuses active or unknown work', () => {
  const f = setup();
  const run = data(f.scheduler.advance(f.mutation(f.create()))).run;
  assert.equal(f.scheduler.closeStopped({ ...f.mutation(run), note: 'Cannot abandon running process' }).ok, false);
  new ExecutionRuntime().recover(f.q);
  assert.equal(f.scheduler.closeStopped({ ...f.mutation(run), note: 'Unknown also blocks' }).ok, false);
});

test('new scope retains prior ended attempts and retries with the new immutable task input', async () => {
  const f = setup();
  let run = data(f.scheduler.advance(f.mutation(f.create()))).run;
  const prior = run.nodes[0]!.attempt_ids[0]!;
  await f.finish('failed');
  run = data(f.scheduler.closeStopped({ ...f.mutation(run), note: 'Replace obsolete run' })).run;
  const item = data(showBacklogItem({ ...f.q, itemId: 'REP-001' })).item;
  data(updateBacklogItemContent({ ...f.q, itemId: item.id, expectedRevision: item.revision, title: 'Current task scope' }));
  let next = f.create();
  assert.deepEqual(next.nodes[0]!.attempt_ids, [prior]);
  next = data(f.scheduler.advance(f.mutation(next))).run;
  const attemptId = next.nodes[0]!.attempt_ids.at(-1)!;
  const attempt = data(showExecution({ ...f.q, attemptId })).attempt;
  assert.equal(attempt.retry_of, prior);
  assert.equal(attempt.input.item.title, 'Current task scope');
});

test('resume cannot convert accepted but drifted output into a valid predecessor', async () => {
  const f = setup();
  let run = data(f.scheduler.advance(f.mutation(f.create()))).run;
  run = data(f.scheduler.pause(f.mutation(run))).run;
  await f.finish();
  f.accept(run);
  writeFileSync(path.join(f.repo, 'code.txt'), 'changed after acceptance');
  const { captureSnapshot } = await import('../src/execution/snapshot.js');
  const baselineDigest = captureSnapshot(f.repo).digest;
  assert.equal(f.scheduler.resume({ ...f.mutation(run), note: 'Inspected changed code', baselineDigest }).ok, false);
  assert.equal(f.controls.length, 1);
});

test('input drift pauses dispatch while ended attempt state remains observable', async () => {
  const f = setup();
  let run = data(f.scheduler.advance(f.mutation(f.create()))).run;
  const item = data(showBacklogItem({ ...f.q, itemId: 'REP-002' })).item;
  data(updateBacklogItemContent({ ...f.q, itemId: item.id, title: 'Revised pending scope', expectedRevision: item.revision }));
  run = data(f.scheduler.advance(f.mutation(run))).run;
  assert.equal(run.state, 'paused');
  await f.finish('failed');
  run = data(f.scheduler.advance(f.mutation(run))).run;
  assert.equal(run.nodes[0]!.state, 'failed');
  assert.match(run.diagnostics.join(' '), /input/i);
  assert.equal(f.controls.length, 1);
  assert.equal(f.scheduler.closeStopped({ ...f.mutation(run), note: 'Stopped obsolete scope' }).ok, true);
});

test('completion validation reads current inputs, final baseline and durable evidence without writing', async () => {
  const f = setup();
  let run = data(f.scheduler.advance(f.mutation(f.create()))).run;
  writeFileSync(path.join(f.repo, 'code.txt'), 'first accepted output');
  await f.finish();
  f.accept(run);
  run = data(f.scheduler.advance(f.mutation(run))).run;
  writeFileSync(path.join(f.repo, 'code.txt'), 'first and second accepted output');
  await f.finish();
  const last = f.accept(run);
  run = data(f.scheduler.advance(f.mutation(run))).run;
  const query = { ...f.q, runId: run.id };
  const file = path.join(f.q.workspaceDir, 'ops/repo/executions/plan-runs', `${run.id}.json`);
  const before = readFileSync(file, 'utf8');
  const valid = data(validatePlanRunCompletion(query));
  assert.equal(valid.attempts.length, 2);
  assert.notEqual(valid.attempts[0]!.snapshot!.digest, valid.attempts[1]!.snapshot!.digest);
  assert.equal(readFileSync(file, 'utf8'), before);
  writeFileSync(path.join(f.repo, 'code.txt'), 'unverified later edit');
  assert.equal(validatePlanRunCompletion(query).ok, false);
  writeFileSync(path.join(f.repo, 'code.txt'), 'first and second accepted output');
  writeFileSync(path.join(f.q.workspaceDir, 'ops/repo/executions', last.verifications[0]!.evidence_ref), 'replaced evidence');
  assert.equal(validatePlanRunCompletion(query).ok, false);
  assert.equal(readFileSync(file, 'utf8'), before);
});

test('run freezes additional instructions and preserves them in initial and retried attempts', async () => {
  const f = setup();
  const instructions = 'Read-only requirement review. Do not modify repository files.';
  let run = f.create(instructions);
  assert.equal(run.instructions, instructions);
  run = data(f.scheduler.advance(f.mutation(run))).run;
  const first = data(showExecution({ ...f.q, attemptId: run.nodes[0]!.attempt_ids.at(-1)! })).attempt;
  assert.match(first.input.instructions, /Read-only requirement review/);
  assert.match(first.input.instructions, /Implement first/);
  await f.finish('failed');
  run = data(f.scheduler.advance(f.mutation(run))).run;
  run = data(f.scheduler.resume({ ...f.mutation(run), note: 'Retry the same read-only review' })).run;
  run = data(f.scheduler.advance(f.mutation(run))).run;
  const retried = data(showExecution({ ...f.q, attemptId: run.nodes[0]!.attempt_ids.at(-1)! })).attempt;
  assert.equal(retried.input.instructions, first.input.instructions);
  assert.equal(f.current(run).instructions, instructions);
});

test('historical Plan completion permits later development but still checks accepted evidence', async () => {
  const f = setup();
  let run = data(f.scheduler.advance(f.mutation(f.create()))).run;
  await f.finish(); f.accept(run);
  run = data(f.scheduler.advance(f.mutation(run))).run;
  await f.finish();
  const accepted = f.accept(run);
  run = data(f.scheduler.advance(f.mutation(run))).run;
  assert.equal(run.state, 'completed');
  writeFileSync(path.join(f.repo, 'later-feature.txt'), 'Unrelated development after delivery');
  const strict = validatePlanRunCompletion({ ...f.q, runId: run.id });
  assert.equal(strict.ok, false);
  if (!strict.ok) assert.match(strict.error.message, /baseline changed/);

  const evidence = path.join(f.q.workspaceDir, 'ops/repo/executions', accepted.verifications[0]!.evidence_ref);
  const original = readFileSync(evidence, 'utf8');
  writeFileSync(evidence, 'corrupted evidence');
  const rejected = completePlan({ ...f.q, expectedRevision: computePlanRevision(f.plan) });
  assert.equal(rejected.ok, false);
  assert.equal(readPlan(path.join(f.q.workspaceDir, 'ops/repo/plans'), f.plan.id).status, 'approved');
  writeFileSync(evidence, original);

  const completed = completePlan({ ...f.q, expectedRevision: computePlanRevision(f.plan) });
  assert.equal(completed.ok, true, JSON.stringify(completed));
  if (completed.ok) assert.equal(completed.data.plan.status, 'done');
  assert.deepEqual(f.current(run), run);
  assert.equal(validatePlanRunCompletion({ ...f.q, runId: run.id }).ok, false);
});
