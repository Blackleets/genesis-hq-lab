import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const arg=(n,f=null)=>{const i=process.argv.indexOf(n);return i>=0?(process.argv[i+1]??f):f;};
async function readJson(path,fallback){try{return JSON.parse(await readFile(path,'utf8'));}catch{return fallback;}}

async function main(){
  const adaptivePath=arg('--adaptive','quant-evidence/edge-adaptive-latest.json');
  const queuePath=arg('--queue','quant-evidence/edge-hypotheses-latest.json');
  const ledgerPath=arg('--ledger','quant-evidence/edge-deep-learning-ledger.json');
  const adaptive=JSON.parse(await readFile(adaptivePath,'utf8'));
  const queue=JSON.parse(await readFile(queuePath,'utf8'));
  if(adaptive.paperOnly!==true||adaptive.liveOrders!==false||adaptive.executionAuthority!==false||adaptive.capitalEligible!==false)throw new Error('adaptive_boundary_unverified');
  if(queue.paperOnly!==true||queue.liveOrders!==false||queue.executionAuthority!==false||queue.capitalEligible!==false)throw new Error('queue_boundary_unverified');
  const ledger=await readJson(ledgerPath,{version:'edge_deep_learning_ledger_v1',paperOnly:true,liveOrders:false,executionAuthority:false,capitalEligible:false,killed:{}});
  ledger.killed=ledger.killed??{};
  const control=adaptive.control;
  const bars=adaptive.methodology?.barsPerMarket??0;
  if(control&&bars>=10000&&control.researchStatus==='REJECT'&&(adaptive.promotableToAudit??0)===0){
    const train=control.train??{},validation=control.validation??{},wf=control.walkForward??{};
    const deepFailure=(train.expectancyBps??1)<=0&&((validation.profitFactor??99)<1.05||!wf.pass);
    if(deepFailure){
      const qItem=(queue.queue??[]).find(x=>x.parentVariant===control.parentVariant||x.id===control.id);
      const key=qItem?.hypothesisKey;
      if(key){
        const now=new Date().toISOString(),prior=ledger.killed[key];
        ledger.killed[key]={
          status:'DEEP_REJECTED',
          firstSeen:prior?.firstSeen??now,
          lastSeen:now,
          parentVariant:control.parentVariant,
          barsPerMarket:bars,
          reason:'DEEP_TRAIN_NEGATIVE_AND_VALIDATION_OR_WF_WEAK',
          resetPolicy:'MATERIAL_REGIME_OR_CONTEXT_CHANGE',
          evidence:{train:control.train,validation:control.validation,walkForward:control.walkForward}
        };
      }
    }
  }
  ledger.updatedAt=new Date().toISOString();
  await mkdir(dirname(ledgerPath),{recursive:true});
  await writeFile(ledgerPath,JSON.stringify(ledger,null,2)+'\n');
  console.log(JSON.stringify({ok:true,killed:Object.keys(ledger.killed).length,latest:Object.entries(ledger.killed).at(-1)?.[0]??null}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
