// volatilitySizingImpact.mjs — pure counterfactual evaluation helpers.
//
// Rule: sizing is not alpha. It can preserve edge, improve risk, or be rejected.
// A losing strategy that merely loses less is classified as RISK_IMPROVEMENT_ONLY,
// never as profitable edge.

const finite = (x) => Number.isFinite(Number(x)) ? Number(x) : null;
const mean = (xs) => xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : null;
const std = (xs) => {
  if (xs.length < 2) return null;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s,x)=>s+(x-m)**2,0)/(xs.length-1));
};

export function summarizeCounterfactual(trades=[], pnlKey='baselinePnlUsd', capitalKey='baselineMarginUsd'){
  const rows = trades.filter(t => finite(t?.[pnlKey]) != null && finite(t?.[capitalKey]) > 0);
  const pnls = rows.map(t=>Number(t[pnlKey]));
  const rets = rows.map(t=>Number(t[pnlKey]) / Number(t[capitalKey]) * 10000);
  let eq=0, peak=0, maxDd=0, grossProfit=0, grossLoss=0;
  for(const p of pnls){
    eq += p;
    if(eq > peak) peak = eq;
    maxDd = Math.max(maxDd, peak - eq);
    if(p>0) grossProfit += p;
    else if(p<0) grossLoss += Math.abs(p);
  }
  const s=std(rets);
  const downside=rets.map(r=>Math.min(0,r));
  const downsideDev=Math.sqrt(mean(downside.map(x=>x*x)) ?? 0);
  return {
    trades: rows.length,
    totalPnlUsd: Number(pnls.reduce((a,b)=>a+b,0).toFixed(4)),
    expectancyUsd: rows.length ? Number((mean(pnls)??0).toFixed(4)) : null,
    expectancyBps: rows.length ? Number((mean(rets)??0).toFixed(4)) : null,
    profitFactor: grossLoss > 0 ? Number((grossProfit/grossLoss).toFixed(6)) : (grossProfit>0 ? 99 : null),
    winRate: rows.length ? Number((pnls.filter(x=>x>0).length/rows.length).toFixed(6)) : null,
    maxDrawdownUsd: Number(maxDd.toFixed(4)),
    tradeSharpe: s && s > 0 ? Number(((mean(rets)/s)*Math.sqrt(rows.length)).toFixed(6)) : null,
    downsideDeviationBps: Number(downsideDev.toFixed(4)),
    avgMarginUsd: rows.length ? Number((mean(rows.map(t=>Number(t[capitalKey])))??0).toFixed(4)) : null,
  };
}

export function evaluateSizingImpact(trades=[], options={}){
  const minHoldoutTrades = Math.max(5, Number(options.minHoldoutTrades ?? 20));
  if(!Array.isArray(trades) || trades.length===0){
    return {
      classification:'INSUFFICIENT_EVIDENCE', eligibleForPaperSizing:false,
      reason:'NO_TRADES', holdoutTrades:0, baseline:summarizeCounterfactual([]), sized:summarizeCounterfactual([], 'sizedPnlUsd','sizedMarginUsd')
    };
  }
  const split=Math.max(1,Math.min(trades.length-1,Math.floor(trades.length*0.70)));
  const train=trades.slice(0,split);
  const holdout=trades.slice(split);
  const baseline=summarizeCounterfactual(holdout);
  const sized=summarizeCounterfactual(holdout,'sizedPnlUsd','sizedMarginUsd');
  const trainBase=summarizeCounterfactual(train);
  const trainSized=summarizeCounterfactual(train,'sizedPnlUsd','sizedMarginUsd');

  const ddImproved = baseline.maxDrawdownUsd > 0
    ? sized.maxDrawdownUsd < baseline.maxDrawdownUsd
    : sized.maxDrawdownUsd <= baseline.maxDrawdownUsd;
  const downsideImproved = sized.downsideDeviationBps < baseline.downsideDeviationBps;
  const sharpeImproved = sized.tradeSharpe != null && baseline.tradeSharpe != null
    ? sized.tradeSharpe >= baseline.tradeSharpe
    : null;
  const pnlRetention = baseline.totalPnlUsd > 0 ? sized.totalPnlUsd / baseline.totalPnlUsd : null;
  const lossReductionPct = baseline.totalPnlUsd < 0 && sized.totalPnlUsd > baseline.totalPnlUsd
    ? 100 * (Math.abs(baseline.totalPnlUsd)-Math.abs(sized.totalPnlUsd))/Math.abs(baseline.totalPnlUsd)
    : null;

  let classification='REJECT';
  let eligibleForPaperSizing=false;
  let reason='RISK_ADJUSTED_IMPROVEMENT_NOT_PROVEN';

  if(holdout.length < minHoldoutTrades){
    classification='INSUFFICIENT_EVIDENCE';
    reason=`HOLDOUT_TRADES_${holdout.length}_LT_${minHoldoutTrades}`;
  } else if((baseline.expectancyBps??0) > 0){
    const preserved=(sized.expectancyBps??-Infinity)>0 && (pnlRetention??0)>=0.80;
    const riskBetter=ddImproved && downsideImproved && sharpeImproved===true;
    if(preserved && riskBetter){
      classification='EDGE_PRESERVED';
      eligibleForPaperSizing=true;
      reason='POSITIVE_BASELINE_EDGE_PRESERVED_WITH_BETTER_HOLDOUT_RISK';
    }
  } else if((sized.totalPnlUsd??-Infinity) > (baseline.totalPnlUsd??Infinity) && ddImproved && downsideImproved){
    classification='RISK_IMPROVEMENT_ONLY';
    reason='LOSING_BASELINE_LOSES_LESS_BUT_NO_EDGE_CLAIM';
  }

  return {
    classification, eligibleForPaperSizing, reason,
    holdoutTrades:holdout.length,
    train:{baseline:trainBase,sized:trainSized},
    baseline, sized,
    deltas:{
      totalPnlUsd:Number((sized.totalPnlUsd-baseline.totalPnlUsd).toFixed(4)),
      expectancyBps: baseline.expectancyBps!=null&&sized.expectancyBps!=null ? Number((sized.expectancyBps-baseline.expectancyBps).toFixed(4)) : null,
      maxDrawdownUsd:Number((sized.maxDrawdownUsd-baseline.maxDrawdownUsd).toFixed(4)),
      downsideDeviationBps:Number((sized.downsideDeviationBps-baseline.downsideDeviationBps).toFixed(4)),
      tradeSharpe: baseline.tradeSharpe!=null&&sized.tradeSharpe!=null ? Number((sized.tradeSharpe-baseline.tradeSharpe).toFixed(6)) : null,
      pnlRetention: pnlRetention==null?null:Number(pnlRetention.toFixed(6)),
      lossReductionPct: lossReductionPct==null?null:Number(lossReductionPct.toFixed(3)),
    },
    checks:{ddImproved,downsideImproved,sharpeImproved,pnlRetention80:pnlRetention==null?null:pnlRetention>=0.80},
    invariants:{sameTrades:true,sizingIsNotAlpha:true,liveEligible:false,executionAuthority:false},
  };
}
