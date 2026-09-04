// Application use case: create a plan artifact from an explicit JSON draft.

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import type { CliIO } from "../io.js";
import { createPlan, parsePlanDraft } from "../plan/plan.js";
import { PlanAlreadyExistsError, writePlan } from "../plan/planFs.js";
import { resolvePlansRoot } from "./planContext.js";

export function planCreate(
  projectId: string | undefined,
  args: string[],
  json: boolean,
  io: CliIO,
  cwd: string,
): number {
  if (projectId === undefined) {
    io.stderr("Usage: pops plan create <project-id> --input <draft.json> [--json]");
    return 1;
  }
  const root = resolvePlansRoot(projectId, io, cwd, true);
  if (root === null) return 1;

  let input: string | undefined;
  try {
    input = parseArgs({
      args,
      options: { input: { type: "string" } },
      allowPositionals: false,
      strict: true,
    }).values.input;
  } catch {
    io.stderr("Error: invalid arguments");
    return 1;
  }
  if (input === undefined) {
    io.stderr("Error: --input is required");
    return 1;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(input, "utf8"));
  } catch {
    io.stderr(`Error: cannot read valid JSON input: ${input}`);
    return 1;
  }
  const draft = parsePlanDraft(raw);
  if (typeof draft === "string") {
    io.stderr(`Error: ${draft}`);
    return 1;
  }
  const plan = createPlan(draft);
  if (typeof plan === "string") {
    io.stderr(`Error: ${plan}`);
    return 1;
  }
  try {
    writePlan(root, plan);
  } catch (error) {
    if (error instanceof PlanAlreadyExistsError) {
      io.stderr(`Error: ${error.message}`);
      return 1;
    }
    throw error;
  }

  if (json) {
    io.stdout(JSON.stringify({ ok: true, plan }));
  } else {
    io.stdout(`Created ${plan.id}: ${plan.title}`);
  }
  return 0;
}
