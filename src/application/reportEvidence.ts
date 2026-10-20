import { context, evidenceDigest, readAttempt } from "../execution/store.js";
import type { DependencyEvidence } from "./dependencyReadiness.js";
import { verificationChecksForSnapshot } from "./verificationChecks.js";

export function reportTaskEvidence(workspace: string, proof: DependencyEvidence): string[] {
  const { project, item } = proof.reference;
  const prefix = `Task ${project}:${item}`;
  const basis = `${prefix}; basis: ${proof.basis}; attempt: ${proof.attempt_id ?? "none"}; snapshot: ${proof.snapshot_digest ?? "none"}; verification: ${proof.verification_digest ?? "none"}; landing: ${proof.landing_digest ?? "none"}`;
  if (!proof.attempt_id) return [basis];
  const c = context(workspace, project);
  const attempt = readAttempt(c.root, proof.attempt_id, project);
  const checks = verificationChecksForSnapshot(attempt.verifications, proof.snapshot_digest);
  return [
    `${basis}; acceptance: accepted at ${attempt.acceptance!.at}; source: project-ops:executions/${attempt.id}.json`,
    ...checks.map(
      (check, index) =>
        `${prefix}; check ${index + 1}: ${check.outcome}; at: ${check.at}; command_sha256: ${evidenceDigest(check.command)}; evidence: project-ops:executions/${check.evidence_ref}; sha256: ${check.evidence_digest}`,
    ),
  ];
}
