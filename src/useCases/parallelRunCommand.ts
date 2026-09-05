import {parseArgs} from 'node:util';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {createParallelRun,listParallelRuns,showParallelRun,ParallelRunRuntime} from '../application/parallelRunApi.js';
import {ExecutionRuntime} from '../execution/runtime.js';
import {captureSnapshot} from '../execution/snapshot.js';
import {context} from '../execution/store.js';
import type {CliIO} from '../io.js';
import {DEFAULT_PARALLEL_COMMANDS} from '../planRun/commands.js';

export function parallelRunCommand(args:readonly string[],io:CliIO,workspaceDir:string):number {
 try {
  const p=parseArgs({args:[...args],allowPositionals:true,strict:true,options:{json:{type:'boolean'},'expected-revision':{type:'string'},'commands-file':{type:'string'},'base-commit':{type:'string'},'integration-head':{type:'string'},note:{type:'string'},node:{type:'string'},plan:{type:'string'}}});
  const [action,projectId,target]=p.positionals;const v=p.values;
  if(!projectId||!action||!['create','list','show','pause','resume','close-stopped','rework'].includes(action)||p.positionals.length>3||(action!=='list'&&!target)||(action==='list'&&target))throw Error();
  const q={workspaceDir,projectId};const mutation={...q,runId:target??'',expectedRevision:v['expected-revision']??''};const runtime=new ParallelRunRuntime(new ExecutionRuntime());
  const result=action==='list'?listParallelRuns({...q,...(v.plan?{planId:v.plan}:{})}):action==='show'?showParallelRun({...q,runId:target!})
   :action==='create'?createParallelRun({...q,planId:target!,expectedRevision:v['expected-revision']??'',baseCommit:v['base-commit']??captureSnapshot(context(workspaceDir,projectId).repo).head,commands:v['commands-file']?JSON.parse(readFileSync(path.resolve(workspaceDir,v['commands-file']),'utf8')):DEFAULT_PARALLEL_COMMANDS})
   :action==='pause'?runtime.pause(mutation):action==='resume'?runtime.resume({...mutation,note:v.note??'',...(v['integration-head']?{integrationHead:v['integration-head']}:{})})
   :action==='rework'?runtime.rework({...mutation,nodeKey:v.node??'',note:v.note??''}):runtime.closeStopped({...mutation,note:v.note??''});
  if(v.json)io.stdout(JSON.stringify(result));else if(result.ok)io.stdout(JSON.stringify(result.data,null,2));else io.stderr(result.error.message);return result.ok?0:1;
 }catch{const error={code:'PARALLEL_RUN_INVALID',message:'Invalid parallel run arguments or command file. See pops --help.'};if(args.includes('--json'))io.stdout(JSON.stringify({ok:false,error}));else io.stderr(error.message);return 1;}
}
