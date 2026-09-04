// Retrospective domain: versioned workflow evidence and Markdown serialization.

export const RETROSPECTIVE_SCHEMA = "retrospective/Retrospective@1";
export const RETROSPECTIVE_STORE_SCHEMA = "retrospective/Store@1";
export const RETROSPECTIVE_INDEX_SCHEMA = "retrospective/Index@1";

export const RETROSPECTIVE_STATUSES = ["inbox", "active", "archive"] as const;
export const RETROSPECTIVE_TRIGGERS = ["workflow-friction", "repeated-retry", "major-rework"] as const;

export type RetrospectiveStatus = (typeof RETROSPECTIVE_STATUSES)[number];
export type RetrospectiveTrigger = (typeof RETROSPECTIVE_TRIGGERS)[number];

export type Retrospective = {
  schema: typeof RETROSPECTIVE_SCHEMA;
  id: string;
  created_at: string;
  project: string | null;
  task: string | null;
  trigger: RetrospectiveTrigger;
  status: RetrospectiveStatus;
  harness: string;
  model: string | null;
  body: string;
  disposition?: string;
  owner_scope?: string;
  categories?: string[];
  next_action?: string;
  related_info?: string[];
  canonical?: string;
  action_disposition?: string;
  actioned_at?: string;
  backlog?: string[];
  resolution_note?: string;
};

export type RetrospectiveStoreManifest = {
  schema: typeof RETROSPECTIVE_STORE_SCHEMA;
  record_schema: typeof RETROSPECTIVE_SCHEMA;
  index_schema: typeof RETROSPECTIVE_INDEX_SCHEMA;
};

export type RetrospectiveIndexRecord = Pick<
  Retrospective,
  "id" | "created_at" | "project" | "task" | "trigger" | "status" | "harness" | "model" |
  "disposition" | "owner_scope" | "categories" | "next_action" | "related_info" | "canonical" |
  "action_disposition" | "actioned_at" | "backlog" | "resolution_note"
> & { path: string };

export type RetrospectiveIndex = {
  schema: typeof RETROSPECTIVE_INDEX_SCHEMA;
  records: RetrospectiveIndexRecord[];
};

export type RetrospectiveRecord = Retrospective & {
  path: string;
  revision: string;
};

export type RetrospectiveDiagnostic = {
  id: string;
  path: string;
  message: string;
};

export class RetrospectiveValidationError extends Error {
  constructor(public readonly problem: string) {
    super(`Invalid retrospective: ${problem}`);
  }
}

export function parseRetrospective(value: unknown): Retrospective | string {
  if (typeof value === "string") {
    const parsed = parseMarkdown(value);
    if (typeof parsed === "string") return parsed;
    value = parsed;
  }
  const problem = validateRetrospective(value);
  if (problem !== null) return problem;
  const input = value as Record<string, unknown>;
  const retrospective: Retrospective = {
    schema: RETROSPECTIVE_SCHEMA,
    id: input.id as string,
    created_at: input.created_at as string,
    project: input.project as string | null,
    task: input.task as string | null,
    trigger: input.trigger as RetrospectiveTrigger,
    status: input.status as RetrospectiveStatus,
    harness: input.harness as string,
    model: input.model as string | null,
    body: input.body as string,
  };
  for (const field of ["disposition", "owner_scope", "next_action", "canonical", "action_disposition", "actioned_at", "resolution_note"] as const) {
    if (Object.prototype.hasOwnProperty.call(input, field)) retrospective[field] = input[field] as string;
  }
  for (const field of ["categories", "related_info", "backlog"] as const) {
    if (Object.prototype.hasOwnProperty.call(input, field)) retrospective[field] = input[field] as string[];
  }
  return retrospective;
}

