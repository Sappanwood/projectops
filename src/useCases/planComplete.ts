import { parseArgs } from 'node:util';
import { completePlan } from '../application/planComplete.js';
import { applicationFailure } from '../application/result.js';
import type { CliIO } from '../io.js';

export function planComplete(projectId: string | undefined, planId: string | undefined, args: string[], json: boolean, io: CliIO, cwd: string): number {
  let expectedRevision: string | undefined;
  try {
    expectedRevision = parseArgs({ args, options: { 'expected-revision': { type: 'string' } }, strict: true, allowPositionals: false }).values['expected-revision'];
  } catch { /* Invalid arguments use the same CLI error envelope. */ }
  const result = projectId && planId && expectedRevision
    ? completePlan({ workspaceDir: cwd, projectId, planId, expectedRevision })
    : applicationFailure('PLAN_INVALID', 'Usage: pops plan complete <project> <plan> --expected-revision <revision> [--json]');
  if (json) io.stdout(JSON.stringify(result));
  else if (result.ok) io.stdout(`Completed ${planId}`);
  else io.stderr(`Error: ${result.error.message}`);
  return result.ok ? 0 : 1;
}
