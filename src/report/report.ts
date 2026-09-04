// Report domain: versioned delivery evidence and Markdown serialization.

import path from "node:path";

export const REPORT_SCHEMA = "report/Report@1";
export const REPORT_OUTCOMES = ["completed", "partial"] as const;

export type ReportOutcome = (typeof REPORT_OUTCOMES)[number];

export type ReportBacklogResult = {
  id: string;
  status: string;
  revision?: string;
  uri?: string;
};

export type Report = {
  schema: typeof REPORT_SCHEMA;
  id: string;
  title: string;
  project: string;
  created_at: string;
  outcome: ReportOutcome;
  plan: string;
  backlog: ReportBacklogResult[];
  verification: string[];
  deviations: string[];
  workarounds: string[];
  repo_docs: string[];
  body: string;
};

export class ReportValidationError extends Error {
  constructor(public readonly problem: string) {
    super(`Invalid report: ${problem}`);
  }
}

/**
 * Parse a Report object or a Report Markdown file.
 *
 * Returning a diagnostic string follows the existing Plan domain convention;
 * filesystem adapters add the report id and storage context to that error.
 */
export function parseReport(value: unknown): Report | string {
  if (typeof value === "string") {
    const parsed = parseMarkdown(value);
    if (typeof parsed === "string") return parsed;
    value = parsed;
  }

  const problem = validateReport(value);
  if (problem !== null) return problem;
  const input = value as Record<string, unknown>;
  const backlog = (input.backlog as ReportBacklogResult[]).map((item) => ({
    id: item.id,
    status: item.status,
    ...(item.revision === undefined ? {} : { revision: item.revision }),
    ...(item.uri === undefined ? {} : { uri: item.uri }),
  }));
  return {
    schema: REPORT_SCHEMA,
    id: input.id as string,
    title: input.title as string,
    project: input.project as string,
    created_at: input.created_at as string,
    outcome: input.outcome as ReportOutcome,
    plan: input.plan as string,
    backlog,
    verification: [...(input.verification as string[])],
    deviations: [...(input.deviations as string[])],
    workarounds: [...(input.workarounds as string[])],
    repo_docs: [...(input.repo_docs as string[])],
    body: typeof input.body === "string" ? input.body : "",
  };
}

export function serializeReport(report: Report): string {
  const parsed = parseReport(report);
  if (typeof parsed === "string") throw new ReportValidationError(parsed);

  const lines = [
    "---",
    `schema: ${parsed.schema}`,
    `id: ${serializeScalar(parsed.id)}`,
    `title: ${serializeScalar(parsed.title)}`,
    `project: ${serializeScalar(parsed.project)}`,
    `created_at: ${serializeScalar(parsed.created_at)}`,
    `outcome: ${parsed.outcome}`,
    `plan: ${serializeScalar(parsed.plan)}`,
    `backlog: ${JSON.stringify(parsed.backlog)}`,
    `verification: ${JSON.stringify(parsed.verification)}`,
    `deviations: ${JSON.stringify(parsed.deviations)}`,
    `workarounds: ${JSON.stringify(parsed.workarounds)}`,
    `repo_docs: ${JSON.stringify(parsed.repo_docs)}`,
    "---",
    "",
    parsed.body,
  ];
  return `${lines.join("\n").trimEnd()}\n`;
}

export function isReportId(value: string): boolean {
  return /^report-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function validateReport(value: unknown): string | null {
  if (!isRecord(value)) return "report input must be an object";
  if (value.schema !== REPORT_SCHEMA) return "unexpected report schema";
  if (typeof value.id !== "string" || !isReportId(value.id)) {
    return "report id must use the report-<slug> format";
  }
  for (const field of ["title", "project", "created_at"] as const) {
    if (typeof value[field] !== "string" || value[field].trim() === "") {
      return `report ${field} must be a non-empty string`;
    }
  }
  if (!REPORT_OUTCOMES.includes(value.outcome as ReportOutcome)) {
    return `report outcome must be one of: ${REPORT_OUTCOMES.join(", ")}`;
  }
  if (typeof value.plan !== "string" || !isLogicalReference(value.plan)) {
    return "report plan must be a non-empty logical reference";
  }
  const absolutePathField = findMachineAbsolutePath(value, "report");
  if (absolutePathField !== null) {
    return `report contains a machine absolute path in ${absolutePathField}`;
  }
  if (!Array.isArray(value.backlog)) return "report backlog must be an array";
  for (const item of value.backlog) {
    const problem = validateBacklogResult(item);
    if (problem !== null) return problem;
  }
  for (const field of ["verification", "deviations", "workarounds"] as const) {
    if (!Array.isArray(value[field]) || !value[field].every((entry) => typeof entry === "string")) {
      return `report ${field} must be an array of strings`;
    }
  }
  if (!Array.isArray(value.repo_docs) || !value.repo_docs.every((entry) => typeof entry === "string" && isRepoRelativeReference(entry))) {
    return "report repo_docs must be an array of repo-relative logical references";
  }
  if (value.body !== undefined && typeof value.body !== "string") {
    return "report body must be a string";
  }
  return null;
}

function validateBacklogResult(value: unknown): string | null {
  if (!isRecord(value)) return "report backlog result must be an object";
  if (typeof value.id !== "string" || !/^[A-Z0-9]+-\d{3,}$/.test(value.id)) {
    return "report backlog result id is invalid";
  }
  if (typeof value.status !== "string" || value.status.trim() === "") {
    return `report backlog result ${value.id ?? "?"} status must be a non-empty string`;
  }
  if (value.revision !== undefined && (typeof value.revision !== "string" || value.revision.trim() === "")) {
    return `report backlog result ${value.id} revision must be a non-empty string`;
  }
  if (value.uri !== undefined && (typeof value.uri !== "string" || !isLogicalReference(value.uri))) {
    return `report backlog result ${value.id} uri must be a logical reference`;
  }
  return null;
}

function isLogicalReference(value: string): boolean {
  return value.trim() !== "" && !path.isAbsolute(value) && !value.includes("\\") &&
    !value.split("/").includes("..") && !value.startsWith("~");
}

function isRepoRelativeReference(value: string): boolean {
  return isLogicalReference(value) && !value.includes(":");
}

function findMachineAbsolutePath(value: unknown, location: string): string | null {
  if (typeof value === "string") return containsMachineAbsolutePath(value) ? location : null;
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      const found = findMachineAbsolutePath(entry, `${location}[${index}]`);
      if (found !== null) return found;
    }
    return null;
  }
  if (isRecord(value)) {
    for (const [key, entry] of Object.entries(value)) {
      const found = findMachineAbsolutePath(entry, `${location}.${key}`);
      if (found !== null) return found;
    }
  }
  return null;
}

function containsMachineAbsolutePath(value: string): boolean {
  if (value !== "/" && value !== "\\" && (path.posix.isAbsolute(value) || path.win32.isAbsolute(value))) {
    return true;
  }
  // Embedded paths are detected only at a text boundary. URL schemes, Markdown
  // root-relative links, closing HTML tags, and an isolated slash are text.
  const posixPathToken = /(?:^|[^A-Za-z0-9<(:/])\/(?:[^\s"'`),;]+(?:\/[^\s"'`),;]+)*)/.test(value);
  const windowsPathToken = /(?:^|[^A-Za-z0-9])(?:[A-Za-z]:[\\/]|\\\\)/.test(value);
  return posixPathToken || windowsPathToken;
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
  if (value.startsWith("[") || value.startsWith("{") || value.startsWith('"')) {
    return JSON.parse(value);
  }
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
