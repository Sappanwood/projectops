import {
  createParallelRun,
  listParallelRuns,
  showParallelRun,
  type ParallelRunRuntime,
} from "../application/parallelRunApi.js";
import { executionResult } from "../application/executionApi.js";
import { context } from "../execution/store.js";
import { captureSnapshot } from "../execution/snapshot.js";
import type { ApplicationResult } from "../application/result.js";

type Http = {
  model(value: unknown): Promise<import("../execution/models.js").ModelRef | undefined>;
  method(expected: string): void;
  noQuery(): void;
  query(name: string): string | undefined;
  body(keys: string[]): Promise<Record<string, unknown>>;
  send(result: ApplicationResult<unknown>): void;
  invalid(message: string): never;
};
export async function handleParallelRunRoute(
  segments: string[],
  method: string | undefined,
  workspaceDir: string,
  runtime: ParallelRunRuntime,
  commands: string[][],
  http: Http,
): Promise<boolean> {
  if (segments[0] !== "api" || segments[1] !== "projects" || segments[3] !== "parallel-runs")
    return false;
  const input = { workspaceDir, projectId: segments[2]! };
  if (segments.length === 4 && method === "GET") {
    const planId = http.query("plan_id");
    http.send(listParallelRuns({ ...input, ...(planId ? { planId } : {}) }));
    return true;
  }
  http.noQuery();
  if (segments.length === 4) {
    http.method("POST");
    const body = await http.body(["plan_id", "expected_revision", "model"]);
    if (typeof body.plan_id !== "string" || typeof body.expected_revision !== "string")
      http.invalid("Plan ID and expected revision are required.");
    const model = await http.model(body.model);
    const base = executionResult(
      () => captureSnapshot(context(workspaceDir, input.projectId).repo).head,
    );
    if (!base.ok) http.send(base);
    else
      http.send(
        createParallelRun({
          ...input,
          model,
          planId: body.plan_id,
          expectedRevision: body.expected_revision,
          baseCommit: base.data,
          commands,
        }),
      );
    return true;
  }
  if (segments.length === 5) {
    http.method("GET");
    http.send(showParallelRun({ ...input, runId: segments[4]! }));
    return true;
  }
  if (
    segments.length === 6 &&
    ["advance", "pause", "resume", "land", "rework", "close-stopped"].includes(segments[5]!)
  ) {
    http.method("POST");
    const action = segments[5]!;
    const body = await http.body(
      action === "resume"
        ? ["expected_revision", "note", "integration_head"]
        : action === "close-stopped"
          ? ["expected_revision", "note"]
          : action === "rework"
            ? ["expected_revision", "node_key", "note"]
            : action === "land"
              ? ["expected_revision", "node_key"]
              : ["expected_revision"],
    );
    if (
      typeof body.expected_revision !== "string" ||
      Object.values(body).some((value) => typeof value !== "string")
    )
      http.invalid("Run mutation requires an expected revision.");
    const q = { ...input, runId: segments[4]!, expectedRevision: body.expected_revision };
    if (action === "advance") http.send(await runtime.advance(q));
    else if (action === "pause") http.send(await runtime.pause(q));
    else if (action === "resume")
      http.send(
        await runtime.resume({
          ...q,
          note: typeof body.note === "string" ? body.note : "",
          ...(typeof body.integration_head === "string"
            ? { integrationHead: body.integration_head }
            : {}),
        }),
      );
    else if (action === "close-stopped")
      http.send(
        await runtime.closeStopped({ ...q, note: typeof body.note === "string" ? body.note : "" }),
      );
    else {
      if (typeof body.node_key !== "string" || !body.node_key)
        http.invalid("A node key is required.");
      if (action === "rework") {
        if (typeof body.note !== "string" || !body.note.trim())
          http.invalid("A rework explanation is required.");
        http.send(await runtime.rework({ ...q, nodeKey: body.node_key, note: body.note }));
      } else http.send(await runtime.land({ ...q, nodeKey: body.node_key }));
    }
    return true;
  }
  return false;
}
