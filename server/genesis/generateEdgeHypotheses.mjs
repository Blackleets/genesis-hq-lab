import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const arg=(n,f=null)=>{const i=process.argv.indexOf(n);return i>=0?(process.argv[i+1]??f):f;};
const uniq=a=>[...new Set(a)];
const clamp=(v,min,max)=>Math.min(max,Math.max(min,v));
const round=(v,d=2)=>Number(Number(v).toFixed(d));
async function readJson(path,fallback=null){try{return JSON.parse(await readFile(path,'utf8'));}catch{return fallback;}}

// Evolution score intentionally excludes holdout. Holdout is audit evidence, never a mutation selector.
function score(item){
  const a=item.train??{},b=item.validation??{},w=item.walkForward??{};
  let s=0;
  if(item.status==='PAPER_CANDIDATE') s+=100;
  else if(item.status==='INTERESTING') s+=60;
  else if(item.status==='REGIME_DIVERGENCE') s+=25;
  s+=Math.max(-20,Math.min(30,(a.expectancyBps??-20)/2));
  s+=Math.max(-20,Math.min(40,(b.expectancyBps??-20)/2));
  s+=(w.positiveFolds??0)*4;
  s+=Math.max(0,Math.min(12,((b.profitFactor??0)-1)*20));
  return round(s,2);
}

function sentinelCritique(item){
  const issues=[];
  const a=item.train??{},b=item.validation??{},c=item.holdout??{},w=item.walkForward??{};
  if((a.trades??0)<30) issues.push('TRAIN_SAMPLE_THIN');
  if((b.trades??0)<12) issues.push('VALIDATION_SAMPLE_THIN');
  if((c.trades??0)<15) issues.push('HOLDOUT_SAMPLE_THIN');
  if((c.tStat??0)<0.75) issues.push('LOW_HOLDOUT_TSTAT');
  if((c.profitFactor??0)<1.2) issues.push('WEAK_HOLDOUT_PROFIT_FACTOR');
  if(!w.pass) issues.push('WALK_FORWARD_UNSTABLE');
  if((a.expectancyBps??-1)<=0) issues.push('NEGATIVE_TRAIN_EXPECTANCY');
  if((b.expectancyBps??-1)<=0) issues.push('NEGATIVE_VALIDATION_EXPECTANCY');
  if((c.expectancyBps??-1)<=0) issues.push('NEGATIVE_HOLDOUT_EXPECTANCY');
  return issues.length?issues:['NO_CRITICAL_STATISTICAL_OBJECTION'];
}

function mutations(item){
  const c=item.candidate;
  const periods=uniq([Math.max(8,c.period-4),c.period,Math.min(80,c.period+4)]);
  const targets=uniq([clamp(c.targetAtr-.25,.75,3),c.targetAtr,clamp(c.targetAtr+.25,.75,3)]).map(x=>round(x,2));
  const stops=uniq([clamp(c.stopAtr-.15,.45,1.5),c.stopAtr,clamp(c.stopAtr+.15,.45,1.5)]).map(x=>round(x,2));
  const timeouts=uniq([Math.max(4,c.timeoutBars-2),c.timeoutBars,Math.min(16,c.timeoutBars+4)]);
  const out=[];
  for(const period of periods)for(const targetAtr of targets)for(const stopAtr of stops)for(const timeoutBars of timeouts){
    if(period===c.period&&targetAtr===c.targetAtr&&stopAtr===c.stopAtr&&timeoutBars===c.timeoutBars) continue;
    const changed=[period!==c.period,targetAtr!==c.targetAtr,stopAtr!==c.stopAtr,timeoutBars!==c.timeoutBars].filter(Boolean).length;
    const distance=Math.abs(period-c.period)/4+Math.abs(targetAtr-c.targetAtr)/.25+Math.abs(stopAtr-c.stopAtr)/.15+Math.abs(timeoutBars-c.timeoutBars)/2;
    out.push({family:c.family,period,targetAtr,stopAtr,timeoutBars,session:c.session,_changed:changed,_distance:distance});
  }
  return out.sort((a,b)=>a._changed-b._changed||a._distance-b._distance||a.period-b.period||a.targetAtr-b.targetAtr||a.stopAtr-b.stopAtr||a.timeoutBars-b.timeoutBars)
    .map(({_changed,_distance,...spec})=>spec);
}

