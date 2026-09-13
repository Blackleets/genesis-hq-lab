// fundingTrader.mjs — PAPER funding-rate arbitrage bot. Reads REAL Binance
// fundingRate data and simulates a delta-neutral spot/perp position that
// receives funding from the paying side.
//
// ZERO real orders by default (LIVE_MODE not set). PAPER equity changes only
// when a new real funding settlement timestamp is observed. There is no
// synthetic minute-by-minute funding accrual.
//
// Funding convention:
//   positive funding => longs pay shorts => SHORT perp / LONG spot receives
//   negative funding => shorts pay longs => LONG perp / SHORT spot receives
//
// Env: FT_PAIRS, FT_CAPITAL (10000), FT_SLEEP_MS (60000),
//      FT_MAX_DRAW (0.015 = 1.5%), FT_MINUTES (run length), LIVE_MODE (off)

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fundingSettlementPnl,
  sideForFunding,
} from './fundingSettlementMath.mjs';

const LIVE_MODE = process.env.LIVE_MODE === 'true';
const PAIRS = (process.env.FT_PAIRS || 'COTIUSDT,OGNUSDT,RIFUSDT,AUDIOUSDT,LUNAUSDT,STORJUSDT,FETUSDT,COMPUSDT,TRXUSDT,ATOMUSDT,INJUSDT,DOTUSDT,SANDUSDT,JSTUSDT,BNTUSDT,BCHUSDT,NEOUSDT,XLMUSDT,BNBUSDT,ZECUSDT,QTUMUSDT,ANKRUSDT,ONEUSDT,ZILUSDT,HOTUSDT,ONGUSDT,MTLUSDT,THETAUSDT,IOSTUSDT,CELRUSDT,ADAUSDT,AVAXUSDT,LINKUSDT,SOLUSDT,MATICUSDT,NEARUSDT,ALGOUSDT,GRTUSDT,CHZUSDT,ENJUSDT,FLOWUSDT,SXPUSDT,BATUSDT,KAVAUSDT,CRVUSDT,ICXUSDT,OMGUSDT,DUSKUSDT')
  .split(',').map(s => s.trim()).filter(Boolean);
const TOTAL_CAPITAL = Number(process.env.FT_CAPITAL || 10000);
const SLEEP_MS = Number(process.env.FT_SLEEP_MS || 60000);
const MAX_DRAW = Number(process.env.FT_MAX_DRAW || 0.015);
const RUN_MIN = Number(process.env.FT_MINUTES || 60);
const LOOP = process.env.FT_LOOP !== 'false';

const __dir = dirname(fileURLToPath(import.meta.url));
const EXEC_FILE = join(__dir, '..', '..', '..', 'data', 'executions.json');
const PUBLIC_FILE = join(__dir, '..', '..', '..', 'public', 'executions.json');
mkdirSync(dirname(EXEC_FILE), { recursive: true });
mkdirSync(dirname(PUBLIC_FILE), { recursive: true });

const state = {};
for (const p of PAIRS) {
  state[p] = {
    equity: TOTAL_CAPITAL / PAIRS.length,
    pos: null,
    peak: TOTAL_CAPITAL / PAIRS.length,
    lastFundingTime: 0,
    notional: 0,
  };
}

function loadExecutions() {
  try {
    return JSON.parse(readFileSync(EXEC_FILE, 'utf8'));
  } catch {
    return { mode: 'funding-paper', pairs: PAIRS.length, trades: [], updatedAt: 0 };
  }
}

function saveExecutions(obj) {
  writeFileSync(EXEC_FILE, JSON.stringify(obj, null, 2));
  try {
    writeFileSync(PUBLIC_FILE, JSON.stringify(obj, null, 2));
  } catch {}
}

function logEvent(pair, event, extra = {}) {
  const ex = loadExecutions();
  ex.trades.push({ t: Date.now(), pair, event, ...extra });
  if (ex.trades.length > 500) ex.trades = ex.trades.slice(-500);
  ex.updatedAt = Date.now();
  saveExecutions(ex);
}

