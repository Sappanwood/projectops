import type { ExecutionAttempt } from "../execution/attempt.js";
import { verificationChecksForSnapshot } from "./verificationChecks.js";

export function executionSummary(a: ExecutionAttempt) {
  const checks = verificationChecksForSnapshot(a.verifications, a.snapshot?.digest);
  const latest = a.verifications.at(-1);
  return {
    id: a.id,
    project_id: a.project_id,
    item_id: a.item_id,
    revision: a.revision,
    state: a.state,
    origin: a.origin,
    retry_of: a.retry_of,
    snapshot_digest: a.snapshot?.digest ?? null,
    acceptance: a.acceptance ? { decision: a.acceptance.decision, at: a.acceptance.at } : null,
    verification: {
      total: a.verifications.length,
      passed: checks.filter((check) => check.outcome === "passed").length,
      failed: checks.filter((check) => check.outcome === "failed").length,
      latest: latest
        ? {
            command: latest.command.slice(0, 240),
            command_truncated: latest.command.length > 240,
            outcome: latest.outcome,
            at: latest.at,
            snapshot_digest: latest.snapshot.digest,
            evidence_ref: latest.evidence_ref,
            evidence_digest: latest.evidence_digest,
          }
        : null,
    },
  };
}
