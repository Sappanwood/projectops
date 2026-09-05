import { createPlanRun, listPlanRuns, showPlanRun } from '../application/planRunApi.js';
import type { ApplicationResult } from '../application/result.js';
import type { PlanRunRuntime } from '../application/planRunApi.js';

type Http = {
  model(value: unknown): Promise<import('../execution/models.js').ModelRef | undefined>;
  method(expected: string): void;
  noQuery(): void;
  query(name: string): string | undefined;
  body(keys: string[]): Promise<Record<string, unknown>>;
  send(result: ApplicationResult<unknown>): void;
  invalid(message: string): never;
};
export async function handlePlanRunRoute(segments: string[], method: string | undefined, workspaceDir: string, runtime: PlanRunRuntime, http: Http): Promise<boolean> {
  if (segments[0] !== 'api' || segments[1] !== 'projects' || segments[3] !== 'plan-runs') return false;
  const input = { workspaceDir, projectId: segments[2]! };
  if (segments.length === 4 && method === 'GET') {
    const planId = http.query('plan_id');
    http.send(listPlanRuns({ ...input, ...(planId ? { planId } : {}) })); return true;
  }
  http.noQuery();
  if (segments.length === 4) {
    http.method('POST');
    const body = await http.body(['plan_id', 'expected_revision', 'reuse', 'instructions', 'model']);
    if (typeof body.plan_id !== 'string' || typeof body.expected_revision !== 'string' || (body.instructions !== undefined && typeof body.instructions !== 'string')) http.invalid('Plan ID and expected revision are required.');
    let reuse: { itemId: string; attemptId: string; note: string }[] | undefined;
    if (body.reuse !== undefined) {
      if (!Array.isArray(body.reuse)) http.invalid('Reuse entries must be an array.');
      reuse = body.reuse.map(value => {
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['item_id', 'attempt_id', 'note'].includes(key)) || typeof value.item_id !== 'string' || typeof value.attempt_id !== 'string' || typeof value.note !== 'string') http.invalid('Reuse entry is invalid.');
        return { itemId: value.item_id, attemptId: value.attempt_id, note: value.note };
      });
    }
    const model = await http.model(body.model);
    http.send(createPlanRun({ ...input, model, planId: body.plan_id, expectedRevision: body.expected_revision, ...(reuse ? { reuse } : {}), ...(typeof body.instructions === 'string' ? { instructions: body.instructions } : {}) })); return true;
  }
  if (segments.length === 5) {
    http.method('GET'); http.send(showPlanRun({ ...input, runId: segments[4]! })); return true;
  }
  if (segments.length === 6 && ['advance', 'pause', 'resume', 'stop-current', 'close-stopped'].includes(segments[5]!)) {
    http.method('POST');
    const action = segments[5]!;
    const body = await http.body(action === 'resume' ? ['expected_revision', 'note', 'baseline_digest'] : action === 'close-stopped' ? ['expected_revision', 'note'] : ['expected_revision']);
    if (typeof body.expected_revision !== 'string' || Object.values(body).some(value => typeof value !== 'string')) http.invalid('Run mutation requires an expected revision.');
    const q = { ...input, runId: segments[4]!, expectedRevision: body.expected_revision,
      ...(typeof body.note === 'string' ? { note: body.note } : {}), ...(typeof body.baseline_digest === 'string' ? { baselineDigest: body.baseline_digest } : {}) };
    http.send(action === 'advance' ? await runtime.advance(q) : action === 'pause' ? await runtime.pause(q) : action === 'resume' ? await runtime.resume({ ...q, note: typeof body.note === 'string' ? body.note : '' }) : action === 'close-stopped' ? await runtime.closeStopped({ ...q, note: typeof body.note === 'string' ? body.note : '' }) : await runtime.stopCurrent(q));
    return true;
  }
  return false;
}
