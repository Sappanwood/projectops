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
import { planNext } from "./useCases/planNext.js";
import { planShow } from "./useCases/planShow.js";
import { planValidate } from "./useCases/planValidate.js";
import { planApprove } from "./useCases/planApprove.js";
import { planMaterialize } from "./useCases/planMaterialize.js";
import { planComplete } from "./useCases/planComplete.js";
import { planRevise } from "./useCases/planRevise.js";
import { executionCommand } from "./useCases/executionCommand.js";
import { planRunCommand } from "./useCases/planRunCommand.js";
import { parallelRunCommand } from "./useCases/parallelRunCommand.js";
import { docsScaffold } from "./useCases/docsScaffold.js";
import { docsCheck } from "./useCases/docsCheck.js";
import { reportCreate } from "./useCases/reportCreate.js";
import { reportList } from "./useCases/reportList.js";
import { reportShow } from "./useCases/reportShow.js";
import { retrospectiveCapture } from "./useCases/retrospectiveCapture.js";
import { retrospectiveList } from "./useCases/retrospectiveList.js";
import { retrospectiveShow } from "./useCases/retrospectiveShow.js";
import { retrospectiveTriage } from "./useCases/retrospectiveTriage.js";
import { retrospectiveArchive } from "./useCases/retrospectiveArchive.js";
import type { CliIO } from "./io.js";

export const VERSION = "0.0.0";
export type { CliIO } from "./io.js";

