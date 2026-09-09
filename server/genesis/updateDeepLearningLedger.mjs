import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const arg=(n,f=null)=>{const i=process.argv.indexOf(n);return i>=0?(process.argv[i+1]??f):f;};
async function readJson(path,fallback){try{return JSON.parse(await readFile(path,'utf8'));}catch{return fallback;}}

function deepFailureReason(train,validation,wf){
  if((train.trades??0)<20||(validation.trades??0)<8)return'INSUFFICIENT_DEEP_SAMPLE';
  if((train.expectancyBps??-Infinity)<=0)return'DEEP_NEGATIVE_TRAIN_EXPECTANCY';
  if((validation.expectancyBps??-Infinity)<=0)return'DEEP_NEGATIVE_VALIDATION_EXPECTANCY';
  if((train.profitFactor??0)<1.05)return'DEEP_WEAK_TRAIN_PROFIT_FACTOR';
  if((validation.profitFactor??0)<1.15)return'DEEP_WEAK_VALIDATION_PROFIT_FACTOR';
  if(!wf.pass)return'DEEP_WALK_FORWARD_UNSTABLE';
  return null;
}

async function main(){
  const adaptivePath=arg('--adaptive','quant-evidence/edge-adaptive-latest.json');
  const queuePath=arg('--queue','quant-evidence/edge-hypotheses-latest.json');
  const auditLedgerPath=arg('--audit-ledger',null);
  const ledgerPath=arg('--ledger','quant-evidence/edge-deep-learning-ledger.json');
  const adaptive=JSON.parse(await readFile(adaptivePath,'utf8'));
  const queue=JSON.parse(await readFile(queuePath,'utf8'));
  const auditLedger=auditLedgerPath?await readJson(auditLedgerPath,{auditedIds:[],passedCandidates:{}}):{auditedIds:[],passedCandidates:{}};
  if(adaptive.paperOnly!==true||adaptive.liveOrders!==false||adaptive.executionAuthority!==false||adaptive.capitalEligible!==false)throw new Error('adaptive_boundary_unverified');
  if(queue.paperOnly!==true||queue.liveOrders!==false||queue.executionAuthority!==false||queue.capitalEligible!==false)throw new Error('queue_boundary_unverified');
  const ledger=await readJson(ledgerPath,{version:'edge_deep_learning_ledger_v4_audit_aware',paperOnly:true,liveOrders:false,executionAuthority:false,capitalEligible:false,killed:{}});
  ledger.version='edge_deep_learning_ledger_v4_audit_aware';
  ledger.paperOnly=true;ledger.liveOrders=false;ledger.executionAuthority=false;ledger.capitalEligible=false;
  ledger.killed=ledger.killed??{};
  const controls=Array.isArray(adaptive.controlSet)&&adaptive.controlSet.length?adaptive.controlSet:(adaptive.control?[adaptive.control]:[]);
  const bars=adaptive.methodology?.barsPerMarket??0;
  const auditedIds=new Set(auditLedger?.auditedIds??[]);
  const passedIds=new Set(Object.keys(auditLedger?.passedCandidates??{}));
  const freshPromotions=(adaptive.auditQueue??[]).filter(x=>!auditedIds.has(x.id)||passedIds.has(x.id));
  const promotedKeys=new Set(freshPromotions.map(x=>x.hypothesisKey).filter(Boolean));
  const newlyKilled=[];
  if(bars>=10000){
    for(const control of controls){
      if(!control||control.researchStatus!=='REJECT')continue;
      const qItem=(queue.queue??[]).find(x=>x.hypothesisKey===control.hypothesisKey||x.parentVariant===control.parentVariant||x.id===control.id);
      const key=control.hypothesisKey??qItem?.hypothesisKey;
      if(!key||promotedKeys.has(key))continue;
      const train=control.train??{},validation=control.validation??{},wf=control.walkForward??{};
      const reason=deepFailureReason(train,validation,wf);
      if(!reason)continue;
      const now=new Date().toISOString(),prior=ledger.killed[key];
      ledger.killed[key]={status:'DEEP_REJECTED',firstSeen:prior?.firstSeen??now,lastSeen:now,parentVariant:control.parentVariant,barsPerMarket:bars,reason,resetPolicy:'MATERIAL_REGIME_OR_CONTEXT_CHANGE',evidence:{train:control.train,validation:control.validation,walkForward:control.walkForward}};
      newlyKilled.push(key);
    }
  }
  ledger.updatedAt=new Date().toISOString();
  await mkdir(dirname(ledgerPath),{recursive:true});
  await writeFile(ledgerPath,JSON.stringify(ledger,null,2)+'\n');
  console.log(JSON.stringify({ok:true,version:ledger.version,controlsEvaluated:controls.length,freshPromotions:freshPromotions.length,newlyKilled,killed:Object.keys(ledger.killed).length}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
