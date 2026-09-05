import type { Verification } from "../execution/attempt.js";
import { evidenceReadable } from "../execution/store.js";

export function verificationChecksForSnapshot(
  verifications: Verification[],
  snapshotDigest: string | null | undefined,
): Verification[] {
  return [
    ...new Map(
      verifications
        .filter((check) => check.snapshot.digest === snapshotDigest)
        .map((check) => [check.command, check]),
    ).values(),
  ];
}

export function verificationChecksPass(root: string, checks: Verification[]): boolean {
  return checks.every(
    (check) =>
      check.outcome === "passed" &&
      evidenceReadable(root, check.evidence_ref, check.evidence_digest),
  );
}
