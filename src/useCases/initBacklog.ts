import { initializeBacklog } from "../application/backlogInit.js";
import type { CliIO } from "../io.js";
import { loadOrReport } from "./workspaceContext.js";

const USAGE = "Usage: pops backlog init <project-id> [--id-prefix <PREFIX>] [--json]";

export function initBacklog(args: readonly string[], io: CliIO, cwd: string): number {
  try {
    let projectId: string | undefined;
    let prefix: string | undefined;
    let json = false;
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index]!;
      if (arg === "--json") {
        json = true;
      } else if (arg === "--id-prefix") {
        if (prefix !== undefined) throw new Error("Duplicate --id-prefix option");
        const value = args[++index];
        if (value === undefined || value.startsWith("--")) {
          throw new Error(`--id-prefix requires a value. ${USAGE}`);
        }
        prefix = value;
      } else if (arg.startsWith("-")) {
        throw new Error(`Unknown option: ${arg}. ${USAGE}`);
      } else if (projectId === undefined) {
        projectId = arg;
      } else {
        throw new Error(`Unexpected argument: ${arg}. ${USAGE}`);
      }
    }
    if (projectId === undefined) throw new Error(USAGE);
    const workspace = loadOrReport(cwd, io);
    if (workspace === null) return 1;
    const store = initializeBacklog(workspace.root, projectId, prefix);
    if (json) {
      io.stdout(JSON.stringify({ ok: true, store }));
    } else {
      io.stdout(
        `Initialized backlog store for "${projectId}" at ${store.root} (id-prefix: ${store.id_prefix})`,
      );
    }
    return 0;
  } catch (error) {
    io.stderr(`Error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