const HELP = `ProjectOps

Usage: pops [options] [command]

Options:
  -h, --help     Show help
  -v, --version  Show version

Commands:
  init [dir] [--json]     Initialize a workspace shell in dir (default: current directory)
  project add <path>      Register a directory as a project in the workspace
  project list [--json]   List registered projects
  project doctor [--json] Validate workspace topology
  backlog init <project>  Bootstrap a backlog store for a registered project
  backlog add <project>   Add a backlog item (requires -T, -c, --priority)
  backlog list <project>  List backlog items (optional --status filter)
  backlog show <project> <item>  Show a full backlog item
  backlog update <project> <item>  Update status or content (--title, --body-file, --expected-revision)
  plan create <project> --input <draft.json>  Create a Plan from a JSON draft
  plan list <project>     List Plans for a project
  plan show <project> <plan>  Show a complete Plan
  plan next <project> <plan> [--json]  Recommend ready tasks and explain blocked dependencies
  plan validate <project> <plan>  Validate a Plan
  plan approve <project> <plan> --review-note <note>  Approve a validated Plan
  plan materialize <project> <plan>  Materialize an approved Plan into Backlog
  plan complete <project> <plan> --expected-revision <revision>  Mark a delivered Plan done
  plan revise <project> <plan> --input <draft.json> --expected-revision <revision> [--confirm <token>]  Preview or confirm a revision
  plan-run create <project> <plan> --expected-revision <plan-revision>  Freeze a Plan run
  plan-run list <project> [--plan <plan>]  List Plan execution runs
  plan-run show <project> <run>  Show nodes, attempts and dependency evidence
  plan-run pause|resume|close-stopped <project> <run> --expected-revision <revision> [--note <text>] [--baseline-digest <digest>]
  parallel-run create <project> <plan> --expected-revision <revision> [--commands-file <json>] [--base-commit <commit>]
  parallel-run list|show <project> [run] [--json]
  parallel-run pause|resume|close-stopped|rework <project> <run> --expected-revision <revision> [--note <text>] [--node <key>]
  docs scaffold <project>       Create the fixed Project Docs files
  docs check <project>          Check the fixed Project Docs files
  report create <project> <plan> --verification <evidence>  Create a Delivery Report
  report list <project>          List Delivery Reports
  report show <project> <report> Show a complete Delivery Report
  retrospective capture       Capture a workflow retrospective in inbox
  retrospective list          List workflow retrospectives
  retrospective show <id>     Show a complete workflow retrospective
  retrospective triage <id>   Classify an inbox retrospective into active or archive
  retrospective archive <id>  Close an active retrospective into archive
  execution create <project> <item> [--instructions <text>] [--retry-of <attempt>] [--expected-revision <task-revision>]
  execution list <project> [--item <item>]  List recorded attempts
  execution show <project> <attempt>  Show input, results and evidence diagnostics
  execution finish <project> <attempt> --outcome succeeded|failed|stopped --summary <text> --expected-revision <revision>
  execution verify <project> <attempt> --command <text> --outcome passed|failed --evidence-file <file> --expected-revision <revision>
  execution accept|rework <project> <attempt> --note <text> --expected-revision <revision>
  execution recover <project>  Mark abandoned runtime work as awaiting confirmation
  execution confirm-interrupted <project> <attempt> --note <text> --expected-revision <revision>

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
    case "parallel-run":
      return parallelRunCommand(rest, io, cwd);
    case "plan-run":
      return planRunCommand(rest, io, cwd);
    case "execution":
      return executionCommand(rest, io, cwd);
    case "init":
      return initWorkspace(
        rest.find((arg) => arg !== "--json"),
        rest.includes("--json"),
        io,
        cwd,
      );
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
        return backlogShow(
          first,
          forwarded.find((arg) => !arg.startsWith("--")),
          json,
          io,
          cwd,
        );
      }
      if (sub === "update") {
        return backlogUpdate(
          first,
          forwarded.find((arg) => !arg.startsWith("--")),
          forwarded,
          json,
          io,
          cwd,
        );
      }
      io.stderr(`Unknown backlog command: ${sub ?? ""}`);
      return 1;
    }
    case "plan": {
      if (rest[0] === "next") return planNext(rest.slice(1), io, cwd);
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
        return planShow(
          first,
          forwarded.find((arg) => !arg.startsWith("--")),
          json,
          io,
          cwd,
        );
      }
      if (sub === "validate") {
        return planValidate(
          first,
          forwarded.find((arg) => !arg.startsWith("--")),
          json,
          io,
          cwd,
        );
      }
      if (sub === "approve") {
        const [planId, ...approveArgs] = forwarded;
        return planApprove(first, planId, approveArgs, json, io, cwd);
      }
      if (sub === "materialize") {
        return planMaterialize(
          first,
          forwarded.find((arg) => !arg.startsWith("--")),
          json,
          io,
          cwd,
        );
      }
      if (sub === "complete") {
        const [planId, ...completeArgs] = forwarded;
        return planComplete(first, planId, completeArgs, json, io, cwd);
      }
      if (sub === "revise") {
        const [planId, ...revisionArgs] = forwarded;
        return planRevise(first, planId, revisionArgs, json, io, cwd);
      }
      io.stderr(`Unknown plan command: ${sub ?? ""}`);
      return 1;
    }
    case "docs": {
      const [sub, first, ...subArgs] = rest;
      const json = [first, ...subArgs].includes("--json");
      if (sub === "scaffold") {
        return docsScaffold(first, json, io, cwd);
      }
      if (sub === "check") {
        return docsCheck(first, json, io, cwd);
      }
      io.stderr(`Unknown docs command: ${sub ?? ""}`);
      return 1;
    }
    case "report": {
      const [sub, projectId, ...subArgs] = rest;
      const json = [projectId, ...subArgs].includes("--json");
      const forwarded = subArgs.filter((arg) => arg !== "--json");
      if (sub === "create") {
        const [planId, ...createArgs] = forwarded;
        return reportCreate(projectId, planId, createArgs, json, io, cwd);
      }
      if (sub === "list") {
        return reportList(projectId, json, io, cwd);
      }
      if (sub === "show") {
        return reportShow(projectId, forwarded[0], json, io, cwd);
      }
      io.stderr(`Unknown report command: ${sub ?? ""}`);
      return 1;
    }
    case "retrospective": {
      const [sub, ...subArgs] = rest;
      const json = subArgs.includes("--json");
      const forwarded = subArgs.filter((arg) => arg !== "--json");
      if (sub === "capture") return retrospectiveCapture(forwarded, json, io, cwd);
      if (sub === "list") return retrospectiveList(forwarded, json, io, cwd);
      if (sub === "show")
        return retrospectiveShow(
          forwarded.find((arg) => !arg.startsWith("--")),
          json,
          io,
          cwd,
        );
      if (sub === "triage") return retrospectiveTriage(forwarded, json, io, cwd);
      if (sub === "archive") return retrospectiveArchive(forwarded, json, io, cwd);
      io.stderr(`Unknown retrospective command: ${sub ?? ""}`);
      return 1;
    }
    default:
      io.stderr(`Unknown command: ${command}`);
      return 1;
  }
}
