// volatilityNormalizedExit.mjs — research-only exit geometry from causal volatility forecasts.
//
// This module never creates signals and never grants capital authority.
// It converts a volatility forecast into a horizon-scaled stop/target so that
// 5m, 15m, 1h and 4h strategies are not forced to share the same 10%/3% geometry.

const finite=(x)=>Number.isFinite(Number(x))?Number(x):null;
const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));

export const VOL_EXIT_VERSION='volatility_normalized_exit_v1';

export function deriveVolatilityExit({
  forecastVolAnnualizedPct,
  periodsPerYear,
  intervalMinutes,
  timeoutHours,
  stopSigma=1,
  rewardRisk=2,
  minStopPct=0.003,
  maxStopPct=0.08,
  maxTargetPct=0.15,
}={}){
  const ann=finite(forecastVolAnnualizedPct);
  const ppy=finite(periodsPerYear);
  const mins=finite(intervalMinutes);
  const hours=finite(timeoutHours);
  const s=finite(stopSigma);
  const rr=finite(rewardRisk);
  if(!(ann>0)||!(ppy>0)||!(mins>0)||!(hours>0)||!(s>0)||!(rr>0)){
    return {ok:false,reason:'INVALID_VOL_EXIT_INPUT',stopPct:null,targetPct:null,horizonSigmaPct:null};
  }
  const sigmaBar=(ann/100)/Math.sqrt(ppy);
  const horizonBars=Math.max(1,(hours*60)/mins);
  const horizonSigma=sigmaBar*Math.sqrt(horizonBars);
  const stopPct=clamp(s*horizonSigma,minStopPct,maxStopPct);
  const targetPct=clamp(rr*stopPct,stopPct,maxTargetPct);
  return {
    ok:true,
    stopPct,
    targetPct,
    rewardRisk:targetPct/stopPct,
    stopSigma:s,
    requestedRewardRisk:rr,
    sigmaBarPct:sigmaBar,
    horizonBars,
    horizonSigmaPct:horizonSigma,
    caps:{minStopPct,maxStopPct,maxTargetPct},
    liveEligible:false,
    executionAuthority:false,
  };
}

export function exitVariantGrid(){
  const out=[];
  for(const stopSigma of [0.75,1,1.25,1.5]){
    for(const rewardRisk of [1.5,2,2.5,3]){
      out.push({id:`vol_s${String(stopSigma).replace('.','p')}_rr${String(rewardRisk).replace('.','p')}`,stopSigma,rewardRisk});
    }
  }
  return out;
}
