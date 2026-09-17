import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fetchKlines } from '../crypto/backtest/historicalData.mjs';
import { shortOnlyRegimeSwitchBreakoutSignal, longOnlyRegimeSwitchBreakoutSignal } from '../crypto/backtest/strategyLab.mjs';
import { evaluateVolatilitySizing } from '../risk/volatilitySizingEngine.mjs';
import { cryptoFuturesNetPnl, cryptoFuturesSlippagePct, estimateFundingFeeUsd, getCryptoFuturesFeePct } from '../trading/costs.mjs';
import { deriveVolatilityExit, exitVariantGrid } from '../../src/core/volatilityNormalizedExit.mjs';
import { summarizeCounterfactual } from '../../src/core/volatilitySizingImpact.mjs';

const VERSION='volatility_normalized_exit_lab_v1_oos';
const OUT=process.argv.includes('--out')?process.argv[process.argv.indexOf('--out')+1]:'quant-evidence/volatility-normalized-exit-lab-latest.json';
const DAYS=Math.max(30,Number(process.env.GENESIS_VOL_EXIT_DAYS||90));
const FEE=getCryptoFuturesFeePct();
const FUNDING_RATE=Number(process.env.GENESIS_VOL_EXIT_FUNDING_RATE||0.0001);

const profiles=[
  {id:'short_micro',pairs:['BTCUSDT','ETHUSDT','SOLUSDT'],interval:'5m',signalFn:shortOnlyRegimeSwitchBreakoutSignal,breakoutPeriod:20,sma:200,timeoutHours:8,leverage:3,margin:180},
  {id:'short_core',pairs:['BTCUSDT','ETHUSDT','SOLUSDT'],interval:'1h',signalFn:shortOnlyRegimeSwitchBreakoutSignal,breakoutPeriod:34,sma:200,timeoutHours:36,leverage:5,margin:400},
  {id:'short_alt',pairs:['XRPUSDT','DOGEUSDT','SOLUSDT','BNBUSDT'],interval:'15m',signalFn:shortOnlyRegimeSwitchBreakoutSignal,breakoutPeriod:12,sma:200,timeoutHours:16,leverage:3,margin:240},
  {id:'long_probe',pairs:['BTCUSDT','ETHUSDT','SOLUSDT'],interval:'4h',signalFn:longOnlyRegimeSwitchBreakoutSignal,breakoutPeriod:55,sma:200,timeoutHours:240,leverage:3,margin:260},
];
const variants=exitVariantGrid();
const BASELINE={id:'fixed_tp10_sl3',targetPct:0.10,stopPct:0.03};

function intervalMinutes(tf){
  if(tf.endsWith('m')) return Number(tf.slice(0,-1));
  if(tf.endsWith('h')) return Number(tf.slice(0,-1))*60;
  return 1440;
}
function periodsPerYear(tf){return 365*24*60/intervalMinutes(tf);}

function buildVolumeAt(klines,tf){
  const q=klines.map(x=>Number(x[7])||0),p=[0];
  for(const x of q)p.push(p[p.length-1]+x);
  const bars=Math.max(1,Math.round(1440/intervalMinutes(tf)));
  return i=>{
    const start=Math.max(0,i-bars+1),span=i-start+1,sum=p[i+1]-p[start];
    return span?sum*(bars/span):0;
  };
}

function prepareSeries(klines,cfg){
  const closesAll=klines.map(x=>Number(x[4]));
  const candidates=new Map();
  const warmup=Math.max(220,cfg.sma+5,cfg.breakoutPeriod+5);
  for(let i=warmup;i<klines.length;i++){
    const closes=closesAll.slice(Math.max(0,i-1000+1),i+1);
    const sig=cfg.signalFn({closes},{breakoutPeriod:cfg.breakoutPeriod,regimeSmaPeriod:cfg.sma});
    if(sig.action!=='TRADE')continue;
    const vol=evaluateVolatilitySizing(closes,{periodsPerYear:periodsPerYear(cfg.interval),minHistory:220,minHoldout:60,minMultiplier:0.25});
    candidates.set(i,{side:sig.side,vol});
  }
  return {candidates,warmup};
}

