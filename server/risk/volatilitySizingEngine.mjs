// volatilitySizingEngine.mjs — Genesis volatility forecast competition + PAPER risk throttle.
//
// Extracted idea: volatility decides HOW MUCH, never WHICH WAY.
// Genesis improvements over the reference implementation:
//   - GARCH must compete OOS against EWMA and rolling realized variance.
//   - sizing can only reduce baseline risk (never lever up).
//   - no signal/direction authority, no execution authority.
//   - if evidence is weak, fail open to baseline size 1.0x rather than inventing precision.

export const VOLATILITY_SIZING_VERSION = 'genesis_volatility_sizing_v1_model_competition';

const EPS = 1e-12;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const finite = (x) => Number.isFinite(Number(x)) ? Number(x) : null;
const mean = (xs) => xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : null;
const variance = (xs) => {
  if (xs.length < 2) return null;
  const m = mean(xs);
  return xs.reduce((s,x)=>s+(x-m)**2,0)/(xs.length-1);
};
const median = (xs) => {
  const a = xs.filter(Number.isFinite).slice().sort((a,b)=>a-b);
  if (!a.length) return null;
  const i = Math.floor(a.length/2);
  return a.length%2 ? a[i] : (a[i-1]+a[i])/2;
};

export function logReturnsFromCloses(closes=[]) {
  const clean = closes.map(Number);
  const out=[];
  for(let i=1;i<clean.length;i++){
    if(clean[i]>0 && clean[i-1]>0) out.push(Math.log(clean[i]/clean[i-1]));
  }
  return out;
}

function qlike(realizedSq, forecastVar){
  const v=Math.max(EPS, forecastVar);
  return Math.log(v)+realizedSq/v;
}

function losses(realized, forecasts){
  const q=[], se=[];
  for(let i=0;i<Math.min(realized.length,forecasts.length);i++){
    const f=Math.max(EPS,forecasts[i]);
    const y=realized[i]**2;
    if(!Number.isFinite(y)||!Number.isFinite(f)) continue;
    q.push(qlike(y,f));
    se.push((y-f)**2);
  }
  return { samples:q.length, qlike:mean(q), mse:mean(se) };
}

function constantForecast(train, holdout){
  const v=Math.max(EPS, variance(train) ?? EPS);
  return holdout.map(()=>v);
}

function rollingForecast(train, holdout, window=20){
  const hist=train.slice();
  const out=[];
  for(const r of holdout){
    const sample=hist.slice(-Math.max(5,window));
    out.push(Math.max(EPS,variance(sample) ?? variance(train) ?? EPS));
    hist.push(r);
  }
  return out;
}

function ewmaTerminal(train, lambda=0.94){
  let v=Math.max(EPS,variance(train.slice(0,Math.min(60,train.length))) ?? variance(train) ?? EPS);
  for(const r of train) v=lambda*v+(1-lambda)*r*r;
  return v;
}

function ewmaForecast(train, holdout, lambda=0.94){
  let v=ewmaTerminal(train,lambda);
  const out=[];
  for(const r of holdout){
    out.push(Math.max(EPS,v));
    v=lambda*v+(1-lambda)*r*r;
  }
  return out;
}

function fitGarch(train){
  const mu=mean(train) ?? 0;
  const eps=train.map(r=>r-mu);
  const unc=Math.max(EPS,variance(eps) ?? EPS);
  const alphas=[0.03,0.05,0.08,0.10,0.12,0.15];
  const betas=[0.70,0.80,0.85,0.90,0.93,0.95];
  let best=null;
  for(const alpha of alphas){
    for(const beta of betas){
      if(alpha+beta>=0.995) continue;
      const omega=Math.max(EPS,(1-alpha-beta)*unc);
      let v=unc, total=0, n=0;
      for(let i=0;i<eps.length;i++){
        if(i>=20){ total+=qlike(eps[i]**2,v); n++; }
        v=omega+alpha*eps[i]**2+beta*v;
        if(!Number.isFinite(v)||v<=0){ n=0; break; }
      }
      if(!n) continue;
      const score=total/n;
      if(!best||score<best.trainQlike) best={mu,omega,alpha,beta,terminalVariance:Math.max(EPS,v),trainQlike:score};
    }
  }
  return best;
}

function garchForecast(train, holdout, fitted=null){
  const p=fitted??fitGarch(train);
  if(!p) return { forecasts:holdout.map(()=>Math.max(EPS,variance(train)??EPS)), params:null };
  let v=p.terminalVariance;
  const out=[];
  for(const r of holdout){
    out.push(Math.max(EPS,v));
    const e=r-p.mu;
    v=p.omega+p.alpha*e*e+p.beta*v;
  }
  return { forecasts:out, params:p };
}

function currentForecast(model, returns){
  if(model==='EWMA') return Math.max(EPS,ewmaTerminal(returns,0.94));
  if(model==='ROLLING_RV') return Math.max(EPS,variance(returns.slice(-20)) ?? variance(returns) ?? EPS);
  if(model==='GARCH_1_1'){
    const p=fitGarch(returns);
    return Math.max(EPS,p?.terminalVariance ?? variance(returns) ?? EPS);
  }
  return Math.max(EPS,variance(returns) ?? EPS);
}

function trailingRealizedSigmas(returns, window=20, lookback=200){
  const out=[];
  const start=Math.max(window,returns.length-lookback);
  for(let i=start;i<=returns.length;i++){
    const v=variance(returns.slice(i-window,i));
    if(v!=null&&v>0) out.push(Math.sqrt(v));
  }
  return out;
}

