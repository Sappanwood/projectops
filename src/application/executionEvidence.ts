import { readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { isWithinWorkspace } from '../catalog/workspace.js';
import { context, evidenceDigest, ExecutionError, readAttempt } from '../execution/store.js';
import { executionResult, type AttemptQuery } from './executionApi.js';

export function getExecutionEvidence(q: AttemptQuery & { ref: string }) {
  return executionResult(() => {
    const c = context(q.workspaceDir, q.projectId);
    const attempt = readAttempt(c.root, q.attemptId, q.projectId);
    if (q.itemId && attempt.item_id !== q.itemId) throw new ExecutionError('EXECUTION_NOT_FOUND', 'Attempt does not belong to this task.');
    const verification = attempt.verifications.find(v => v.evidence_ref === q.ref);
    if (!verification || !/^evidence\/exe-[a-f0-9-]+\.txt$/.test(q.ref))
      throw new ExecutionError('EXECUTION_INVALID', 'Evidence is not referenced by this attempt.');
    try {
      const file = realpathSync(path.join(c.root, q.ref));
      if (!isWithinWorkspace(realpathSync(c.root), file) || !statSync(file).isFile()) throw new Error('Invalid evidence target.');
      const body = readFileSync(file, 'utf8');
      if (!body.trim() || evidenceDigest(body) !== verification.evidence_digest) throw new Error('Invalid evidence digest.');
      return { ref: q.ref, body: body.slice(0, 65536), truncated: body.length > 65536 };
    } catch {
      throw new ExecutionError('EXECUTION_INVALID', 'Evidence is unavailable or its content has changed.');
    }
  });
}
