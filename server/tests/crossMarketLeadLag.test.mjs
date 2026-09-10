import test from 'node:test';
import assert from 'node:assert/strict';
import { alignBtcLeaderToAlt, evaluateCrossMarketLane } from '../research/runCrossMarketLeadLag.mjs';

function row(symbol, minute, { close=100, ret=10, taker=0.2, oi=0.2 }={}) {
  return {
    mode:'RESEARCH_ONLY', provider:'okx_public_market_data', schemaVersion:4, symbol,
    capturedAt:new Date(Date.UTC(2026,0,1,0,minute,0)).toISOString(),
    price:{close},
    positioning:{takerWindowMs:60000},
    crossCapture:{available:true,perpReturnBps:ret,takerBuySellRatioDelta:taker,oiChangePct:oi},
    provenance:{takerWindowMs:60000},
  };
}

function quality(symbol,count=30,extra={}){return {symbol,qualityPass:true,independentRowCount:count,...extra};}

test('aligns only a prior BTC leader observation to an alt label',()=>{
  const btc=[row('BTCUSDT',2),row('BTCUSDT',17),row('BTCUSDT',32)];
  const alt=[row('ETHUSDT',5,{close:100}),row('ETHUSDT',20,{close:101}),row('ETHUSDT',35,{close:102})];
  const out=alignBtcLeaderToAlt(btc,alt,{altSymbol:'ETHUSDT',maxLeaderAgeMinutes:8,maxAltForwardMinutes:30});
  assert.equal(out.samples.length,2);
  assert.equal(out.samples[0].leaderAgeMinutes,3);
  assert.ok(Date.parse(out.samples[0].leaderCapturedAt)<=Date.parse(out.samples[0].observedAt));
  assert.ok(Date.parse(out.samples[0].labelCapturedAt)>Date.parse(out.samples[0].observedAt));
});

test('rejects stale BTC leaders instead of carrying them forward',()=>{
  const btc=[row('BTCUSDT',0)];
  const alt=[row('SOLUSDT',10,{close:100}),row('SOLUSDT',25,{close:101})];
  const out=alignBtcLeaderToAlt(btc,alt,{altSymbol:'SOLUSDT',maxLeaderAgeMinutes:8});
  assert.equal(out.samples.length,0);
  assert.equal(out.rejectedLeaderAge,1);
});

test('fails closed until both leader and alt quality cohorts reach the fixed minimum',()=>{
  const out=evaluateCrossMarketLane({btcRows:[],altRows:[],btcQuality:quality('BTCUSDT',19),altQuality:quality('XRPUSDT',30),altSymbol:'XRPUSDT'});
  assert.equal(out.verdict,'DATA_NOT_READY');
  assert.equal(out.candidates.length,0);
  assert.equal(out.methodology.holdoutSealed,true);
  assert.equal(out.capitalEligible,false);
});

test('quality symbol mismatch fails closed',()=>{
  assert.throws(()=>evaluateCrossMarketLane({btcRows:[],altRows:[],btcQuality:quality('ETHUSDT'),altQuality:quality('SOLUSDT'),altSymbol:'SOLUSDT'}),/BTC_QUALITY_SYMBOL_MISMATCH/);
  assert.throws(()=>evaluateCrossMarketLane({btcRows:[],altRows:[],btcQuality:quality('BTCUSDT'),altQuality:quality('ETHUSDT'),altSymbol:'SOLUSDT'}),/ALT_QUALITY_SYMBOL_MISMATCH/);
});

test('never opens holdout or grants execution authority after enough aligned data',()=>{
  const btc=[]; const alt=[];
  for(let i=0;i<30;i++){
    const base=i*15;
    btc.push(row('BTCUSDT',base+2,{ret:12,taker:0.2,oi:0.2}));
    alt.push(row('BNBUSDT',base+5,{close:100+i}));
  }
  const out=evaluateCrossMarketLane({btcRows:btc,altRows:alt,btcQuality:quality('BTCUSDT',30),altQuality:quality('BNBUSDT',30),altSymbol:'BNBUSDT'});
  assert.ok(['NO_EDGE_FOUND','RESEARCH_CANDIDATE_FOUND'].includes(out.verdict));
  assert.equal(out.methodology.selectionUsesHoldout,false);
  assert.equal(out.methodology.holdoutSealed,true);
  assert.equal(out.methodology.causalPriorLeaderOnly,true);
  assert.equal(out.methodology.futureLeaderForbidden,true);
  assert.equal(out.methodology.symbolIsolation,true);
  assert.equal(out.methodology.activeQualityCohortsOnly,true);
  assert.equal(out.holdoutOpened,false);
  assert.equal(out.partitions.holdoutOpened,false);
  assert.equal(out.partitions.holdoutMetricsComputed,false);
  assert.ok(out.partitions.sealedHoldoutSamples>0);
  assert.equal(out.liveOrders,false);
  assert.equal(out.executionAuthority,false);
  assert.equal(out.capitalEligible,false);
});

test('unsupported alt symbols are rejected before study',()=>{
  assert.throws(()=>alignBtcLeaderToAlt([],[],{altSymbol:'DOGEUSDT'}),/UNSUPPORTED_ALT_SYMBOL/);
});

test('uses only active quality cohorts after historical resets',()=>{
  const btc=[]; const alt=[];
  for(let i=0;i<50;i++){
    const base=i*15;
    btc.push(row('BTCUSDT',base+2,{ret:i<20?-50:12,taker:i<20?-0.9:0.2,oi:0.2}));
    alt.push(row('ETHUSDT',base+5,{close:100+i}));
  }
  const btcStart=btc[20].capturedAt, altStart=alt[20].capturedAt;
  const out=evaluateCrossMarketLane({
    btcRows:btc,
    altRows:alt,
    btcQuality:quality('BTCUSDT',30,{firstEligibleCapturedAt:btcStart,lastEligibleCapturedAt:btc[49].capturedAt}),
    altQuality:quality('ETHUSDT',30,{firstEligibleCapturedAt:altStart,lastEligibleCapturedAt:alt[49].capturedAt}),
    altSymbol:'ETHUSDT',
  });
  assert.ok(['NO_EDGE_FOUND','RESEARCH_CANDIDATE_FOUND'].includes(out.verdict));
  assert.equal(out.methodology.activeQualityCohortsOnly,true);
  assert.equal(out.methodology.btcQualityCohortStart,btcStart);
  assert.equal(out.methodology.altQualityCohortStart,altStart);
  assert.equal(out.dataQuality.activeBtcRows,30);
  assert.equal(out.dataQuality.activeAltRows,30);
});