export function sizeFromForecast({forecastSigma,targetSigma,minMultiplier=0.25,maxMultiplier=1}={}){
  const f=finite(forecastSigma), t=finite(targetSigma);
  if(!(f>0)||!(t>0)) return { rawMultiplier:1, multiplier:1 };
  const raw=t/f;
  return { rawMultiplier:raw, multiplier:clamp(raw,minMultiplier,Math.min(1,maxMultiplier)) };
}

export function evaluateVolatilitySizing(closes=[], options={}){
  const minHistory=Math.max(120,Number(options.minHistory??220));
  const minHoldout=Math.max(30,Number(options.minHoldout??60));
  const minMultiplier=clamp(Number(options.minMultiplier??0.25),0.05,1);
  const periodsPerYear=Math.max(1,Number(options.periodsPerYear??365));
  const returns=logReturnsFromCloses(closes);
  const base={
    version:VOLATILITY_SIZING_VERSION,
    directionAuthority:false,
    executionAuthority:false,
    canIncreaseSize:false,
    liveEligible:false,
    paperRiskThrottleOnly:true,
  };
  if(returns.length<minHistory){
    return {...base,validated:false,applyThrottle:false,model:'NONE',reason:'INSUFFICIENT_HISTORY',samples:returns.length,holdoutSamples:0,positionSizeMultiplier:1,shadowMultiplier:1,regime:'unknown'};
  }

  const split=Math.max(80,Math.floor(returns.length*0.70));
  const train=returns.slice(0,split), holdout=returns.slice(split);
  const constant=constantForecast(train,holdout);
  const rolling=rollingForecast(train,holdout,20);
  const ewma=ewmaForecast(train,holdout,0.94);
  const gf=garchForecast(train,holdout);

  const models=[
    {model:'ROLLING_RV',...losses(holdout,rolling)},
    {model:'EWMA',...losses(holdout,ewma)},
    {model:'GARCH_1_1',...losses(holdout,gf.forecasts)},
  ].sort((a,b)=>(a.qlike??Infinity)-(b.qlike??Infinity));
  const baseline={model:'CONSTANT_VARIANCE',...losses(holdout,constant)};
  const best=models[0];
  const mseImprovement=baseline.mse>0&&best?.mse!=null ? (baseline.mse-best.mse)/baseline.mse : null;
  const qlikeImproves=best?.qlike!=null&&baseline.qlike!=null&&best.qlike<baseline.qlike;
  const validated=holdout.length>=minHoldout && (mseImprovement??-Infinity)>0 && qlikeImproves;

  const forecastVar=currentForecast(best?.model??'ROLLING_RV',returns);
  const forecastSigma=Math.sqrt(forecastVar);
  const trailing=trailingRealizedSigmas(returns,20,200);
  const targetSigma=median(trailing)??Math.sqrt(Math.max(EPS,variance(train)??EPS));
  const sizing=sizeFromForecast({forecastSigma,targetSigma,minMultiplier,maxMultiplier:1});
  const pct=trailing.length ? 100*trailing.filter(x=>x<forecastSigma).length/trailing.length : null;
  const regime=pct==null?'unknown':pct>=80?'storm':pct<=30?'calm':'normal';
  const appliedMultiplier=validated ? sizing.multiplier : 1;
  const applyThrottle=validated && appliedMultiplier<0.999999;
  const forecastVolAnnPct=forecastSigma*Math.sqrt(periodsPerYear)*100;
  const targetVolAnnPct=targetSigma*Math.sqrt(periodsPerYear)*100;
  const evidenceQuality=clamp(0.45+Math.min(0.25,holdout.length/1000)+Math.min(0.20,Math.max(0,mseImprovement??0)*2),0,0.95);

  return {
    ...base,
    validated,
    applyThrottle,
    reason:validated?(applyThrottle?'VALIDATED_VOL_THROTTLE':'VALIDATED_NO_REDUCTION_NEEDED'):'MODEL_COMPETITION_NOT_VALIDATED',
    model:best?.model??'NONE',
    samples:returns.length,
    trainSamples:train.length,
    holdoutSamples:holdout.length,
    forecastVolAnnualizedPct:Number(forecastVolAnnPct.toFixed(4)),
    targetVolAnnualizedPct:Number(targetVolAnnPct.toFixed(4)),
    forecastPercentile:pct==null?null:Number(pct.toFixed(2)),
    regime,
    rawMultiplier:Number(sizing.rawMultiplier.toFixed(6)),
    shadowMultiplier:Number(sizing.multiplier.toFixed(6)),
    positionSizeMultiplier:Number(appliedMultiplier.toFixed(6)),
    evidenceQuality:Number(evidenceQuality.toFixed(4)),
    baseline,
    modelCompetition:models,
    garchParams:gf.params?{
      alpha:Number(gf.params.alpha.toFixed(4)),
      beta:Number(gf.params.beta.toFixed(4)),
      omega:gf.params.omega,
      persistence:Number((gf.params.alpha+gf.params.beta).toFixed(4)),
    }:null,
    validation:{
      qlikeImproves,
      mseImprovementPct:mseImprovement==null?null:Number((mseImprovement*100).toFixed(3)),
      minHoldout,
      noLookaheadSplit:true,
    },
  };
}
