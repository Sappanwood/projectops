// Filesystem adapter for plan artifacts.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { isPlanId, parsePlan, serializePlan, type Plan } from "./plan.js";

export class PlanNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Plan not found: ${id}`);
  }
}

export class PlanAlreadyExistsError extends Error {
  constructor(public readonly id: string) {
    super(`Plan already exists: ${id}`);
  }
}

export class PlanParseError extends Error {
  constructor(public readonly id: string, problem: string) {
    super(`Invalid plan ${id}: ${problem}`);
  }
}

function planPath(root: string, id: string): string {
  if (!isPlanId(id)) throw new PlanNotFoundError(id);
  return path.join(root, `${id}.json`);
}

export function listPlanIds(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.slice(0, -5))
    .filter(isPlanId)
    .sort();
}

export function readPlan(root: string, id: string): Plan {
  const file = planPath(root, id);
  if (!existsSync(file)) throw new PlanNotFoundError(id);
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new PlanParseError(id, "invalid JSON");
  }
  const plan = parsePlan(value);
  if (typeof plan === "string") throw new PlanParseError(id, plan);
  return plan;
}

export function writePlan(root: string, plan: Plan): void {
  try {
    writeFileSync(planPath(root, plan.id), serializePlan(plan), { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new PlanAlreadyExistsError(plan.id);
    }
    throw error;
  }
}