export function serializeRetrospective(retrospective: Retrospective): string {
  const parsed = parseRetrospective(retrospective);
  if (typeof parsed === "string") throw new RetrospectiveValidationError(parsed);
  const lines = [
    "---",
    `schema: ${parsed.schema}`,
    `id: ${serializeScalar(parsed.id)}`,
    `created_at: ${serializeScalar(parsed.created_at)}`,
    `project: ${parsed.project === null ? "null" : serializeScalar(parsed.project)}`,
    `task: ${parsed.task === null ? "null" : serializeScalar(parsed.task)}`,
    `trigger: ${parsed.trigger}`,
    `status: ${parsed.status}`,
    `harness: ${serializeScalar(parsed.harness)}`,
    `model: ${parsed.model === null ? "null" : serializeScalar(parsed.model)}`,
    ...(parsed.disposition === undefined ? [] : [`disposition: ${serializeScalar(parsed.disposition)}`]),
    ...(parsed.owner_scope === undefined ? [] : [`owner_scope: ${serializeScalar(parsed.owner_scope)}`]),
    ...(parsed.categories === undefined ? [] : [`categories: ${JSON.stringify(parsed.categories)}`]),
    ...(parsed.next_action === undefined ? [] : [`next_action: ${serializeScalar(parsed.next_action)}`]),
    ...(parsed.related_info === undefined ? [] : [`related_info: ${JSON.stringify(parsed.related_info)}`]),
    ...(parsed.canonical === undefined ? [] : [`canonical: ${serializeScalar(parsed.canonical)}`]),
    ...(parsed.action_disposition === undefined ? [] : [`action_disposition: ${serializeScalar(parsed.action_disposition)}`]),
    ...(parsed.actioned_at === undefined ? [] : [`actioned_at: ${serializeScalar(parsed.actioned_at)}`]),
    ...(parsed.backlog === undefined ? [] : [`backlog: ${JSON.stringify(parsed.backlog)}`]),
    ...(parsed.resolution_note === undefined ? [] : [`resolution_note: ${serializeScalar(parsed.resolution_note)}`]),
    "---",
    "",
    parsed.body,
  ];
  return `${lines.join("\n").trimEnd()}\n`;
}

export function isRetrospectiveId(value: string): boolean {
  return /^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?$/.test(value);
}

function validateRetrospective(value: unknown): string | null {
  if (!isRecord(value)) return "retrospective input must be an object";
  if (value.schema !== RETROSPECTIVE_SCHEMA) return "unexpected retrospective schema";
  if (typeof value.id !== "string" || !isRetrospectiveId(value.id)) {
    return "retrospective id must use lowercase slug format";
  }
  for (const field of ["created_at", "harness"] as const) {
    if (typeof value[field] !== "string" || value[field].trim() === "") {
      return `retrospective ${field} must be a non-empty string`;
    }
  }
  for (const field of ["project", "task"] as const) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      return `retrospective ${field} is required`;
    }
    if (value[field] !== null && (typeof value[field] !== "string" || value[field].trim() === "")) {
      return `retrospective ${field} must be null or a non-empty string`;
    }
  }
  if (!RETROSPECTIVE_TRIGGERS.includes(value.trigger as RetrospectiveTrigger)) {
    return `retrospective trigger must be one of: ${RETROSPECTIVE_TRIGGERS.join(", ")}`;
  }
  if (!RETROSPECTIVE_STATUSES.includes(value.status as RetrospectiveStatus)) {
    return `retrospective status must be one of: ${RETROSPECTIVE_STATUSES.join(", ")}`;
  }
  if (value.model !== null && (typeof value.model !== "string" || value.model.trim() === "")) {
    return "retrospective model must be null or a non-empty string";
  }
  for (const field of ["disposition", "owner_scope", "next_action", "canonical", "action_disposition", "actioned_at", "resolution_note"] as const) {
    if (Object.prototype.hasOwnProperty.call(value, field) && (typeof value[field] !== "string" || value[field].trim() === "")) {
      return `retrospective ${field} must be a non-empty string`;
    }
  }
  for (const field of ["categories", "related_info", "backlog"] as const) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) continue;
    if (!Array.isArray(value[field]) || value[field].some((entry) => typeof entry !== "string" || entry.trim() === "")) {
      return `retrospective ${field} must be an array of non-empty strings`;
    }
  }
  if (typeof value.body !== "string") return "retrospective body must be a string";
  return null;
}

function parseMarkdown(content: string): Record<string, unknown> | string {
  const lines = content.split("\n");
  if (lines[0] !== "---") return "missing frontmatter";
  const end = lines.indexOf("---", 1);
  if (end === -1) return "unterminated frontmatter";
  const raw: Record<string, unknown> = {};
  for (const line of lines.slice(1, end)) {
    const index = line.indexOf(": ");
    if (index === -1) return "invalid frontmatter line";
    const key = line.slice(0, index);
    if (key in raw) return `duplicate frontmatter field: ${key}`;
    const value = line.slice(index + 2);
    try {
      raw[key] = parseFrontmatterValue(value);
    } catch {
      return `invalid frontmatter value: ${key}`;
    }
  }
  raw.body = lines.slice(end + 1).join("\n").replace(/^\n/, "").replace(/\n$/, "");
  return raw;
}

function parseFrontmatterValue(value: string): unknown {
  if (value === "null") return null;
  if (value.startsWith("[") || value.startsWith("{") || value.startsWith('"')) return JSON.parse(value);
  return value;
}

function serializeScalar(value: string): string {
  if (/^[\s#"'\-?:,{}[\]]/.test(value) || /[\s#":]$/.test(value) || value.includes("\n")) {
    return JSON.stringify(value);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
