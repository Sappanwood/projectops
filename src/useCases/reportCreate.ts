import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import type { CliIO } from "../io.js";
import {
  ReportAlreadyExistsError,
  ReportRootError,
  ReportTargetError,
} from "../report/reportFs.js";
import { ReportGenerationError, writeGeneratedReport } from "./reportGenerate.js";
import { resolvePlansRoot } from "./planContext.js";
import { resolveStoreRoot } from "./backlogContext.js";
import { resolveReportsRoot } from "./reportContext.js";
import { formatReportError, reportFailure, resolveReportInput } from "./reportCli.js";

type ReportCreateOptions = {
  "report-id"?: string;
  title?: string;
  "created-at"?: string;
  verification?: string[];
  deviation?: string[];
  workaround?: string[];
  "repo-doc"?: string[];
  body?: string;
  "body-file"?: string;
  "partial-acceptance"?: string;
};

export function reportCreate(
  projectId: string | undefined,
  planId: string | undefined,
  args: string[],
  json: boolean,
  io: CliIO,
  cwd: string,
): number {
  if (projectId === undefined || planId === undefined) {
    return reportFailure(
      io,
      json,
      "Usage: pops report create <project-id> <plan-id> --verification <evidence> [options]",
    );
  }

  const plansRoot = resolveReportInput(io, json, (captured) =>
    resolvePlansRoot(projectId, captured, cwd, true),
  );
  if (plansRoot === null) return 1;
  const store = resolveReportInput(io, json, (captured) =>
    resolveStoreRoot(projectId, captured, cwd),
  );
  if (store === null) return 1;
  const reportsRoot = resolveReportInput(io, json, (captured) =>
    resolveReportsRoot(projectId, captured, cwd, true),
  );
  if (reportsRoot === null) return 1;

  let values: ReportCreateOptions;
  try {
    values = parseArgs({
      args,
      options: {
        "report-id": { type: "string" },
        title: { type: "string" },
        "created-at": { type: "string" },
        verification: { type: "string", multiple: true },
        deviation: { type: "string", multiple: true },
        workaround: { type: "string", multiple: true },
        "repo-doc": { type: "string", multiple: true },
        body: { type: "string" },
        "body-file": { type: "string" },
        "partial-acceptance": { type: "string" },
      },
      allowPositionals: false,
      strict: true,
    }).values as ReportCreateOptions;
  } catch {
    return reportFailure(io, json, "invalid arguments");
  }

  const verification = values.verification ?? [];
  if (verification.length === 0 || verification.some((entry) => entry.trim() === "")) {
    return reportFailure(io, json, "--verification is required at least once");
  }

  let body = values.body ?? "";
  if (values["body-file"] !== undefined) {
    try {
      body = readFileSync(values["body-file"], "utf8");
    } catch {
      return reportFailure(io, json, `cannot read body file: ${values["body-file"]}`);
    }
  }

  try {
    const report = writeGeneratedReport({
      workspaceRoot: store.workspaceRoot,
      reportsRoot,
      projectId,
      plansRoot,
      planId,
      backlogRoot: store.root,
      ...(values["report-id"] === undefined ? {} : { reportId: values["report-id"] }),
      ...(values.title === undefined ? {} : { title: values.title }),
      ...(values["created-at"] === undefined ? {} : { createdAt: values["created-at"] }),
      verification,
      deviations: values.deviation ?? [],
      workarounds: values.workaround ?? [],
      repoDocs: values["repo-doc"] ?? [],
      body,
      ...(values["partial-acceptance"] === undefined
        ? {}
        : { partialAcceptance: values["partial-acceptance"] }),
    });
    if (json) io.stdout(JSON.stringify({ ok: true, report }));
    else io.stdout(`Created ${report.id}: ${report.title}`);
    return 0;
  } catch (error) {
    if (
      error instanceof ReportGenerationError ||
      error instanceof ReportAlreadyExistsError ||
      error instanceof ReportRootError ||
      error instanceof ReportTargetError
    ) {
      return reportFailure(io, json, error.message);
    }
    return reportFailure(io, json, formatReportError(error));
  }
}