function reasonFor(item,rule){
  if(item.status==='PAPER_CANDIDATE') return 'Candidate survived current gates; stress-test a balanced local neighborhood before one-shot audit or forward PAPER.';
  if(item.status==='INTERESTING') return 'Train and validation are directionally consistent; test balanced nearby parameters without using holdout for selection.';
  if(item.status==='REGIME_DIVERGENCE') return `Recent validation improved while prior regime did not. Retest only as a regime-specific hypothesis${rule?.dominantFailure?` (${rule.dominantFailure})`:''}.`;
  return 'Low-priority research item.';
}

function deepOverride(adaptive,sources){
  if(!adaptive||adaptive.paperOnly!==true||adaptive.liveOrders!==false)return null;
  const bars=adaptive.methodology?.barsPerMarket??0,control=adaptive.control;
  if(bars<10000||!control||control.researchStatus!=='REJECT'||(adaptive.promotableToAudit??0)>0)return null;
  const train=control.train??{},validation=control.validation??{},wf=control.walkForward??{};
  const deepFailure=(train.expectancyBps??1)<=0&&((validation.profitFactor??99)<1.05||!wf.pass);
  if(!deepFailure)return null;
  const source=sources.find(x=>x.variantKey===control.parentVariant);
  if(!source)return null;
  return {hypothesisKey:source.hypothesisKey,parentVariant:control.parentVariant,action:'KILL_DEEP_VALIDATION',reason:'Deep retest invalidated the short-window signal; suppress mutations until a materially different regime/context is proposed.',evidence:{barsPerMarket:bars,train:control.train,validation:control.validation,walkForward:control.walkForward}};
}

function bestPerHypothesis(items){
  const best=new Map();
  for(const item of items){
    const ranked={...item,researchScore:score(item)};
    const prior=best.get(item.hypothesisKey);
    if(!prior||ranked.researchScore>prior.researchScore)best.set(item.hypothesisKey,ranked);
  }
  return [...best.values()].sort((a,b)=>b.researchScore-a.researchScore);
}

