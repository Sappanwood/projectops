import type { CliIO } from "../io.js";
import { isReportId } from "../report/report.js";
import { readReport } from "../report/reportFs.js";
import { resolveReportsRoot } from "./reportContext.js";
import { formatReportError, reportFailure, resolveReportInput } from "./reportCli.js";
import { loadOrReport } from "./workspaceContext.js";

export function reportShow(
  projectId: string | undefined,
  reportId: string | undefined,
  json: boolean,
  io: CliIO,
  cwd: string,
): number {
  if (projectId === undefined || reportId === undefined) {
    return reportFailure(io, json, "Usage: pops report show <project-id> <report-id> [--json]");
  }
  const workspace = resolveReportInput(io, json, (captured) => loadOrReport(cwd, captured));
  if (workspace === null) return 1;
  const reportsRoot = resolveReportInput(io, json, (captured) => resolveReportsRoot(projectId, captured, cwd));
  if (reportsRoot === null) return 1;
  if (!isReportId(reportId)) return reportFailure(io, json, `invalid report id: ${reportId}`);

  let report;
  try {
    report = readReport(workspace.root, reportsRoot, reportId);
  } catch (error) {
    return reportFailure(io, json, formatReportError(error));
  }
  if (json) {
    io.stdout(JSON.stringify(report));
  } else {
    const details = [`${report.id}  [${report.outcome}]  ${report.title}`, `Project: ${report.project}`, `Plan: ${report.plan}`, ""];
    if (report.body !== "") details.push(report.body);
    io.stdout(details.join("\n"));
  }
  return 0;
}
