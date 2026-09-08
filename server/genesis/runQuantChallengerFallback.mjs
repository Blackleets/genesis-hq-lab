import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  ATR_PERIOD,
  ECONOMICS_GATE,
  EXIT_MODEL,
  TARGET_COST_MULTIPLE,
  adaptiveExitGeometry,
  candidateGrid,
  candidateId,
} from '../../supabase/functions/_shared/quant-challenger-core.mjs';

const ENGINE_VERSION = 'qcl_v2';
const RUNNER_VERSION = 'qcl_v2_github_fallback_v1';
const BINANCE_BASE = process.env.BINANCE_BASE || 'https://data-api.binance.vision/api/v3';
const CANDLE_LIMIT = 1000;
const TRAIN_END = 0.60;
const VALIDATION_END = 0.80;
const MIN_TRAIN_TRADES = 10;
const MIN_VALIDATION_TRADES = 5;
const MIN_HOLDOUT_TRADES = 5;

const PROFILES = [
  { id: 'short_micro', strategyId: 'futures_breakout_short_micro', parentVersionId: 'futures_breakout_short_micro:v8', pairs: ['BTCUSDT', 'ETHUSDT'], tf: '5m', lane: 'SHORT', basePeriod: 20, margin: 150, leverage: 3, baseTimeoutHours: 2 },
  { id: 'short_core', strategyId: 'futures_breakout_short_core', parentVersionId: 'futures_breakout_short_core:v8', pairs: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'], tf: '1h', lane: 'SHORT', basePeriod: 34, margin: 250, leverage: 5, baseTimeoutHours: 4 },
  { id: 'short_alt', strategyId: 'futures_breakout_short_alt', parentVersionId: 'futures_breakout_short_alt:v8', pairs: ['XRPUSDT', 'DOGEUSDT'], tf: '15m', lane: 'SHORT', basePeriod: 12, margin: 200, leverage: 3, baseTimeoutHours: 3 },
  { id: 'long_probe', strategyId: 'futures_breakout_long_probe', parentVersionId: 'futures_breakout_long_probe:v8', pairs: ['BTCUSDT', 'ETHUSDT'], tf: '4h', lane: 'LONG', basePeriod: 55, margin: 220, leverage: 3, baseTimeoutHours: 6 },
];

function round(value, digits = 4) { const scale = 10 ** digits; return Math.round(value * scale) / scale; }
function mean(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function std(values) { if (values.length < 2) return 0; const avg = mean(values); return Math.sqrt(values.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / (values.length - 1)); }
function tfMinutes(tf) { const match = tf.match(/^(\d+)([mhd])$/); if (!match) return 60; const value = Number(match[1]); return match[2] === 'm' ? value : match[2] === 'h' ? value * 60 : value * 1440; }
function quoteVolume(rows, endIndex) { return rows.slice(Math.max(0, endIndex - 5), endIndex + 1).reduce((sum, row) => sum + (Number(row?.[7]) || 0), 0); }
function slippagePct(orderSizeUsd, volumeUsd) { if (orderSizeUsd <= 0) return 0; if (volumeUsd <= 0) return 0.0008; const ratio = orderSizeUsd / volumeUsd; if (ratio < 0.0005) return 0.0001; if (ratio < 0.005) return 0.0003; return 0.0008; }

async function fetchKlines(pair, tf) {
  const response = await fetch(`${BINANCE_BASE}/klines?symbol=${encodeURIComponent(pair)}&interval=${encodeURIComponent(tf)}&limit=${CANDLE_LIMIT}`, { signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`binance_klines_${response.status}:${pair}:${tf}`);
  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length < 250) throw new Error(`binance_history_insufficient:${pair}:${tf}`);
  return rows;
}

function signalIndicesForPeriod(profile, rows, period) {
  const closes = rows.map((row) => Number(row?.[4]));
  const prefix = new Array(closes.length + 1).fill(0);
  for (let i = 0; i < closes.length; i++) prefix[i + 1] = prefix[i] + (Number.isFinite(closes[i]) ? closes[i] : 0);
  const indices = [];
  for (let i = Math.max(56, period); i < rows.length - 2; i++) {
    const last = closes[i];
    if (!Number.isFinite(last) || last <= 0) continue;
    let high = -Infinity, low = Infinity, valid = true;
    for (let j = i - period; j < i; j++) {
      const value = closes[j];
      if (!Number.isFinite(value)) { valid = false; break; }
      high = Math.max(high, value); low = Math.min(low, value);
    }
    if (!valid) continue;
    const sma55 = (prefix[i + 1] - prefix[i - 54]) / 55;
    const side = last > high ? 'LONG' : last < low ? 'SHORT' : null;
    if (!side || side !== profile.lane) continue;
    if ((side === 'LONG' && last <= sma55) || (side === 'SHORT' && last >= sma55)) continue;
    indices.push(i);
  }
  return indices;
}

function preparePair(profile, pair, rows, periods) {
  return { pair, rows, signalsByPeriod: Object.fromEntries(periods.map((period) => [String(period), signalIndicesForPeriod(profile, rows, period)])) };
}

function replayPrepared(profile, candidate, prepared) {
  const { pair, rows } = prepared;
  const signalIndices = prepared.signalsByPeriod[String(candidate.period)] ?? [];
  const trades = [];
  const minutes = tfMinutes(profile.tf);
  const timeoutBars = Math.max(1, Math.ceil((candidate.timeoutHours * 60) / minutes));
  const notional = profile.margin * profile.leverage;
  let lastExitIndex = -1;
  let skippedOverlap = 0, skippedInvalidMarketData = 0, skippedInvalidAtr = 0, skippedByEconomics = 0, evaluatedSignals = 0;
  let atrSum = 0, targetSum = 0, stopSum = 0, costSum = 0, ratioSum = 0;

  for (const i of signalIndices) {
    if (i <= lastExitIndex) { skippedOverlap++; continue; }
    const entryIndex = i + 1;
    const rawEntry = Number(rows[entryIndex]?.[1]);
    if (!Number.isFinite(rawEntry) || rawEntry <= 0) { skippedInvalidMarketData++; continue; }
    const entrySlip = slippagePct(notional, quoteVolume(rows, i));
    const geometry = adaptiveExitGeometry(rows, i, candidate, entrySlip);
    if (!geometry.valid || !Number.isFinite(geometry.atrPct) || !Number.isFinite(geometry.targetPct) || !Number.isFinite(geometry.stopPct) || !Number.isFinite(geometry.conservativeCostPct) || !Number.isFinite(geometry.targetCostRatio)) { skippedInvalidAtr++; continue; }
    evaluatedSignals++;
    atrSum += geometry.atrPct; targetSum += geometry.targetPct; stopSum += geometry.stopPct; costSum += geometry.conservativeCostPct; ratioSum += geometry.targetCostRatio;
    if (!geometry.economicsPass) { skippedByEconomics++; continue; }

    const side = profile.lane;
    const entry = side === 'LONG' ? rawEntry * (1 + entrySlip) : rawEntry * (1 - entrySlip);
    const shares = Math.floor((notional / entry) * 10000) / 10000;
    if (shares <= 0) { skippedInvalidMarketData++; continue; }
    const target = side === 'LONG' ? entry * (1 + geometry.targetPct) : entry * (1 - geometry.targetPct);
    const stop = side === 'LONG' ? entry * (1 - geometry.stopPct) : entry * (1 + geometry.stopPct);
    const maxExitIndex = Math.min(rows.length - 1, entryIndex + timeoutBars);
    let exitIndex = maxExitIndex, rawExit = Number(rows[maxExitIndex]?.[4]), exitReason = 'timeout';
    for (let j = entryIndex; j <= maxExitIndex; j++) {
      const high = Number(rows[j]?.[2]), low = Number(rows[j]?.[3]);
      if (![high, low].every(Number.isFinite)) continue;
      const stopHit = side === 'LONG' ? low <= stop : high >= stop;
      const targetHit = side === 'LONG' ? high >= target : low <= target;
      if (stopHit) { exitIndex = j; rawExit = stop; exitReason = 'stop_loss'; break; }
      if (targetHit) { exitIndex = j; rawExit = target; exitReason = 'take_profit'; break; }
    }
    if (!Number.isFinite(rawExit) || rawExit <= 0) { skippedInvalidMarketData++; continue; }
    const exitSlip = slippagePct(notional, quoteVolume(rows, exitIndex));
    const exit = side === 'LONG' ? rawExit * (1 - exitSlip) : rawExit * (1 + exitSlip);
    const gross = side === 'LONG' ? (exit - entry) * shares : (entry - exit) * shares;
    const fees = 0.0004 * (entry * shares + exit * shares);
    const heldHours = Math.max(minutes / 60, ((exitIndex - entryIndex + 1) * minutes) / 60);
    const fundingEstimate = notional * 0.0001 * heldHours / 8;
    trades.push({ pair, pnl: round(gross - fees - fundingEstimate, 4), openedAt: Number(rows[entryIndex]?.[0]), closedAt: Number(rows[exitIndex]?.[6] ?? rows[exitIndex]?.[0]), relativeIndex: entryIndex / rows.length, exitReason });
    lastExitIndex = exitIndex;
  }

  const economicsAccepted = Math.max(0, evaluatedSignals - skippedByEconomics);
  return { trades, diagnostics: {
    totalSignals: signalIndices.length, evaluatedSignals, simulatedTrades: trades.length, skippedOverlap, skippedInvalidMarketData, skippedInvalidAtr, skippedByEconomics, economicsAccepted,
    economicsAcceptanceRate: evaluatedSignals ? round(economicsAccepted / evaluatedSignals, 4) : null,
    signalSimulationRate: signalIndices.length ? round(trades.length / signalIndices.length, 4) : null,
    averageAtrPct: evaluatedSignals ? round(atrSum / evaluatedSignals, 6) : null,
    averageTargetPct: evaluatedSignals ? round(targetSum / evaluatedSignals, 6) : null,
    averageStopPct: evaluatedSignals ? round(stopSum / evaluatedSignals, 6) : null,
    averageConservativeCostPct: evaluatedSignals ? round(costSum / evaluatedSignals, 6) : null,
    averageTargetCostRatio: evaluatedSignals ? round(ratioSum / evaluatedSignals, 4) : null,
  }};
}

function mergeDiagnostics(items) {
  const totalSignals = items.reduce((s, x) => s + x.totalSignals, 0), evaluatedSignals = items.reduce((s, x) => s + x.evaluatedSignals, 0), simulatedTrades = items.reduce((s, x) => s + x.simulatedTrades, 0), economicsAccepted = items.reduce((s, x) => s + x.economicsAccepted, 0);
  const weighted = (field, digits) => evaluatedSignals ? round(items.reduce((s, x) => s + (Number(x[field] ?? 0) * x.evaluatedSignals), 0) / evaluatedSignals, digits) : null;
  return { totalSignals, evaluatedSignals, simulatedTrades, skippedOverlap: items.reduce((s,x)=>s+x.skippedOverlap,0), skippedInvalidMarketData: items.reduce((s,x)=>s+x.skippedInvalidMarketData,0), skippedInvalidAtr: items.reduce((s,x)=>s+x.skippedInvalidAtr,0), skippedByEconomics: items.reduce((s,x)=>s+x.skippedByEconomics,0), economicsAccepted, economicsAcceptanceRate: evaluatedSignals ? round(economicsAccepted/evaluatedSignals,4) : null, signalSimulationRate: totalSignals ? round(simulatedTrades/totalSignals,4) : null, averageAtrPct: weighted('averageAtrPct',6), averageTargetPct: weighted('averageTargetPct',6), averageStopPct: weighted('averageStopPct',6), averageConservativeCostPct: weighted('averageConservativeCostPct',6), averageTargetCostRatio: weighted('averageTargetCostRatio',4) };
}

function summarize(trades) {
  const ordered = [...trades].sort((a,b)=>a.closedAt-b.closedAt), pnl = ordered.map((t)=>t.pnl), wins=pnl.filter((x)=>x>0), losses=pnl.filter((x)=>x<0);
  const grossProfit=wins.reduce((s,x)=>s+x,0), grossLoss=Math.abs(losses.reduce((s,x)=>s+x,0)), realizedPnl=pnl.reduce((s,x)=>s+x,0), expectancy=pnl.length?realizedPnl/pnl.length:null, pnlStd=std(pnl), tStat=pnl.length>=2&&pnlStd>0&&expectancy!=null?expectancy/(pnlStd/Math.sqrt(pnl.length)):null;
  let curve=0,peak=0,maxDrawdown=0; for(const value of pnl){curve+=value;peak=Math.max(peak,curve);maxDrawdown=Math.max(maxDrawdown,peak-curve);}
  return { trades:pnl.length,wins:wins.length,losses:losses.length,winRate:pnl.length?round(wins.length/pnl.length,4):null,realizedPnl:round(realizedPnl,3),profitFactor:grossLoss>0?round(grossProfit/grossLoss,4):null,expectancy:expectancy==null?null:round(expectancy,4),maxDrawdownUsd:round(maxDrawdown,3),tStat:tStat==null?null:round(tStat,4) };
}
function robustScore(m,p){if(m.trades<3||m.expectancy==null)return-1e9;const pf=Math.min(m.profitFactor??0,4),t=Math.max(-4,Math.min(m.tStat??-4,4)),ev=Math.max(-3,Math.min(m.expectancy/Math.max(1,p.margin*.01),3)),dd=m.maxDrawdownUsd/Math.max(p.margin*p.pairs.length,1);return round((pf*2)+(t*.35)+ev-dd+Math.min(m.trades/40,1)*.3,6);}
const passTrain=(m)=>m.trades>=MIN_TRAIN_TRADES&&m.profitFactor!=null&&m.profitFactor>=1.05&&m.expectancy!=null&&m.expectancy>0;
const passValidation=(m)=>m.trades>=MIN_VALIDATION_TRADES&&m.profitFactor!=null&&m.profitFactor>=1.05&&m.expectancy!=null&&m.expectancy>0;
const passHoldout=(m)=>m.trades>=MIN_HOLDOUT_TRADES&&m.profitFactor!=null&&m.profitFactor>=1.1&&m.expectancy!=null&&m.expectancy>0;
function walkForward(trades){const dev=trades.filter((t)=>t.relativeIndex<VALIDATION_END),ranges=[[.2,.4],[.4,.6],[.6,.8]];const folds=ranges.map(([start,end],index)=>{const metrics=summarize(dev.filter((t)=>t.relativeIndex>=start&&t.relativeIndex<end));const pass=metrics.trades>=3&&metrics.profitFactor!=null&&metrics.profitFactor>=1&&metrics.expectancy!=null&&metrics.expectancy>0;return{fold:index+1,range:[start,end],pass,...metrics};});const positiveFolds=folds.filter((f)=>f.pass).length,forwardTrades=folds.reduce((s,f)=>s+f.trades,0);return{method:'fixed_candidate_3fold_before_holdout',positiveFolds,requiredPositiveFolds:2,forwardTrades,pass:forwardTrades>=12&&positiveFolds>=2,folds};}

async function evaluateProfile(profile) {
  const grid=candidateGrid(profile.basePeriod,profile.baseTimeoutHours), periods=[...new Set(grid.map((c)=>c.period))];
  const pairRows=await Promise.all(profile.pairs.map(async(pair)=>preparePair(profile,pair,await fetchKlines(pair,profile.tf),periods)));
  const ranking=grid.map((candidate)=>{const replays=pairRows.map((p)=>replayPrepared(profile,candidate,p)),trades=replays.flatMap((r)=>r.trades),diagnostics=mergeDiagnostics(replays.map((r)=>r.diagnostics)),train=summarize(trades.filter((t)=>t.relativeIndex<TRAIN_END));return{candidate,id:candidateId(profile.id,candidate),trades,diagnostics,train,trainPass:passTrain(train),trainScore:robustScore(train,profile)};}).sort((a,b)=>b.trainScore-a.trainScore);
  const shortlist=ranking.slice(0,10).map((item,index)=>{const validation=summarize(item.trades.filter((t)=>t.relativeIndex>=TRAIN_END&&t.relativeIndex<VALIDATION_END)),validationPass=item.trainPass&&passValidation(validation),wf=walkForward(item.trades);return{...item,trainRank:index+1,validation,validationPass,validationScore:robustScore(validation,profile),walkForward:wf};});
  const finalists=shortlist.filter((x)=>x.validationPass&&x.walkForward.pass).sort((a,b)=>b.validationScore-a.validationScore);
  const inspected=finalists.slice(0,5).map((item,index)=>{const holdout=summarize(item.trades.filter((t)=>t.relativeIndex>=VALIDATION_END)),holdoutPass=passHoldout(holdout);return{candidateId:item.id,params:item.candidate,trainRank:item.trainRank,validationRank:index+1,economics:item.diagnostics,train:item.train,validation:item.validation,walkForward:item.walkForward,holdout:{...holdout,pass:holdoutPass},survivor:holdoutPass};});
  const survivors=inspected.filter((x)=>x.survivor);
  return {profileId:profile.id,strategyId:profile.strategyId,parentVersionId:profile.parentVersionId,searchSpace:{candidateCount:grid.length,trainEnd:TRAIN_END,validationEnd:VALIDATION_END,holdoutStart:VALIDATION_END,holdoutUsedForRanking:false,exitModel:EXIT_MODEL,atrPeriod:ATR_PERIOD,economicsGate:ECONOMICS_GATE,targetCostMultiple:TARGET_COST_MULTIPLE,fixedPercentTargets:false},coverage:pairRows.map(({pair,rows})=>({pair,bars:rows.length,startAt:new Date(Number(rows[0]?.[0])).toISOString(),endAt:new Date(Number(rows.at(-1)?.[6]??rows.at(-1)?.[0])).toISOString()})),topTrain:ranking.slice(0,5).map((item,index)=>({rank:index+1,candidateId:item.id,params:item.candidate,economics:item.diagnostics,trainPass:item.trainPass,trainScore:item.trainScore,train:item.train})),finalists:inspected,survivorCount:survivors.length,winner:survivors[0]??null,status:survivors[0]?'SHADOW_CHALLENGER_FOUND':inspected.length?'FINALISTS_FAILED_HOLDOUT':'NO_ROBUST_FINALIST'};
}

function arg(name, fallback=null){const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]??fallback:fallback;}
const outPath=arg('--out','quant-evidence/qcl-v2-latest.json');
const historyPath=arg('--history',null);
const startedAt=new Date().toISOString();
const profiles={};
for(const profile of PROFILES){profiles[profile.id]=await evaluateProfile(profile);}
const completedAt=new Date().toISOString();
const payload={ok:true,engineVersion:ENGINE_VERSION,runnerVersion:RUNNER_VERSION,source:'github_actions_binance_public',mode:'RESEARCH_ONLY',executionAuthority:false,paperOnly:true,liveOrders:false,dataPolicy:'binance_spot_public_signal_reference_only',searchPolicy:{exitModel:EXIT_MODEL,atrPeriod:ATR_PERIOD,economicsGate:ECONOMICS_GATE,targetCostMultiple:TARGET_COST_MULTIPLE},antiOverfitPolicy:{train:'first_60pct',validation:'next_20pct',finalHoldout:'last_20pct',holdoutUsedForRanking:false},startedAt,completedAt,survivorCount:Object.values(profiles).reduce((s,p)=>s+p.survivorCount,0),profiles};
await mkdir(dirname(outPath),{recursive:true});
await writeFile(outPath,JSON.stringify(payload,null,2)+'\n','utf8');
if(historyPath){await mkdir(dirname(historyPath),{recursive:true});await appendFile(historyPath,JSON.stringify({engineVersion:ENGINE_VERSION,runnerVersion:RUNNER_VERSION,completedAt,survivorCount:payload.survivorCount,statuses:Object.fromEntries(Object.entries(profiles).map(([id,p])=>[id,p.status])),winners:Object.fromEntries(Object.entries(profiles).map(([id,p])=>[id,p.winner?{candidateId:p.winner.candidateId,params:p.winner.params,validation:p.winner.validation,holdout:p.winner.holdout}:null]))})+'\n','utf8');}
console.log(JSON.stringify({ok:true,engineVersion:ENGINE_VERSION,runnerVersion:RUNNER_VERSION,completedAt,survivorCount:payload.survivorCount,statuses:Object.fromEntries(Object.entries(profiles).map(([id,p])=>[id,p.status]))}));
