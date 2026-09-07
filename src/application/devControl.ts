import { devRequest } from "../dev/client.js";
import type { DevAction } from "../dev/protocol.js";
import { checkDevProject } from "./devApi.js";

export { type DevAction, type DevReceipt, type DevStatus } from "../dev/protocol.js";
export function controlDevProject(workspace: string, action: DevAction, project = "") {
  return devRequest(workspace, action, project);
}
export async function checkManagedDevProject(workspace: string, project: string) {
  const status = await devRequest(workspace, "status", project);
  const result = await checkDevProject(
    workspace,
    project,
    status.state === "running" ? status.endpoints : [],
  );
  if (status.state === "unknown") {
    result.ok = false;
    result.problems.push({ project, issue: status.issue ?? "Dev ownership unknown" });
  }
  return result;
}
