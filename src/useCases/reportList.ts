import type { CliIO } from "../io.js";
import { listReportIds, readReport } from "../report/reportFs.js";
import { resolveReportsRoot } from "./reportContext.js";
import { formatReportError, reportFailure, resolveReportInput } from "./reportCli.js";
import { loadOrReport } from "./workspaceContext.js";

export function reportList(
  projectId: string | undefined,
  json: boolean,
  io: CliIO,
  cwd: string,
): number {
  if (projectId === undefined) return reportFailure(io, json, "Usage: pops report list <project-id> [--json]");
  const workspace = resolveReportInput(io, json, (captured) => loadOrReport(cwd, captured));
  if (workspace === null) return 1;
  const reportsRoot = resolveReportInput(io, json, (captured) => resolveReportsRoot(projectId, captured, cwd));
  if (reportsRoot === null) return 1;
  let reports;
  try {
    reports = listReportIds(workspace.root, reportsRoot).map((id) => readReport(workspace.root, reportsRoot, id));
  } catch (error) {
    return reportFailure(io, json, formatReportError(error));
  }

  const summaries = reports.map((report) => ({
    id: report.id,
    title: report.title,
    project: report.project,
    created_at: report.created_at,
    outcome: report.outcome,
    plan: report.plan,
  }));
  if (json) {
    io.stdout(JSON.stringify({ ok: true, reports: summaries }));
  } else if (summaries.length === 0) {
    io.stdout("No reports");
  } else {
    for (const report of summaries) io.stdout(`${report.id}  [${report.outcome}]  ${report.title}`);
  }
  return 0;
}
