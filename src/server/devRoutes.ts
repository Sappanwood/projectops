import { inspectDevConfiguration } from "../application/devApi.js";
import { controlDevProject, type DevStatus } from "../application/devControl.js";
import type { ApplicationResult } from "../application/result.js";
import { loadWorkspace } from "../catalog/workspaceStore.js";

export type WebDevSnapshot = {
  configured: boolean;
  hosts_workbench: boolean;
  status: DevStatus;
  problems: string[];
};
export async function handleDevRoute(
  segments: string[],
  method: string | undefined,
  workspace: string,
  origin: string,
  io: {
    method(expected: string): void;
    noQuery(): void;
    body(keys: string[]): Promise<Record<string, unknown>>;
    invalid(message: string): never;
    send(result: ApplicationResult<WebDevSnapshot>): void;
  },
): Promise<boolean> {
  if (
    segments.length !== 4 ||
    segments[0] !== "api" ||
    segments[1] !== "projects" ||
    segments[3] !== "dev"
  )
    return false;
  io.noQuery();
  const project = segments[2]!;
  const { manifest } = loadWorkspace(workspace);
  const registration = manifest.projects[project];
  if (!registration) io.invalid("Unknown project ID.");
  const inspection = inspectDevConfiguration(workspace);
  const configured = registration.dev !== undefined;
  const hostsWorkbench = Object.values(registration.dev?.endpoints ?? {}).some(
    (endpoint) => endpoint.port === Number(new URL(origin).port),
  );
  let action: "status" | "start" | "stop" | "restart" = "status";
  if (method !== "GET") {
    io.method("POST");
    const body = await io.body(["action"]);
    if (body.action !== "start" && body.action !== "stop" && body.action !== "restart")
      io.invalid("Expected start, stop or restart action.");
    action = body.action;
    if (hostsWorkbench && (action === "stop" || action === "restart"))
      io.invalid(`This project hosts Workbench. Use pops dev ${action} ${project} in the CLI.`);
    if (!configured) io.invalid("Project has no dev configuration.");
  }
  try {
    const status = await controlDevProject(workspace, action, project);
    if (!status.endpoints.length)
      status.endpoints = inspection.ports.filter((p) => p.project === project);
    io.send({
      ok: true,
      data: {
        configured,
        hosts_workbench: hostsWorkbench,
        status,
        problems: inspection.problems.map((p) => `${p.project}: ${p.issue}`),
      },
    });
  } catch (error) {
    io.invalid(error instanceof Error ? error.message : "Dev manager connection failed.");
  }
  return true;
}
