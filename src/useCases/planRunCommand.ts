import { parseArgs } from 'node:util';
import { createPlanRun, listPlanRuns, showPlanRun, PlanRunRuntime } from '../application/planRunApi.js';
import { ExecutionRuntime } from '../execution/runtime.js';
import type { CliIO } from '../io.js';

export function planRunCommand(args: readonly string[], io: CliIO, workspaceDir: string): number {
  try {
    const parsed = parseArgs({ args: [...args], allowPositionals: true, strict: true, options: {
      json: {type:'boolean'}, 'expected-revision':{type:'string'}, note:{type:'string'},
      'baseline-digest':{type:'string'}, plan:{type:'string'},
      instructions:{type:'string'},
    } });
    const [action,projectId,target] = parsed.positionals;
    if (!projectId || !action || !['create','list','show','pause','resume','close-stopped'].includes(action) || parsed.positionals.length > 3 || (action !== 'list' && !target) || (action === 'list' && target)) throw Error();
    const q = {workspaceDir,projectId}; const v=parsed.values;
    const mutation={...q,runId:target??'',expectedRevision:v['expected-revision']??'',...(v.note?{note:v.note}:{}),...(v['baseline-digest']?{baselineDigest:v['baseline-digest']}:{})};
    const runtime=new PlanRunRuntime(new ExecutionRuntime());
    const result=action==='list'?listPlanRuns({...q,...(v.plan?{planId:v.plan}:{})})
      :action==='show'?showPlanRun({...q,runId:target!})
      :action==='create'?createPlanRun({...q,planId:target!,expectedRevision:v['expected-revision']??'',...(v.instructions?{instructions:v.instructions}:{})})
      :action==='pause'?runtime.pause(mutation):action==='close-stopped'?runtime.closeStopped({...mutation,note:v.note??''}):runtime.resume({...mutation,note:v.note??''});
    if(v.json)io.stdout(JSON.stringify(result));else if(result.ok)io.stdout(JSON.stringify(result.data,null,2));else io.stderr(result.error.message);
    return result.ok?0:1;
  }catch{
    const error={code:'PLAN_RUN_INVALID',message:'Invalid Plan run arguments. See pops --help.'};
    if(args.includes('--json'))io.stdout(JSON.stringify({ok:false,error}));else io.stderr(error.message);return 1;
  }
}
