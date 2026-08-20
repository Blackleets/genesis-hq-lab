// basketScanBatch.mjs — same as basketScan but takes PAIRS/INTERVALS from env
// so we can run in bounded foreground batches. Reuses REAL fetchKlines.
import { fetchKlines } from './historicalData.mjs';
import { computeMetrics } from './metrics.mjs';
import { calculateBollingerBands as bollinger, calculateRsi as rsi, calculateAdx as adx } from '../technicalIndicators.mjs';

const PAIRS = (process.env.B_PAIRS || 'SOLUSDT').split(',');
const INTERVALS = (process.env.B_IV || '4h').split(',');
const DAYS = Number(process.env.B_DAYS || 400);
const STOP_PCT = 0.005, R_MULT = 2.2, RISK_PCT = 1.0;
const Pgrid = (() => { const g=[]; for (const bbPeriod of [20,22]) for (const bbStd of [1.8,2.0,2.2]) for (const rsiOS of [28,30,32]) for (const rsiOB of [68,70,72]) for (const adxMax of [22,25,28,999]) g.push({bbPeriod,bbStd,rsiPeriod:14,rsiOS,rsiOB,adxMax,adxPeriod:14}); return g; })();

function signalsFor(closes,highs,lows,P){const n=closes.length,out=new Array(n).fill(null),warm=Math.max(P.bbPeriod,P.adxPeriod)+2;for(let i=warm;i<n;i++){const sC=closes.slice(0,i+1),sH=highs.slice(0,i+1),sL=lows.slice(0,i+1),bb=bollinger(sC,P.bbPeriod,P.bbStd),r=rsi(sC,P.rsiPeriod),a=adx(sH,sL,sC,P.adxPeriod),price=closes[i];if(a>P.adxMax)continue;if(price<=bb.lower&&r<=P.rsiOS)out[i]='LONG';else if(price>=bb.upper&&r>=P.rsiOB)out[i]='SHORT';}return out;}
function bt(klines,P){const closes=klines.map(k=>+k[4]),highs=klines.map(k=>+k[2]),lows=klines.map(k=>+k[3]),sig=signalsFor(closes,highs,lows,P);let eq=1e4,pos=null;const trades=[];for(let i=0;i<sig.length;i++){const hi=highs[i],lo=lows[i],price=closes[i];if(pos){const tp=pos.side==='LONG'?hi>=pos.tp:lo<=pos.tp,sl=pos.side==='LONG'?lo<=pos.sl:hi>=pos.sl;if(tp){const pnl=(pos.side==='LONG'?pos.tp-pos.entry:pos.entry-pos.tp)*pos.units;eq+=pnl;trades.push({pnl});pos=null;}else if(sl){const pnl=(pos.side==='LONG'?pos.sl-pos.entry:pos.entry-pos.sl)*pos.units;eq+=pnl;trades.push({pnl});pos=null;}}if(!pos&&sig[i]){const sd=price*STOP_PCT,units=(eq*(RISK_PCT/100))/sd,side=sig[i];pos={side,entry:price,sl:side==='LONG'?price-sd:price+sd,tp:side==='LONG'?price+sd*R_MULT:price-sd*R_MULT,units};}}return trades;}
function bestOOS(klines){const split=Math.floor(klines.length*0.6),kIS=klines.slice(0,split),kOOS=klines.slice(split);let best=null;for(const P of Pgrid){const isT=bt(kIS,P),m=computeMetrics(isT);if(m.trades>=15&&(best===null||m.expectancy>best.exp))best={P,exp:m.expectancy};}if(!best)return null;const oosT=bt(kOOS,best.P),m=computeMetrics(oosT);return{P:best.P,m};}

const passed=[];
for(const pair of PAIRS)for(const iv of INTERVALS){try{const k=await fetchKlines(pair,{days:DAYS,interval:iv});if(k.length<200)continue;const res=bestOOS(k);if(!res)continue;const m=res.m;const ok=m.trades>=30&&m.expectancy>0&&m.profitFactor>=1.2;if(ok){passed.push({pair,iv,trades:m.trades,exp:+m.expectancy.toFixed(0),pf:+m.profitFactor.toFixed(2),dd:+(m.maxDrawdown*100).toFixed(1)});console.log(`PASS ${pair.padEnd(9)} ${iv.padEnd(3)} t ${String(m.trades).padStart(3)} WR ${String(Math.round(m.winRate*100)).padStart(2)}% exp $${m.expectancy.toFixed(0).padStart(4)} PF ${m.profitFactor.toFixed(2)} DD ${(m.maxDrawdown*100).toFixed(1)}%`);}}catch(e){}}
console.log(`\nBATCH DONE. passed=${passed.length}`);
console.log(JSON.stringify(passed));
