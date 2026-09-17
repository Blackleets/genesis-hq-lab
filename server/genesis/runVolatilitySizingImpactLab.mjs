import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fetchKlines } from '../crypto/backtest/historicalData.mjs';
import { shortOnlyRegimeSwitchBreakoutSignal, longOnlyRegimeSwitchBreakoutSignal } from '../crypto/backtest/strategyLab.mjs';
import { evaluateVolatilitySizing } from '../risk/volatilitySizingEngine.mjs';
import { cryptoFuturesNetPnl, cryptoFuturesSlippagePct, estimateFundingFeeUsd, getCryptoFuturesFeePct } from '../trading/costs.mjs';
import { evaluateSizingImpact, summarizeCounterfactual } from '../../src/core/volatilitySizingImpact.mjs';

const VERSION='volatility_sizing_impact_lab_v1_same_trades';
const OUT=process.argv.includes('--out')?process.argv[process.argv.indexOf('--out')+1]:'quant-evidence/volatility-sizing-impact-latest.json';
const FEE=getCryptoFuturesFeePct();
const FUNDING_RATE=Number(process.env.GENESIS_IMPACT_FUNDING_RATE||0.0001);
const DAYS=Math.max(30,Number(process.env.GENESIS_IMPACT_DAYS||90));
const MIN_HOLDOUT=Math.max(5,Number(process.env.GENESIS_IMPACT_MIN_HOLDOUT_TRADES||20));

const profiles=[
  {id:'short_micro',pairs:['BTCUSDT','ETHUSDT','SOLUSDT'],interval:'5m',side:'SHORT',signalFn:shortOnlyRegimeSwitchBreakoutSignal,breakoutPeriod:20,sma:200,targetPct:0.10,stopPct:0.03,timeoutHours:8,leverage:3,margin:180},
  {id:'short_core',pairs:['BTCUSDT','ETHUSDT','SOLUSDT'],interval:'1h',side:'SHORT',signalFn:shortOnlyRegimeSwitchBreakoutSignal,breakoutPeriod:34,sma:200,targetPct:0.10,stopPct:0.03,timeoutHours:36,leverage:5,margin:400},
  {id:'short_alt',pairs:['XRPUSDT','DOGEUSDT','SOLUSDT','BNBUSDT'],interval:'15m',side:'SHORT',signalFn:shortOnlyRegimeSwitchBreakoutSignal,breakoutPeriod:12,sma:200,targetPct:0.10,stopPct:0.03,timeoutHours:16,leverage:3,margin:240},
  {id:'long_probe',pairs:['BTCUSDT','ETHUSDT','SOLUSDT'],interval:'4h',side:'LONG',signalFn:longOnlyRegimeSwitchBreakoutSignal,breakoutPeriod:55,sma:200,targetPct:0.10,stopPct:0.03,timeoutHours:240,leverage:3,margin:260},
];

function intervalMinutes(tf){
  if(tf.endsWith('m')) return Number(tf.slice(0,-1));
  if(tf.endsWith('h')) return Number(tf.slice(0,-1))*60;
  return 1440;
}
function periodsPerYear(tf){ return 365*24*60/intervalMinutes(tf); }

function volumePrefix(klines){
  const q=klines.map(x=>Number(x[7])||0), p=[0];
  for(const x of q) p.push(p[p.length-1]+x);
  const bars=Math.max(1,Math.round(1440/intervalMinutes(String(klines._interval||'1h'))));
  return (i)=>{
    const start=Math.max(0,i-bars+1);
    const sum=p[i+1]-p[start];
    const span=i-start+1;
    return span>0?sum*(bars/span):0;
  };
}

