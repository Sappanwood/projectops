import {completePlan} from '../src/application/planComplete.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {runCli} from '../src/app.js';
import {readPlan} from '../src/plan/planFs.js';
import {computePlanRevision} from '../src/application/planRevision.js';
import {createPlanRun} from '../src/application/planRunApi.js';
import {writeGeneratedReport} from '../src/useCases/reportGenerate.js';

test('Backlog done cannot produce completed Report while its real run is unconfirmed',()=>{
 const workspaceRoot=mkdtempSync(path.join(tmpdir(),'report-run-'));
 const cli=(a:string[])=>assert.equal(runCli(a,{stdout(){},stderr(){}},workspaceRoot),0);
 cli(['init']);const repo=path.join(workspaceRoot,'repo');mkdirSync(repo);execFileSync('git',['init'],{cwd:repo,stdio:'ignore'});
 cli(['project','add','repo']);cli(['backlog','init','repo']);
 const plansRoot=path.join(workspaceRoot,'ops/repo/plans');
 writeFileSync(path.join(plansRoot,'plan-proof.json'),JSON.stringify({schema:'plan/Plan@1',id:'plan-proof',title:'Proof',goal:'Verify',status:'approved',approval:{approved_at:new Date().toISOString(),review_note:'fixture'},items:[{key:'a',title:'A',item_type:'task',priority:'P1',body:'Verify',depends_on:[]}]}));
 cli(['plan','materialize','repo','plan-proof']);
 const created=createPlanRun({workspaceDir:workspaceRoot,projectId:'repo',planId:'plan-proof',expectedRevision:computePlanRevision(readPlan(plansRoot,'plan-proof'))});assert.equal(created.ok,true);
 cli(['backlog','update','repo','REP-001','--status','done']);
 const input={workspaceRoot,reportsRoot:path.join(workspaceRoot,'ops/repo/reports'),backlogRoot:path.join(workspaceRoot,'ops/repo/backlog'),plansRoot,projectId:'repo',planId:'plan-proof',verification:['fixture evidence']};
 assert.equal(completePlan({workspaceDir:workspaceRoot,projectId:'repo',planId:'plan-proof',expectedRevision:computePlanRevision(readPlan(plansRoot,'plan-proof'))}).ok,false);
 assert.throws(()=>writeGeneratedReport(input),/run|运行/i);
 const partial=writeGeneratedReport({...input,partialAcceptance:'Fixture explicitly accepts pending run.'});assert.equal(partial.outcome,'partial');
});
