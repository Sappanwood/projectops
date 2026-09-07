import { inspectDevConfiguration } from "../application/devApi.js";
import { checkManagedDevProject, controlDevProject } from "../application/devControl.js";
import type { DevAction } from "../dev/protocol.js";
import type { CliIO } from "../io.js";
export async function devCommand(args: readonly string[], io: CliIO, cwd: string): Promise<number> {
  const positional = args.filter((arg) => arg !== "--json");
  const [action, project] = positional;
  if (
    (action === "manager" && project === "stop" && positional.length === 2) ||
    (["start", "status", "stop", "restart"].includes(action ?? "") &&
      positional.length === 2 &&
      !project!.startsWith("-"))
  ) {
    try {
      const result = await controlDevProject(
        cwd,
        action === "manager" ? "manager-stop" : (action as DevAction),
        action === "manager" ? "" : project!,
      );
      io.stdout(
        args.includes("--json")
          ? JSON.stringify(result)
          : `${result.project || "manager"}: ${result.state}${result.issue ? ` — ${result.issue}` : ""}${result.affected ? ` (${result.affected.join(", ")})` : ""}`,
      );
      return result.ok ? 0 : 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (args.includes("--json"))
        io.stdout(JSON.stringify({ ok: false, error: { code: "DEV_RUNTIME_ERROR", message } }));
      else io.stderr(message);
      return 1;
    }
  }
  if (
    (action !== "ports" && action !== "check") ||
    (action === "ports"
      ? positional.length !== 1
      : positional.length !== 2 || project!.startsWith("-"))
  ) {
    io.stderr(
      "Usage: pops dev ports | check/start/status/stop/restart <project> | manager stop [--json]",
    );
    return 1;
  }
  try {
    const result =
      action === "ports"
        ? inspectDevConfiguration(cwd)
        : await checkManagedDevProject(cwd, project!);
    if (args.includes("--json")) io.stdout(JSON.stringify(result));
    else {
      for (const port of result.ports)
        io.stdout(
          `${port.project}/${port.endpoint} ${port.origin}${"status" in port ? ` ${port.status}` : ""}`,
        );
      for (const problem of result.problems) io.stdout(`${problem.project}: ${problem.issue}`);
      if (!result.ports.length && !result.problems.length)
        io.stdout("No development endpoints configured.");
    }
    return result.ok ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (args.includes("--json"))
      io.stdout(JSON.stringify({ ok: false, error: { code: "DEV_CONFIG_INVALID", message } }));
    else io.stderr(message);
    return 1;
  }
}