function simulateSeries(klines, cfg){
  klines._interval=cfg.interval;
  const closesAll=klines.map(x=>Number(x[4]));
  const volumeAt=volumePrefix(klines);
  const trades=[];
  let pos=null;
  const warmup=Math.max(220,cfg.sma+5,cfg.breakoutPeriod+5);
  const timeoutMs=cfg.timeoutHours*3600000;

  for(let i=warmup;i<klines.length;i++){
    const c=klines[i], high=Number(c[2]), low=Number(c[3]), close=Number(c[4]), ts=Number(c[0]);
    if(pos){
      let exitPrice=null, exitReason=null;
      if(ts-pos.openTime>=timeoutMs){ exitPrice=close; exitReason='timeout'; }
      else if(pos.side==='LONG'){
        if(low<=pos.stop){exitPrice=pos.stop;exitReason='stop_loss';}
        else if(high>=pos.target){exitPrice=pos.target;exitReason='target_hit';}
      } else {
        if(high>=pos.stop){exitPrice=pos.stop;exitReason='stop_loss';}
        else if(low<=pos.target){exitPrice=pos.target;exitReason='target_hit';}
      }
      if(exitReason){
        const holdingHours=Math.max(1,(ts-pos.openTime)/3600000);
        const baseNotional=pos.baseMarginUsd*cfg.leverage;
        const sizedNotional=pos.sizedMarginUsd*cfg.leverage;
        const baseShares=baseNotional/pos.entryPrice;
        const sizedShares=sizedNotional/pos.entryPrice;
        const baseSlip=cryptoFuturesSlippagePct(baseNotional,pos.volume24hUsd);
        const sizedSlip=cryptoFuturesSlippagePct(sizedNotional,pos.volume24hUsd);
        const baseFunding=estimateFundingFeeUsd({notionalUsd:baseNotional,fundingRate:FUNDING_RATE,holdingHours});
        const sizedFunding=estimateFundingFeeUsd({notionalUsd:sizedNotional,fundingRate:FUNDING_RATE,holdingHours});
        trades.push({
          profile:cfg.id,pair:cfg.pair,interval:cfg.interval,side:pos.side,
          openTime:pos.openTime,closeTime:ts,entryPrice:pos.entryPrice,exitPrice,exitReason,holdingHours,
          model:pos.vol.model,regime:pos.vol.regime,volValidated:pos.vol.validated,
          sizeMultiplier:pos.multiplier,
          baselineMarginUsd:pos.baseMarginUsd,sizedMarginUsd:pos.sizedMarginUsd,
          baselinePnlUsd:cryptoFuturesNetPnl({side:pos.side,entryPrice:pos.entryPrice,exitPrice,shares:baseShares,feePct:FEE,slippagePct:baseSlip,fundingFeeUsd:baseFunding}),
          sizedPnlUsd:cryptoFuturesNetPnl({side:pos.side,entryPrice:pos.entryPrice,exitPrice,shares:sizedShares,feePct:FEE,slippagePct:sizedSlip,fundingFeeUsd:sizedFunding}),
        });
        pos=null;
      }
      continue;
    }

    const closes=closesAll.slice(Math.max(0,i-1000+1),i+1);
    const sig=cfg.signalFn({closes},{breakoutPeriod:cfg.breakoutPeriod,regimeSmaPeriod:cfg.sma});
    if(sig.action!=='TRADE') continue;

    const vol=evaluateVolatilitySizing(closes,{periodsPerYear:periodsPerYear(cfg.interval),minHistory:220,minHoldout:60,minMultiplier:0.25});
    const multiplier=Math.min(1,Math.max(0.25,vol.positionSizeMultiplier??1));
    const target=sig.side==='LONG'?close*(1+cfg.targetPct):close*(1-cfg.targetPct);
    const stop=sig.side==='LONG'?close*(1-cfg.stopPct):close*(1+cfg.stopPct);
    pos={
      side:sig.side,entryPrice:close,target,stop,openTime:ts,volume24hUsd:volumeAt(i),
      baseMarginUsd:cfg.margin,sizedMarginUsd:Number((cfg.margin*multiplier).toFixed(6)),multiplier,vol,
    };
  }
  return trades;
}

async function main(){
  const profileResults=[], allTrades=[], errors=[];
  for(const p of profiles){
    const profileTrades=[];
    for(const pair of p.pairs){
      try{
        const klines=await fetchKlines(pair,{days:DAYS,interval:p.interval});
        const trades=simulateSeries(klines,{...p,pair});
        profileTrades.push(...trades); allTrades.push(...trades);
      }catch(e){errors.push({profile:p.id,pair,interval:p.interval,error:String(e?.message||e)});}
    }
    profileTrades.sort((a,b)=>a.openTime-b.openTime);
    profileResults.push({
      profile:p.id,interval:p.interval,pairs:p.pairs,trades:profileTrades.length,
      avgMultiplier:profileTrades.length?Number((profileTrades.reduce((s,t)=>s+t.sizeMultiplier,0)/profileTrades.length).toFixed(6)):null,
      throttledTrades:profileTrades.filter(t=>t.sizeMultiplier<0.999999).length,
      impact:evaluateSizingImpact(profileTrades,{minHoldoutTrades:MIN_HOLDOUT}),
    });
  }
  allTrades.sort((a,b)=>a.openTime-b.openTime);
  const overall=evaluateSizingImpact(allTrades,{minHoldoutTrades:Math.max(30,MIN_HOLDOUT)});
  const output={
    ok:true,version:VERSION,generatedAt:new Date().toISOString(),mode:'COUNTERFACTUAL_PAPER_RESEARCH',
    methodology:{
      sameSignals:true,sameEntriesAndExits:true,onlySizingDiffers:true,
      historicalDays:DAYS,holdout:'last 30% of chronological trades',
      fees:'Genesis futures taker fee model',slippage:'Genesis futures size/volume model',
      funding:'same fixed funding assumption on both arms; not historical side-aware settlement',
      liveAuthority:false,
    },
    profiles:profileResults,overall,
    summary:{
      profilesEdgePreserved:profileResults.filter(x=>x.impact.classification==='EDGE_PRESERVED').length,
      profilesRiskImprovementOnly:profileResults.filter(x=>x.impact.classification==='RISK_IMPROVEMENT_ONLY').length,
      profilesRejected:profileResults.filter(x=>x.impact.classification==='REJECT').length,
      profilesInsufficient:profileResults.filter(x=>x.impact.classification==='INSUFFICIENT_EVIDENCE').length,
      totalTrades:allTrades.length,
      throttledTrades:allTrades.filter(t=>t.sizeMultiplier<0.999999).length,
      overallClassification:overall.classification,
    },
    overallBaseline:summarizeCounterfactual(allTrades),
    overallSized:summarizeCounterfactual(allTrades,'sizedPnlUsd','sizedMarginUsd'),
    errors,
    invariants:{paperOnly:true,liveEligible:false,executionAuthority:false,directionAuthority:false,canCreateSignals:false,canIncreaseSize:false},
  };
  await mkdir(dirname(OUT),{recursive:true}); await writeFile(OUT,JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify({version:VERSION,summary:output.summary,overall:output.overall,profiles:profileResults.map(x=>({profile:x.profile,trades:x.trades,avgMultiplier:x.avgMultiplier,throttled:x.throttledTrades,classification:x.impact.classification,eligible:x.impact.eligibleForPaperSizing,baseline:x.impact.baseline,sized:x.impact.sized,deltas:x.impact.deltas}))}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
