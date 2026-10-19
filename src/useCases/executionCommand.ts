import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import path from "node:path";
import type { CliIO } from "../io.js";
import { executionCli, type ExecutionCliOptions } from "./executionCli.js";

export function executionCommand(args: readonly string[], io: CliIO, cwd: string): number {
  const separator = args.indexOf("--");
  const ownArgs = separator < 0 ? args : args.slice(0, separator);
  try {
    const parsed = parseArgs({
      args: [...ownArgs],
      allowPositionals: true,
      strict: true,
      options: {
        json: { type: "boolean" },
        view: { type: "string" },
        "timeout-ms": { type: "string" },
        "expected-revision": { type: "string" },
        instructions: { type: "string" },
        "retry-of": { type: "string" },
        outcome: { type: "string" },
        summary: { type: "string" },
        command: { type: "string" },
        "evidence-file": { type: "string" },
        note: { type: "string" },
        item: { type: "string" },
      },
    });
    const [action, project, target] = parsed.positionals;
    const actions = new Set([
      "create",
      "list",
      "show",
      "finish",
      "verify",
      "check",
      "accept",
      "rework",
      "recover",
      "confirm-interrupted",
    ]);
    if (
      !action ||
      !actions.has(action) ||
      !project ||
      parsed.positionals.length > 3 ||
      (!["list", "recover"].includes(action) && !target) ||
      (["list", "recover"].includes(action) && target)
    )
      throw new Error("Invalid execution arguments.");
    const v = parsed.values;
    if (v.view !== undefined && !["summary", "full"].includes(v.view))
      throw new Error("Invalid execution view.");
    if (action === "check") {
      if (
        separator < 0 ||
        separator === args.length - 1 ||
        Object.keys(v).some(
          (key) => !["json", "view", "expected-revision", "timeout-ms"].includes(key),
        )
      )
        throw new Error("Check requires argv after -- and does not accept declared results.");
    } else if (separator >= 0 || v["timeout-ms"] !== undefined) {
      throw new Error("Command argv and timeout are only supported by check.");
    }
    const options: ExecutionCliOptions = {
      ...(v.json === undefined ? {} : { json: v.json }),
      ...(v.view === undefined ? {} : { view: v.view as "summary" | "full" }),
      ...(action === "check" ? { argv: args.slice(separator + 1) } : {}),
      ...(v["timeout-ms"] === undefined ? {} : { timeoutMs: Number(v["timeout-ms"]) }),
      ...(v["expected-revision"] === undefined ? {} : { expectedRevision: v["expected-revision"] }),
      ...(v.instructions === undefined ? {} : { instructions: v.instructions }),
      ...(v["retry-of"] === undefined ? {} : { retryOf: v["retry-of"] }),
      ...(v.outcome === undefined ? {} : { outcome: v.outcome }),
      ...(v.summary === undefined ? {} : { summary: v.summary }),
      ...(v.command === undefined ? {} : { command: v.command }),
      ...(v.note === undefined ? {} : { note: v.note }),
      ...(v.item === undefined ? {} : { item: v.item }),
      ...(v["evidence-file"] === undefined
        ? {}
        : { evidence: readFileSync(path.resolve(cwd, v["evidence-file"]), "utf8") }),
    };
    return executionCli(action, project, target, options, io, cwd);
  } catch {
    const error = {
      code: "EXECUTION_INVALID",
      message: "Invalid execution arguments or unreadable evidence file. See pops --help.",
    };
    if (ownArgs.includes("--json")) io.stdout(JSON.stringify({ ok: false, error }));
    else io.stderr(error.message);
    return 1;
  }
}