function splitLabel(i,n){return i<Math.floor(n*0.60)?'train':i<Math.floor(n*0.80)?'validation':'holdout';}

function simulate(klines,cfg,prepared,variant){
  const volumeAt=buildVolumeAt(klines,cfg.interval);
  const out=[];
  let pos=null;
  const timeoutMs=cfg.timeoutHours*3600000;
  for(let i=prepared.warmup;i<klines.length;i++){
    const c=klines[i],high=Number(c[2]),low=Number(c[3]),close=Number(c[4]),ts=Number(c[0]);
    if(pos){
      let exitPrice=null,exitReason=null;
      if(ts-pos.openTime>=timeoutMs){exitPrice=close;exitReason='timeout';}
      else if(pos.side==='LONG'){
        if(low<=pos.stop){exitPrice=pos.stop;exitReason='stop_loss';}
        else if(high>=pos.target){exitPrice=pos.target;exitReason='target_hit';}
      }else{
        if(high>=pos.stop){exitPrice=pos.stop;exitReason='stop_loss';}
        else if(low<=pos.target){exitPrice=pos.target;exitReason='target_hit';}
      }
      if(exitReason){
        const holdingHours=Math.max(1,(ts-pos.openTime)/3600000);
        const notional=cfg.margin*cfg.leverage;
        const shares=notional/pos.entryPrice;
        const slip=cryptoFuturesSlippagePct(notional,pos.volume24hUsd);
        const funding=estimateFundingFeeUsd({notionalUsd:notional,fundingRate:FUNDING_RATE,holdingHours});
        out.push({
          profile:cfg.id,pair:cfg.pair,interval:cfg.interval,variant:variant.id,
          split:pos.split,side:pos.side,openTime:pos.openTime,closeTime:ts,
          exitReason,holdingHours,entryPrice:pos.entryPrice,exitPrice,
          baselineMarginUsd:cfg.margin,
          baselinePnlUsd:cryptoFuturesNetPnl({side:pos.side,entryPrice:pos.entryPrice,exitPrice,shares,feePct:FEE,slippagePct:slip,fundingFeeUsd:funding}),
          volModel:pos.vol.model,volRegime:pos.vol.regime,volValidated:pos.vol.validated,
          targetPct:pos.targetPct,stopPct:pos.stopPct,
        });
        pos=null;
      }
      continue;
    }
    const candidate=prepared.candidates.get(i);
    if(!candidate)continue;

    let targetPct=BASELINE.targetPct,stopPct=BASELINE.stopPct;
    if(variant.id!==BASELINE.id && candidate.vol.validated===true){
      const d=deriveVolatilityExit({
        forecastVolAnnualizedPct:candidate.vol.forecastVolAnnualizedPct,
        periodsPerYear:periodsPerYear(cfg.interval),
        intervalMinutes:intervalMinutes(cfg.interval),
        timeoutHours:cfg.timeoutHours,
        stopSigma:variant.stopSigma,rewardRisk:variant.rewardRisk,
      });
      if(d.ok){targetPct=d.targetPct;stopPct=d.stopPct;}
    }
    const side=candidate.side;
    pos={
      side,entryPrice:close,openTime:ts,split:splitLabel(i,klines.length),vol:candidate.vol,
      volume24hUsd:volumeAt(i),targetPct,stopPct,
      target:side==='LONG'?close*(1+targetPct):close*(1-targetPct),
      stop:side==='LONG'?close*(1-stopPct):close*(1+stopPct),
    };
  }
  return out;
}

function metrics(rows){return summarizeCounterfactual(rows,'baselinePnlUsd','baselineMarginUsd');}
function score(m){
  if(!m||m.trades<1||m.expectancyBps==null)return -Infinity;
  return m.expectancyBps*(m.profitFactor??0)*Math.max(0.1,1/(1+(m.maxDrawdownUsd??0)/100));
}

