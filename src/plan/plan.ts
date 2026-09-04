// Plan domain: versioned plan artifacts and validation.

export const PLAN_SCHEMA = "plan/Plan@1";
export const PLAN_ITEM_TYPES = ["task", "epic"] as const;
export const PLAN_PRIORITIES = ["P0", "P1", "P2", "P3"] as const;

export type PlanItemType = (typeof PLAN_ITEM_TYPES)[number];
export type PlanPriority = (typeof PLAN_PRIORITIES)[number];

export type PlanItem = {
  key: string;
  title: string;
  item_type: PlanItemType;
  priority: PlanPriority;
  body: string;
  depends_on: string[];
};

export type Plan = {
  schema: typeof PLAN_SCHEMA;
  id: string;
  title: string;
  goal: string;
  items: PlanItem[];
};

export type PlanDraft = {
  title: string;
  goal: string;
  items: PlanItem[];
};

export function planIdForTitle(title: string): string | null {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug !== "") return `plan-${slug}`;
  const codePoints = Array.from(title, (character) => `u${character.codePointAt(0)?.toString(16)}`).join("-");
  return `plan-${codePoints}`;
}

export function createPlan(draft: PlanDraft): Plan | string {
  const problem = validateDraft(draft);
  if (problem !== null) return problem;
  const normalized = normalizeDraft(draft);
  const id = planIdForTitle(normalized.title);
  if (id === null) return "plan title must be a non-empty string";
  return { schema: PLAN_SCHEMA, id, ...normalized };
}

export function parsePlanDraft(value: unknown): PlanDraft | string {
  const problem = validateDraft(value);
  return problem === null ? normalizeDraft(value as PlanDraft) : problem;
}

export function parsePlan(value: unknown): Plan | string {
  if (!isRecord(value) || value.schema !== PLAN_SCHEMA || typeof value.id !== "string" || !isPlanId(value.id)) {
    return "unexpected plan schema";
  }
  const draft = parsePlanDraft({
    title: value.title,
    goal: value.goal,
    items: value.items,
  });
  if (typeof draft === "string") return draft;
  return { schema: PLAN_SCHEMA, id: value.id, ...draft };
}

export function isPlanId(value: string): boolean {
  return /^plan-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

export function serializePlan(plan: Plan): string {
  return `${JSON.stringify(plan, null, 2)}\n`;
}

function validateDraft(value: unknown): string | null {
  if (!isRecord(value)) return "plan input must be an object";
  if (typeof value.title !== "string" || value.title === "") return "plan title must be a non-empty string";
  if (typeof value.goal !== "string" || value.goal === "") return "plan goal must be a non-empty string";
  if (!Array.isArray(value.items)) return "plan items must be an array";

  const keys = new Set<string>();
  for (const item of value.items) {
    const problem = validateItem(item, keys);
    if (problem !== null) return problem;
    keys.add(item.key);
  }
  for (const item of value.items) {
    for (const dependency of item.depends_on ?? []) {
      if (!keys.has(dependency)) return `plan item dependency not found: ${dependency}`;
    }
  }
  return null;
}

function normalizeDraft(draft: PlanDraft): PlanDraft {
  return {
    title: draft.title,
    goal: draft.goal,
    items: draft.items.map((item) => ({
      key: item.key,
      title: item.title,
      item_type: item.item_type,
      priority: item.priority,
      body: item.body,
      depends_on: item.depends_on ?? [],
    })),
  };
}

function validateItem(value: unknown, keys: Set<string>): string | null {
  if (!isRecord(value)) return "plan item must be an object";
  if (typeof value.key !== "string" || !/^[a-z][a-z0-9-]*$/.test(value.key)) {
    return "plan item key must use lowercase letters, digits, and hyphens";
  }
  if (keys.has(value.key)) return `duplicate plan item key: ${value.key}`;
  if (typeof value.title !== "string" || value.title === "") return `plan item ${value.key} title must be a non-empty string`;
  if (!PLAN_ITEM_TYPES.includes(value.item_type as PlanItemType)) {
    return `plan item ${value.key} type must be one of: ${PLAN_ITEM_TYPES.join(", ")}`;
  }
  if (!PLAN_PRIORITIES.includes(value.priority as PlanPriority)) {
    return `plan item ${value.key} priority must be one of: ${PLAN_PRIORITIES.join(", ")}`;
  }
  if (typeof value.body !== "string") return `plan item ${value.key} body must be a string`;
  if (value.depends_on !== undefined && (!Array.isArray(value.depends_on) || !value.depends_on.every((dependency) => typeof dependency === "string"))) {
    return `plan item ${value.key} depends_on must be an array of keys`;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
