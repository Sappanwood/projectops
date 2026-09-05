// Plan domain: versioned plan artifacts and validation.

export const PLAN_SCHEMA = "plan/Plan@1";
export const PLAN_ITEM_TYPES = ["task", "epic"] as const;
export const PLAN_PRIORITIES = ["P0", "P1", "P2", "P3"] as const;
export const PLAN_STATUSES = ["draft", "approved", "done"] as const;

export type PlanItemType = (typeof PLAN_ITEM_TYPES)[number];
export type PlanPriority = (typeof PLAN_PRIORITIES)[number];
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export type PlanApproval = {
  approved_at: string;
  review_note: string;
};

export type PlanItem = {
  key: string;
  title: string;
  item_type: PlanItemType;
  priority: PlanPriority;
  body: string;
  parent?: string;
  depends_on: string[];
  parallel?: boolean;
  resources?: string[];
};

export type PlanMaterialization = {
  materialized_at: string;
  mapping: Record<string, string>;
};

export type Plan = {
  schema: typeof PLAN_SCHEMA;
  id: string;
  title: string;
  goal: string;
  items: PlanItem[];
  status: PlanStatus;
  approval?: PlanApproval;
  materialization?: PlanMaterialization;
  execution_policy?: { max_parallel: 2 };
};

export type PlanDraft = {
  title: string;
  goal: string;
  items: PlanItem[];
  execution_policy?: { max_parallel: 2 };
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
  return { schema: PLAN_SCHEMA, id, ...normalized, status: "draft" };
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
    ...(value.execution_policy === undefined ? {} : { execution_policy: value.execution_policy }),
  });
  if (typeof draft === "string") return draft;
  const statusValue = value.status === undefined ? "draft" : value.status;
  if (!PLAN_STATUSES.includes(statusValue as PlanStatus)) {
    return `plan status must be one of: ${PLAN_STATUSES.join(", ")}`;
  }
  const status = statusValue as PlanStatus;
  if (status === "draft" && value.approval !== undefined) {
    return "draft plan must not have an approval record";
  }
  if (status === "draft" && value.materialization !== undefined) {
    return "draft plan must not have a materialization record";
  }
  if (status === "approved" || status === "done") {
    const approval = parseApproval(value.approval);
    if (typeof approval === "string") return approval;
    const materialization = parseMaterialization(value.materialization, draft.items);
    if (typeof materialization === "string") return materialization;
    if (status === "done" && !materialization) return "done plan must have a materialization record";
    return {
      schema: PLAN_SCHEMA,
      id: value.id,
      ...draft,
      status,
      approval,
      ...(materialization === undefined ? {} : { materialization }),
    };
  }
  return { schema: PLAN_SCHEMA, id: value.id, ...draft, status };
}

