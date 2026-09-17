import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { evaluateVolatilitySizing } from '../risk/volatilitySizingEngine.mjs';

const VERSION='volatility_sizing_lab_v1_model_competition';
const BASE=process.env.BINANCE_BASE||'https://data-api.binance.vision/api/v3';
const SYMBOLS=(process.env.GENESIS_VOL_SYMBOLS||'BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT,DOGEUSDT').split(',').map(x=>x.trim()).filter(Boolean);
const INTERVALS=(process.env.GENESIS_VOL_INTERVALS||'5m,15m,1h,4h').split(',').map(x=>x.trim()).filter(Boolean);
const OUT=process.argv.includes('--out')?process.argv[process.argv.indexOf('--out')+1]:'quant-evidence/volatility-sizing-lab-latest.json';
const PERIODS={ '5m':365*24*12, '15m':365*24*4, '1h':365*24, '4h':365*6, '1d':365 };

async function fetchCloses(symbol,interval){
  const url=new URL(BASE+'/klines');
  url.searchParams.set('symbol',symbol); url.searchParams.set('interval',interval); url.searchParams.set('limit','1000');
  const r=await fetch(url,{signal:AbortSignal.timeout(10000)});
  if(!r.ok) throw new Error('binance_'+r.status);
  const rows=await r.json();
  if(!Array.isArray(rows)||rows.length<100) throw new Error('invalid_klines');
  return rows.slice(0,-1).map(x=>Number(x[4])).filter(x=>x>0);
}

async function main(){
  const results=[], errors=[];
  for(const symbol of SYMBOLS){
    for(const interval of INTERVALS){
      try{
        const closes=await fetchCloses(symbol,interval);
        const analysis=evaluateVolatilitySizing(closes,{periodsPerYear:PERIODS[interval]??365,minHistory:220,minHoldout:60,minMultiplier:0.25});
        results.push({symbol,interval,...analysis});
      }catch(e){ errors.push({symbol,interval,error:String(e?.message||e)}); }
    }
  }
  results.sort((a,b)=>Number(b.applyThrottle)-Number(a.applyThrottle)||(b.forecastPercentile??-1)-(a.forecastPercentile??-1));
  const output={
    ok:true,version:VERSION,generatedAt:new Date().toISOString(),mode:'PAPER_RISK_RESEARCH',
    thesis:'Alpha decides whether to trade; validated volatility models may only reduce PAPER risk size.',
    tested:results.length,validatedCount:results.filter(x=>x.validated).length,throttledCount:results.filter(x=>x.applyThrottle).length,
    stormCount:results.filter(x=>x.regime==='storm').length,results,errors,
    invariants:{directionAuthority:false,executionAuthority:false,canIncreaseSize:false,liveEligible:false,signsTransactions:false,broadcastsTransactions:false},
  };
  await mkdir(dirname(OUT),{recursive:true}); await writeFile(OUT,JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify({version:VERSION,tested:output.tested,validated:output.validatedCount,throttled:output.throttledCount,storms:output.stormCount,top:results.slice(0,8).map(x=>({symbol:x.symbol,interval:x.interval,model:x.model,regime:x.regime,multiplier:x.positionSizeMultiplier,shadow:x.shadowMultiplier,validated:x.validated,mseImprovementPct:x.validation?.mseImprovementPct}))}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