async function main(){
  const results=[],errors=[];
  for(const p of profiles){
    const preparedByPair={};
    for(const pair of p.pairs){
      try{
        const klines=await fetchKlines(pair,{days:DAYS,interval:p.interval});
        preparedByPair[pair]={klines,prepared:prepareSeries(klines,{...p,pair})};
      }catch(e){errors.push({profile:p.id,pair,error:String(e?.message||e)});}
    }

    const runVariant=(variant)=>{
      const trades=[];
      for(const [pair,x] of Object.entries(preparedByPair))trades.push(...simulate(x.klines,{...p,pair},x.prepared,variant));
      trades.sort((a,b)=>a.openTime-b.openTime);
      return {
        variant,
        trades,
        train:metrics(trades.filter(t=>t.split==='train')),
        validation:metrics(trades.filter(t=>t.split==='validation')),
        holdout:metrics(trades.filter(t=>t.split==='holdout')),
      };
    };

    const baseline=runVariant(BASELINE);
    const tested=variants.map(runVariant);
    const trainQualified=tested.filter(x=>x.train.trades>=20&&(x.train.expectancyBps??-Infinity)>0&&(x.train.profitFactor??0)>1.05);
    const validationQualified=trainQualified.filter(x=>x.validation.trades>=8&&(x.validation.expectancyBps??-Infinity)>0&&(x.validation.profitFactor??0)>1.05);
    validationQualified.sort((a,b)=>score(b.validation)-score(a.validation));
    const selected=validationQualified[0]??null;
    const holdoutPass=Boolean(selected&&selected.holdout.trades>=8&&(selected.holdout.expectancyBps??-Infinity)>0&&(selected.holdout.profitFactor??0)>1.10);
    results.push({
      profile:p.id,interval:p.interval,pairs:p.pairs,
      baseline:{train:baseline.train,validation:baseline.validation,holdout:baseline.holdout},
      variantsTested:tested.length,
      trainQualified:trainQualified.length,
      validationQualified:validationQualified.length,
      selected:selected?{variant:selected.variant,train:selected.train,validation:selected.validation,holdout:selected.holdout}:null,
      holdoutPass,
      researchCandidate:holdoutPass,
      capitalEligible:false,
      liveEligible:false,
      requiresIndependentForward:true,
      reason:holdoutPass?'VOL_NORMALIZED_EXIT_SURVIVED_TRAIN_VALIDATION_HOLDOUT_REQUIRES_FORWARD':'NO_VOL_EXIT_VARIANT_SURVIVED_OOS_GATES',
      topValidation:validationQualified.slice(0,5).map(x=>({variant:x.variant,train:x.train,validation:x.validation,holdout:x.holdout})),
    });
  }
  const candidates=results.filter(x=>x.researchCandidate);
  const output={
    ok:true,version:VERSION,generatedAt:new Date().toISOString(),mode:'RESEARCH_ONLY',
    methodology:{
      entrySignals:'unchanged current futures breakout family',
      fixedBaseline:BASELINE,
      variantGrid:variants,
      split:'60% train / 20% validation / 20% untouched holdout by bar time',
      volatility:'causal model competition forecast known at entry; dynamic exits used only when vol model validated',
      costs:'Genesis futures taker fees + size/volume slippage + same funding assumption',
      caveat:'variant search is multiple testing; even a holdout survivor gets zero capital until a new independent forward window confirms it',
    },
    profiles:results,
    candidateCount:candidates.length,
    candidates,
    errors,
    invariants:{paperOnly:true,researchOnly:true,createsSignals:false,changesProductionExits:false,capitalEligible:false,liveEligible:false,executionAuthority:false},
  };
  await mkdir(dirname(OUT),{recursive:true});await writeFile(OUT,JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify({version:VERSION,candidateCount:candidates.length,candidates:candidates.map(x=>({profile:x.profile,variant:x.selected?.variant,holdout:x.selected?.holdout,baselineHoldout:x.baseline.holdout})),profiles:results.map(x=>({profile:x.profile,baselineHoldout:x.baseline.holdout,variantsTested:x.variantsTested,trainQualified:x.trainQualified,validationQualified:x.validationQualified,selected:x.selected,holdoutPass:x.holdoutPass}))}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
