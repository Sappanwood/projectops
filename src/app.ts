import { initWorkspace } from "./useCases/initWorkspace.js";
import { registerProject } from "./useCases/registerProject.js";
import { listProjects } from "./useCases/listProjects.js";
import { doctorWorkspace } from "./useCases/doctorWorkspace.js";
import { initBacklog } from "./useCases/initBacklog.js";
import { backlogAdd } from "./useCases/backlogAdd.js";
import { backlogList } from "./useCases/backlogList.js";
import { backlogShow } from "./useCases/backlogShow.js";
import { backlogUpdate } from "./useCases/backlogUpdate.js";
import { planCreate } from "./useCases/planCreate.js";
import { planList } from "./useCases/planList.js";
import { planShow } from "./useCases/planShow.js";
import type { CliIO } from "./io.js";

export const VERSION = "0.0.0";
export type { CliIO } from "./io.js";

const HELP = `ProjectOps

Usage: pops [options] [command]

Options:
  -h, --help     Show help
  -v, --version  Show version

Commands:
  init [dir]              Initialize a workspace shell in dir (default: current directory)
  project add <path>      Register a directory as a project in the workspace
  project list [--json]   List registered projects
  project doctor [--json] Validate workspace topology
  backlog init <project>  Bootstrap a backlog store for a registered project
  backlog add <project>   Add a backlog item (requires -T, -c, --priority)
  backlog list <project>  List backlog items (optional --status filter)
  backlog show <project> <item>  Show a full backlog item
  backlog update <project> <item>  Update item status (--status, --expected-revision)
  plan create <project> --input <draft.json>  Create a Plan from a JSON draft
  plan list <project>     List Plans for a project
  plan show <project> <plan>  Show a complete Plan

Project workflows will be added as vertical slices during the alpha phase.`;

export function runCli(args: readonly string[], io: CliIO, cwd = process.cwd()): number {
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    io.stdout(HELP);
    return 0;
  }

  if (args.includes("--version") || args.includes("-v")) {
    io.stdout(VERSION);
    return 0;
  }

  const [command, ...rest] = args;
  switch (command) {
    case "init":
      return initWorkspace(rest[0], io, cwd);
    case "project": {
      const [sub, ...projectArgs] = rest;
      const json = projectArgs.includes("--json");
      if (sub === "add") {
        const pathArg = projectArgs.find((arg) => !arg.startsWith("--"));
        if (pathArg === undefined) {
          io.stderr("Usage: pops project add <path> [--json]");
          return 1;
        }
        return registerProject(pathArg, json, io, cwd);
      }
      if (sub === "list") {
        return listProjects(json, io, cwd);
      }
      if (sub === "doctor") {
        return doctorWorkspace(json, io, cwd);
      }
      io.stderr(`Unknown project command: ${sub ?? ""}`);
      return 1;
    }
    case "backlog": {
      const [sub, first, ...subArgs] = rest;
      const json = [first, ...subArgs].includes("--json");
      const forwarded = subArgs.filter((arg) => arg !== "--json");
      if (sub === "init") {
        return initBacklog(first, json, io, cwd);
      }
      if (sub === "add") {
        return backlogAdd(first, forwarded, json, io, cwd);
      }
      if (sub === "list") {
        return backlogList(first, forwarded, json, io, cwd);
      }
      if (sub === "show") {
        return backlogShow(first, forwarded.find((arg) => !arg.startsWith("--")), json, io, cwd);
      }
      if (sub === "update") {
        return backlogUpdate(first, forwarded.find((arg) => !arg.startsWith("--")), forwarded, json, io, cwd);
      }
      io.stderr(`Unknown backlog command: ${sub ?? ""}`);
      return 1;
    }
    case "plan": {
      const [sub, first, ...subArgs] = rest;
      const json = [first, ...subArgs].includes("--json");
      const forwarded = subArgs.filter((arg) => arg !== "--json");
      if (sub === "create") {
        return planCreate(first, forwarded, json, io, cwd);
      }
      if (sub === "list") {
        return planList(first, json, io, cwd);
      }
      if (sub === "show") {
        return planShow(first, forwarded.find((arg) => !arg.startsWith("--")), json, io, cwd);
      }
      io.stderr(`Unknown plan command: ${sub ?? ""}`);
      return 1;
    }
    default:
      io.stderr(`Unknown command: ${command}`);
      return 1;
  }
}