export function isPlanId(value: string): boolean {
  return /^plan-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

export function serializePlan(plan: Plan): string {
  return `${JSON.stringify(plan, null, 2)}\n`;
}

export function materializationOrder(items: PlanItem[]): PlanItem[] | string {
  const pending = new Map(items.map((item) => [item.key, item]));
  const ordered: PlanItem[] = [];
  const available = new Set<string>();
  while (pending.size > 0) {
    const next = items.find((item) => pending.has(item.key) &&
      (item.parent === undefined || available.has(item.parent)) &&
      (item.depends_on ?? []).every((dependency) => available.has(dependency)));
    if (next === undefined) return "plan item parent or dependency graph cannot be materialized";
    pending.delete(next.key);
    available.add(next.key);
    ordered.push(next);
  }
  return ordered;
}

function validateDraft(value: unknown): string | null {
  if (!isRecord(value)) return "plan input must be an object";
  if (typeof value.title !== "string" || value.title === "") return "plan title must be a non-empty string";
  if (typeof value.goal !== "string" || value.goal === "") return "plan goal must be a non-empty string";
  if (!Array.isArray(value.items)) return "plan items must be an array";
  if (value.execution_policy !== undefined && (!isRecord(value.execution_policy) || value.execution_policy.max_parallel !== 2)) return "execution_policy.max_parallel must be 2 when parallel execution is explicitly enabled";

  const keys = new Set<string>();
  for (const item of value.items) {
    const problem = validateItem(item, keys);
    if (problem !== null) return problem;
    keys.add(item.key);
  }
  const itemsByKey = new Map(value.items.map((item) => [item.key, item]));
  for (const item of value.items) {
    if (item.parent !== undefined) {
      if (!keys.has(item.parent)) return `plan item parent not found: ${item.parent}`;
      if (item.item_type === "epic") return `plan item ${item.key} cannot have a parent`;
      if (itemsByKey.get(item.parent)?.item_type !== "epic") return `plan item parent must be an epic: ${item.parent}`;
    }
    for (const dependency of item.depends_on ?? []) {
      if (!keys.has(dependency)) return `plan item dependency not found: ${dependency}`;
    }
  }
  const order = materializationOrder(value.items as PlanItem[]);
  if (typeof order === "string") return order;
  return null;
}

function normalizeDraft(draft: PlanDraft): PlanDraft {
  return {
    title: draft.title,
    goal: draft.goal,
    ...(draft.execution_policy === undefined ? {} : { execution_policy: { max_parallel: 2 as const } }),
    items: draft.items.map((item) => ({
      key: item.key,
      title: item.title,
      item_type: item.item_type,
      priority: item.priority,
      body: item.body,
      ...(item.parent === undefined ? {} : { parent: item.parent }),
      depends_on: item.depends_on ?? [],
      ...(item.parallel === undefined ? {} : { parallel: item.parallel }),
      ...(item.resources === undefined ? {} : { resources: [...item.resources] }),
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
  if (value.parallel !== undefined && typeof value.parallel !== 'boolean') return `plan item ${value.key} parallel must be boolean`;
  if (value.resources !== undefined && (!Array.isArray(value.resources) || !value.resources.every(resource => typeof resource === 'string' && /^[a-z][a-z0-9-]*$/.test(resource)) || new Set(value.resources).size !== value.resources.length)) return `plan item ${value.key} resources must contain unique resource names`;
  if (value.parent !== undefined && (typeof value.parent !== "string" || !/^[a-z][a-z0-9-]*$/.test(value.parent))) {
    return `plan item ${value.key} parent must be a local key`;
  }
  if (value.depends_on !== undefined && (!Array.isArray(value.depends_on) || !value.depends_on.every((dependency) => typeof dependency === "string"))) {
    return `plan item ${value.key} depends_on must be an array of keys`;
  }
  return null;
}

function parseMaterialization(value: unknown, items: PlanItem[]): PlanMaterialization | string | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || typeof value.materialized_at !== "string" || value.materialized_at.trim() === "") {
    return "plan materialization must have a timestamp";
  }
  if (!isRecord(value.mapping)) return "plan materialization mapping must be an object";
  const keys = new Set(items.map((item) => item.key));
  const mapping: Record<string, string> = {};
  for (const [key, id] of Object.entries(value.mapping)) {
    if (!keys.has(key)) return `plan materialization mapping has unknown key: ${key}`;
    if (typeof id !== "string" || !/^[A-Z0-9]+-\d{3,}$/.test(id)) {
      return `plan materialization mapping has invalid backlog id for ${key}`;
    }
    mapping[key] = id;
  }
  if (Object.keys(mapping).length !== items.length) {
    return "plan materialization mapping must include every plan item";
  }
  return { materialized_at: value.materialized_at, mapping };
}

function parseApproval(value: unknown): PlanApproval | string {
  if (!isRecord(value)) return "approved plan must have an approval record";
  if (typeof value.approved_at !== "string" || value.approved_at.trim() === "") {
    return "plan approval approved_at must be a non-empty string";
  }
  if (typeof value.review_note !== "string" || value.review_note.trim() === "") {
    return "plan approval review_note must be a non-empty string";
  }
  return { approved_at: value.approved_at, review_note: value.review_note };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
