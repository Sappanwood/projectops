import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import type { CliIO } from "../io.js";
import {
  RETROSPECTIVE_TRIGGERS,
  type Retrospective,
  type RetrospectiveTrigger,
} from "../retrospective/retrospective.js";
import {
  captureRetrospective,
  listRetrospectiveIds,
  RetrospectiveAlreadyExistsError,
  RetrospectiveParseError,
  RetrospectiveRootError,
  RetrospectiveTargetError,
} from "../retrospective/retrospectiveFs.js";
import { resolveRetrospectivesRoot } from "./retrospectiveContext.js";
import { formatRetrospectiveError, retrospectiveFailure } from "./retrospectiveCli.js";
import { loadOrReport } from "./workspaceContext.js";

type CaptureOptions = {
  id?: string;
  "retrospective-id"?: string;
  "created-at"?: string;
  project?: string;
  task?: string;
  trigger?: string;
  harness?: string;
  model?: string;
  body?: string;
  "body-file"?: string;
  stdin?: boolean;
};

export function retrospectiveCapture(
  args: string[],
  json: boolean,
  io: CliIO,
  cwd: string,
): number {
  const workspace = loadOrReport(cwd, io);
  if (workspace === null) return 1;
  const root = resolveRetrospectivesRoot(io, cwd, true);
  if (root === null) return 1;

  let values: CaptureOptions;
  try {
    values = parseArgs({
      args,
      options: {
        id: { type: "string" },
        "retrospective-id": { type: "string" },
        "created-at": { type: "string" },
        project: { type: "string" },
        task: { type: "string" },
        trigger: { type: "string" },
        harness: { type: "string" },
        model: { type: "string" },
        body: { type: "string" },
        "body-file": { type: "string" },
        stdin: { type: "boolean" },
      },
      allowPositionals: false,
      strict: true,
    }).values as CaptureOptions;
  } catch {
    return retrospectiveFailure(io, json, "invalid arguments");
  }

  if (values.id !== undefined && values["retrospective-id"] !== undefined) {
    return retrospectiveFailure(io, json, "--id and --retrospective-id cannot both be provided");
  }
  const trigger = values.trigger;
  if (trigger === undefined || !RETROSPECTIVE_TRIGGERS.includes(trigger as RetrospectiveTrigger)) {
    return retrospectiveFailure(io, json, `--trigger must be one of: ${RETROSPECTIVE_TRIGGERS.join(", ")}`);
  }
  if (values.harness === undefined || values.harness.trim() === "") {
    return retrospectiveFailure(io, json, "--harness is required");
  }

  let body = values.body ?? "";
  if (values["body-file"] !== undefined) {
    try {
      body = readFileSync(values["body-file"], "utf8");
    } catch {
      return retrospectiveFailure(io, json, `cannot read body file: ${values["body-file"]}`);
    }
  } else if (values.stdin === true) {
    body = io.stdin?.() ?? "";
  }
  if (body.trim() === "") return retrospectiveFailure(io, json, "--body, --body-file, or --stdin must provide Markdown body");
  const bodyProblem = validateCaptureBody(body);
  if (bodyProblem !== null) return retrospectiveFailure(io, json, bodyProblem);

  const createdAt = values["created-at"] ?? new Date().toISOString();
  if (createdAt.trim() === "") return retrospectiveFailure(io, json, "--created-at must be a non-empty string");
  const explicitId = values.id ?? values["retrospective-id"];
  const generated = explicitId === undefined;
  let id = explicitId ?? generatedId(createdAt, values, body);
  if (generated) {
    const existing = new Set(listRetrospectiveIds(workspace.root, root, "inbox"));
    let suffix = 2;
    const base = id;
    while (existing.has(id)) id = `${base}-${suffix++}`;
  }
  if (!/^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?$/.test(id)) {
    return retrospectiveFailure(io, json, "--id must use lowercase slug format");
  }
  const project = nullableOption(values.project, "--project");
  if (project.error !== undefined) return retrospectiveFailure(io, json, project.error);
  const task = nullableOption(values.task, "--task");
  if (task.error !== undefined) return retrospectiveFailure(io, json, task.error);
  const model = nullableOption(values.model, "--model");
  if (model.error !== undefined) return retrospectiveFailure(io, json, model.error);

  const retrospective: Retrospective = {
    schema: "retrospective/Retrospective@1",
    id,
    created_at: createdAt,
    project: project.value,
    task: task.value,
    trigger: trigger as RetrospectiveTrigger,
    status: "inbox",
    harness: values.harness,
    model: model.value,
    body,
  };
  try {
    const record = captureRetrospective(workspace.root, root, retrospective);
    if (json) io.stdout(JSON.stringify({ ok: true, retrospective: record }));
    else io.stdout(`Captured ${record.id}`);
    return 0;
  } catch (error) {
    if (error instanceof RetrospectiveAlreadyExistsError || error instanceof RetrospectiveParseError ||
      error instanceof RetrospectiveRootError || error instanceof RetrospectiveTargetError) {
      return retrospectiveFailure(io, json, error.message);
    }
    return retrospectiveFailure(io, json, formatRetrospectiveError(error));
  }
}

function nullableOption(value: string | undefined, flag: string): { value: string | null; error?: string } {
  if (value === undefined || value === "null") return { value: null };
  if (value.trim() === "") return { value: null, error: `${flag} must be null or a non-empty string` };
  return { value };
}

function generatedId(createdAt: string, values: CaptureOptions, body: string): string {
  const digest = createHash("sha256")
    .update(JSON.stringify({ createdAt, project: values.project ?? null, task: values.task ?? null, trigger: values.trigger, harness: values.harness, model: values.model ?? null, body }))
    .digest("hex")
    .slice(0, 12);
  const timestamp = createdAt.replace(/\D/g, "").slice(0, 14) || "record";
  return `retro-${timestamp}-${digest}`;
}

const REQUIRED_BODY_SECTIONS = [
  "Hidden friction encountered",
  "Workarounds used",
  "Improvement candidates",
] as const;

function validateCaptureBody(body: string): string | null {
  const lines = body.split(/\r?\n/);
  const headings = lines.flatMap((line, index) => {
    const match = /^(#{1,6})[ \t]+(.+?)[ \t]*$/.exec(line);
    if (match === null) return [];
    const title = (match[2] ?? "").replace(/[ \t]+#+[ \t]*$/, "").trim();
    return [{ index, title }];
  });

  for (const section of REQUIRED_BODY_SECTIONS) {
    const heading = headings.find((candidate) => candidate.title === section);
    if (heading === undefined) return `--body must include a Markdown section: ${section}`;
    const end = headings.find((candidate) => candidate.index > heading.index)?.index ?? lines.length;
    const content = lines.slice(heading.index + 1, end).join("\n").trim();
    if (content === "") return `--body section must be non-empty: ${section}`;
  }
  return null;
}