// REAL Binance public funding history (no key). The latest row represents an
// actual funding settlement and carries a fundingTime that lets us deduplicate.
async function getFunding(pair) {
  const r = await fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${pair}&limit=2`);
  if (!r.ok) return { rate: 0, fundingTime: 0 };
  const rows = await r.json();
  const last = rows.length ? rows[rows.length - 1] : null;
  return {
    rate: last ? Number(last.fundingRate) : 0,
    fundingTime: last ? Number(last.fundingTime) : 0,
  };
}

async function cycle(cycleIdx) {
  let total = 0;
  let openCount = 0;
  const REBALANCE_CYCLES = Number(process.env.FT_REBALANCE || 5);
  const doRebalance = cycleIdx > 0 && cycleIdx % REBALANCE_CYCLES === 0;

  for (const pair of PAIRS) {
    const s = state[pair];
    try {
      const { rate, fundingTime } = await getFunding(pair);
      const want = sideForFunding(rate);
      const settled = fundingTime > 0 && fundingTime !== s.lastFundingTime;

      // Recognize PnL only at a new real settlement and against the side that
      // was actually held. If funding flipped against the held perp side, this
      // correctly records a loss instead of turning abs(rate) into fake profit.
      if (s.pos && settled) {
        const fundingPnl = fundingSettlementPnl({
          rate,
          notional: s.notional,
          side: s.pos,
        });
        if (Number.isFinite(fundingPnl)) {
          s.equity += fundingPnl;
          logEvent(pair, 'FUNDING', {
            side: s.pos,
            pnl: Number(fundingPnl.toFixed(4)),
            equity: Number(s.equity.toFixed(2)),
            rate: Number(rate.toFixed(8)),
            fundingTime,
            settlementOnly: true,
            live: false,
          });
        }
        s.lastFundingTime = fundingTime;
        s.peak = Math.max(s.peak, s.equity);

        if (s.peak > 0 && (s.peak - s.equity) / s.peak > MAX_DRAW) {
          logEvent(pair, 'PROTECT', {
            reason: `funding_drawdown>${MAX_DRAW * 100}%`,
            equity: Number(s.equity.toFixed(2)),
            live: false,
          });
          s.pos = null;
          s.notional = 0;
          s.peak = s.equity;
        }
      }

      // A rebalance changes PAPER position state only. It does not create PnL.
      if (doRebalance && s.pos) {
        logEvent(pair, 'FLAT', {
          reason: 'rebalance',
          equity: Number(s.equity.toFixed(2)),
          live: false,
        });
        s.pos = null;
        s.notional = 0;
      }

      if (want && want !== s.pos) {
        s.pos = want;
        s.notional = s.equity;
        // Do not collect the settlement that occurred before this PAPER
        // position existed. Start tracking from the latest known settlement.
        s.lastFundingTime = fundingTime;
        logEvent(pair, 'OPEN', {
          side: want,
          equity: Number(s.equity.toFixed(2)),
          rate: Number(rate.toFixed(8)),
          live: false,
        });
      } else if (!want && s.pos) {
        s.pos = null;
        s.notional = 0;
        s.lastFundingTime = fundingTime;
        logEvent(pair, 'FLAT', {
          reason: 'funding_below_entry_threshold',
          equity: Number(s.equity.toFixed(2)),
          live: false,
        });
      }
    } catch {
      // A provider failure cannot create PAPER PnL; keep previous state and
      // retry on the next bounded cycle.
    }

    total += s.equity;
    if (s.pos) openCount += 1;
  }

  console.log(
    `[${new Date().toISOString()}] funding-PAPER settlement-only eq $${Math.round(total * 100) / 100} `
    + `open ${openCount}/${PAIRS.length} (maxDraw ${MAX_DRAW * 100}%)${doRebalance ? ' [rebalanced]' : ''}`,
  );
  const ex = loadExecutions();
  ex.total = Number(total.toFixed(2));
  ex.updatedAt = Date.now();
  ex.pnlRecognition = 'real_funding_settlement_only';
  saveExecutions(ex);
}

async function main() {
  console.log(
    `\n=== FUNDING TRADER (mode=${LIVE_MODE ? 'LIVE' : 'PAPER'}) pairs=${PAIRS.length} `
    + `capital=$${TOTAL_CAPITAL} maxDraw=${MAX_DRAW * 100}% settlementOnly=true ===`,
  );
  saveExecutions({
    mode: 'funding-paper',
    pnlRecognition: 'real_funding_settlement_only',
    pairs: PAIRS.length,
    start: TOTAL_CAPITAL,
    trades: [],
    updatedAt: Date.now(),
  });

  const deadline = Date.now() + RUN_MIN * 60000;
  let cycleIdx = 0;
  while (LOOP && Date.now() < deadline) {
    await cycle(++cycleIdx);
    await new Promise(resolve => setTimeout(resolve, SLEEP_MS));
  }
  if (!LOOP) await cycle(++cycleIdx);
  console.log('Funding trader stopped.');
}

main().catch(error => {
  console.error('FATAL', error);
  process.exit(1);
});