async function main(){
  const edgePath=arg('--edge','quant-evidence/edge-factory-latest.json');
  const learningPath=arg('--learning','quant-evidence/edge-learning-latest.json');
  const adaptivePath=arg('--adaptive',null);
  const deepLedgerPath=arg('--deep-ledger',null);
  const forwardPath=arg('--forward',null);
  const out=arg('--out','quant-evidence/edge-hypotheses-latest.json');
  const history=arg('--history','quant-evidence/edge-hypotheses-history.jsonl');
  const edge=JSON.parse(await readFile(edgePath,'utf8'));
  const learning=JSON.parse(await readFile(learningPath,'utf8'));
  const adaptive=adaptivePath?await readJson(adaptivePath,null):null;
  const deepLedger=deepLedgerPath?await readJson(deepLedgerPath,{killed:{}}):{killed:{}};
  const forward=forwardPath?await readJson(forwardPath,null):null;
  if(edge.paperOnly!==true||edge.liveOrders!==false||edge.executionAuthority!==false||edge.capitalEligible!==false) throw new Error('edge_boundary_unverified');
  if(forward&&!(forward.paperOnly===true&&forward.liveOrders===false&&forward.executionAuthority===false&&forward.capitalEligible===false)) throw new Error('forward_boundary_unverified');
  const rules=new Map((learning.rules??[]).map(r=>[r.hypothesisKey,r]));
  const sources=(edge.top??[]).filter(x=>['PAPER_CANDIDATE','INTERESTING','REGIME_DIVERGENCE'].includes(x.status));
  const override=deepOverride(adaptive,sources);
  const durableKilled=new Set(Object.keys(deepLedger?.killed??{}));
  if(override)durableKilled.add(override.hypothesisKey);
  const forwardEnrolled=new Set((forward?.families??[]).map(f=>f.familyKey).filter(Boolean));
  const eligible=sources.filter(x=>!durableKilled.has(x.hypothesisKey)&&!forwardEnrolled.has(x.hypothesisKey));
  const ranked=bestPerHypothesis(eligible);
  const queue=[];
  for(const source of ranked.slice(0,6)){
    const rule=rules.get(source.hypothesisKey),critique=sentinelCritique(source),priority=source.status==='PAPER_CANDIDATE'?'P0':source.status==='INTERESTING'?'P1':'P2';
    queue.push({id:`${source.variantKey??source.hypothesisKey}:control`,role:'CONTROL',priority,parentVariant:source.variantKey??source.hypothesisKey,hypothesisKey:source.hypothesisKey,market:source.market,spec:source.candidate,rationale:'Control replay of the best parent for this independent hypothesis. It prevents data drift from being mistaken for parameter improvement.',sentinelCritique:critique,expectedFalsification:'Control must remain directionally consistent on train and validation; otherwise pause mutations and diagnose regime/data drift.',sourceEvidence:{train:source.train,validation:source.validation,holdout:source.holdout,walkForward:source.walkForward}});
    const limit=source.status==='REGIME_DIVERGENCE'?4:10;
    for(const spec of mutations(source).slice(0,limit))queue.push({id:`${source.hypothesisKey}:p${spec.period}:ta${spec.targetAtr}:sa${spec.stopAtr}:tb${spec.timeoutBars}`,role:'MUTATION',priority,parentVariant:source.variantKey??source.hypothesisKey,hypothesisKey:source.hypothesisKey,market:source.market,spec,rationale:reasonFor(source,rule),sentinelCritique:critique,expectedFalsification:'Reject if train/validation expectancy loses sign, validation PF < 1.05, or walk-forward stability deteriorates. Holdout is not consulted for mutation selection.',sourceEvidence:{train:source.train,validation:source.validation,holdout:source.holdout,walkForward:source.walkForward}});
  }
  const deepOverrides=[...durableKilled].map(hypothesisKey=>({hypothesisKey,action:'SUPPRESS_DEEP_REJECTED',ledger:deepLedger?.killed?.[hypothesisKey]??(override?.hypothesisKey===hypothesisKey?override:null)}));
  const forwardSuppressed=[...forwardEnrolled].map(hypothesisKey=>({hypothesisKey,action:'SUPPRESS_FORWARD_ENROLLED',reason:'Family already has a frozen forward champion. Continue collecting new data there while research capacity searches for an independent edge.'}));
  const snapshot={ok:true,version:'edge_hypothesis_generator_v5_parallel_discovery',mode:'RESEARCH_ONLY',paperOnly:true,liveOrders:false,executionAuthority:false,capitalEligible:false,completedAt:new Date().toISOString(),methodology:{selectionUsesHoldout:false,balancedNeighborhood:true,parentControl:true,deepValidationOverridesShortWindow:true,durableDeepMemory:true,forwardEnrolledSuppression:true,oneParentPerHypothesis:true},sourceVerdict:edge.verdict,queueSize:queue.length,deepOverrides,forwardSuppressed,focus:ranked[0]?{hypothesisKey:ranked[0].hypothesisKey,variantKey:ranked[0].variantKey??null,market:ranked[0].market,candidate:ranked[0].candidate,status:ranked[0].status,researchScore:ranked[0].researchScore,sentinelCritique:sentinelCritique(ranked[0])}:null,queue:queue.slice(0,30)};
  await mkdir(dirname(out),{recursive:true});await writeFile(out,JSON.stringify(snapshot,null,2)+'\n');await appendFile(history,JSON.stringify(snapshot)+'\n');
  console.log(JSON.stringify({ok:true,queueSize:snapshot.queueSize,focus:snapshot.focus?.hypothesisKey??null,deepKilled:deepOverrides.length,forwardSuppressed:forwardSuppressed.length,selectionUsesHoldout:false}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
