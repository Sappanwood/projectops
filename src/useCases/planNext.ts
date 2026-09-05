import { getPlanNext, type PlanNextTask } from "../application/planNext.js";
import type { CliIO } from "../io.js";

export function planNext(args: readonly string[], io: CliIO, cwd: string): number {
  const json = args.includes("--json");
  const positional = args.filter(arg => arg !== "--json");
  const fail = (error: string): number => {
    if (json) io.stdout(JSON.stringify({ ok: false, error }));
    else io.stderr(error);
    return 1;
  };
  if (positional.length !== 2 || positional.some(arg => arg.startsWith("-"))) {
    return fail("Usage: pops plan next <project> <plan-id> [--json]");
  }
  const result = getPlanNext({ workspaceDir: cwd, projectId: positional[0]!, planId: positional[1]! });
  if (!result.ok) return fail(`${result.error.code}: ${result.error.message}`);
  if (json) io.stdout(JSON.stringify({ ok: true, ...result.data }));
  else {
    const data = result.data;
    const row = (item: PlanNextTask) => `${item.id}  ${item.priority}  ${item.status}  ${item.title}`;
    const lines = [`Plan: ${data.plan_id}`, `下一项: ${data.next ? row(data.next) : "无可开始任务"}`];
    for (const [label, items] of [["可开始", data.ready], ["进行中", data.in_progress], ["受阻", data.blocked]] as const) {
      lines.push(`\n${label} (${items.length})`);
      for (const item of items) {
        lines.push(row(item));
        if ("reasons" in item) for (const reason of item.reasons) lines.push(`  ${reason.id}: ${reason.code} — ${reason.message}`);
      }
    }
    for (const diagnostic of data.diagnostics) lines.push(`诊断 ${diagnostic.id}: ${diagnostic.code} — ${diagnostic.message}`);
    io.stdout(lines.join("\n"));
  }
  return 0;
}
