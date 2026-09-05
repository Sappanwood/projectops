import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { revisePlan } from "../application/planRevision.js";
import type { CliIO } from "../io.js";

export function planRevise(projectId: string | undefined, planId: string | undefined, args: string[], json: boolean, io: CliIO, cwd: string): number {
  if (!projectId || !planId) { io.stderr("Usage: pops plan revise <project-id> <plan-id> --input <draft.json> --expected-revision <rev> [--confirm <preview-token>] [--json]"); return 1; }
  let values;
  let draft: unknown;
  try {
    values = parseArgs({args,options:{input:{type:"string"},"expected-revision":{type:"string"},confirm:{type:"string"}},strict:true,allowPositionals:false}).values;
    if (!values.input || !values["expected-revision"]) throw new Error("missing input/revision");
    draft = JSON.parse(readFileSync(values.input,"utf8"));
  } catch { io.stderr("Error: provide valid --input JSON and --expected-revision."); return 1; }
  const result = revisePlan({workspaceDir:cwd,projectId,planId,draft,expectedRevision:values["expected-revision"],...(values.confirm===undefined?{}:{confirm:values.confirm})});
  if (!result.ok) { io.stderr(`Error: ${result.error.message}`); return 1; }
  if (json) io.stdout(JSON.stringify({ok:true,...result.data}));
  else io.stdout(`${result.data.applied?"Applied":"Preview"} ${planId}\n${JSON.stringify(result.data.changes,null,2)}\nRevision: ${result.data.revision}\nConfirm: ${result.data.confirmation_token}`);
  return 0;
}
