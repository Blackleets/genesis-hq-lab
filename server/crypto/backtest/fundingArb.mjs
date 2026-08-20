// fundingArb.mjs — HONEST validation of a funding-rate arbitrage edge on REAL
// Binance data (no key needed). Strategy: hold a spot/futures delta-neutral
// position and collect funding when it is extreme. We measure the realized
// funding PnL (minus taker costs) of a simple rule:
//   - if next funding > +THR  -> be SHORT perp / LONG spot (collect negative funding)
//   - if next funding < -THR  -> be LONG perp / SHORT spot (collect positive funding)
//   - otherwise flat.
// Funding is paid every 8h. We use the published fundingRate history (REAL).
// This is a statistical check, not a live executor. Output to stdout + HUNT_OUT.

import { readFileSync, appendFileSync } from 'node:fs';

const UNIVERSE_FILE = process.argv[2] || 'server/crypto/backtest/pairs_universe.txt';
const MAX_PAIRS = Number(process.argv[3] || 120);
const BOT_ID = process.env.BOT_ID || 'FARB';
const OUT_FILE = process.env.HUNT_OUT || 'fund_winners.jsonl';
const N = Number(process.env.FARB_N || 500); // funding samples per pair (~166 days @8h)
const THR = Number(process.env.FARB_THR || 0.0005); // 0.05% funding threshold to act
const COST = 0.0004; // taker round-trip per entry+exit (~0.04%/side)

// Fetch REAL funding history for a symbol.
async function fetchFunding(symbol, limit){
  const r=await fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=${limit}`);
  if(!r.ok) throw new Error('http'+r.status);
  const k=await r.json();
  return k.map(x=>({ts:+x.fundingTime, fr:+x.fundingRate}));
}

// Simulate collecting funding when |rate| > THR, holding neutral and paying
// the funding in our favor. Position only flips when the desired side changes
// (funding sign flips), so rebalance cost is rare and realistic.
function backtest(funds){
  let pos=0; // +1 = long perp/short spot (receives when funding<0); -1 = short perp/long spot (receives when funding>0)
  const per=[];
  for(let i=0;i<funds.length;i++){
    const fr=funds[i].fr;
    // desired position: receive funding => take side opposite to sign of fr
    const want = fr> THR ? -1 : fr < -THR ? +1 : (fr===0?pos:pos);
    let step=0;
    if(want!==pos){ if(pos!==0) step-=COST; if(want!==0) step-=COST; pos=want; }
    if(pos!==0) step += (-pos)*fr; // receive = -pos*fr
    per.push(step);
  }
  const total=per.reduce((s,r)=>s+r,0);
  return {per, total};
}

function metrics(per){
  const t=per.length, w=per.filter(r=>r>0).length;
  const gw=per.filter(r=>r>0).reduce((s,r)=>s+r,0), gl=Math.abs(per.filter(r=>r<0).reduce((s,r)=>s+r,0));
  const wr=t?w/t:0, pf=gl>0?gw/gl:gw>0?3:0;
  const mean=t?per.reduce((s,r)=>s+r,0)/t:0, sd=Math.sqrt(t?per.reduce((s,r)=>s+(r-mean)**2,0)/t:0);
  const sh=sd>0?mean/sd:0, ts=sh*Math.sqrt(t), ep=mean*100;
  return {t,wr,pf,ep,ts};
}
const GATES={minT:50,minWR:0.45,minPF:1.2,minEP:0.001,minTS:2.0};
function passes(m){ return m.t>=GATES.minT && m.wr>=GATES.minWR && m.pf>=GATES.minPF && m.ep>GATES.minEP && m.ts>=GATES.minTS; }

async function main(){
  const pairs=readFileSync(UNIVERSE_FILE,'utf8').trim().split('\n').slice(0,MAX_PAIRS);
  let tested=0, passed=0;
  for(const pair of pairs){
    let funds;
    try{ funds=await fetchFunding(pair,N); }catch(e){ continue; }
    if(funds.length<N*0.5) continue;
    tested++;
    const {per,total}=backtest(funds);
    const m=metrics(per);
    const row={bot:BOT_ID,pair,t:m.t,wr:+(m.wr*100).toFixed(1),pf:+m.pf.toFixed(2),ep:+(m.ep*100).toFixed(4),ts:+m.ts.toFixed(2),totalPct:+(total*100).toFixed(2),thr:THR};
    if(passes(m)){
      passed++;
      console.log(JSON.stringify(row));
      try{ appendFileSync(OUT_FILE, JSON.stringify(row)+'\n'); }catch{}
    }
  }
  console.error(`[${BOT_ID}] done: tested=${tested} passed=${passed}`);
}
main().catch(e=>{console.error('FATAL',e);process.exit(1);});
