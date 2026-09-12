// server/genesis/healthCheck.mjs
// Real telemetry checker for the Genesis live paper-trading system.
//
// Usage:
//   node healthCheck.mjs --all    # full check: states + health.json + treasury + Binance feed
//   node healthCheck.mjs          # same as --all
//
// Prints a table: componente | status (OK/WARN/DOWN) | detalle
// Exit code: 0 if everything is OK/WARN, 1 if ANY component is DOWN (cron-friendly).
//
// Rules:
//   - live state file not updated for >2h  -> WARN; >24h -> DOWN
//   - data/health.json heartbeat stale     -> same WARN/DOWN thresholds on lastRunAt
//   - treasury state unreadable            -> DOWN
//   - fetchOHLCV against Binance fails     -> DOWN (feed)
//
// HONESTY: this reports what is actually on disk / reachable. No invented data.

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { fetchOHLCV } from './ccxtFeed.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const HEALTH_FILE = path.join(DATA_DIR, 'health.json');
const TREASURY_FILE = path.join(DATA_DIR, 'genesis_treasury_state.json');

const WARN_AGE_MS = 2 * 60 * 60 * 1000;   // 2h
const DOWN_AGE_MS = 24 * 60 * 60 * 1000;  // 24h

function ageMs(iso) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Date.now() - t : NaN;
}

function fmtAge(ms) {
  if (!Number.isFinite(ms)) return 'edad desconocida';
  if (ms < 0) ms = 0;
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60 ? ` ${m % 60}m` : ''}`;
}

function statusByAge(age) {
  if (!Number.isFinite(age)) return 'WARN'; // no timestamp at all
  if (age >= DOWN_AGE_MS) return 'DOWN';
  if (age >= WARN_AGE_MS) return 'WARN';
  return 'OK';
}

// Worst status wins: DOWN > WARN > OK.
function worst(statuses) {
  if (statuses.includes('DOWN')) return 'DOWN';
  if (statuses.includes('WARN')) return 'WARN';
  return 'OK';
}

/** Check one data/genesis_live_state_<PAIR>_<TF>.json file. */
function checkStateFile(fileName) {
  const component = fileName;
  let raw;
  try { raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, fileName), 'utf8')); }
  catch (e) {
    return { component, status: 'DOWN', detail: `ilegible: ${e.message}` };
  }
  const age = ageMs(raw.updatedAt);
  const status = statusByAge(age);
  const bits = [`ultimo run hace ${fmtAge(age)}`];
  if (Array.isArray(raw.trades)) bits.push(`trades=${raw.trades.length}`);
  if (Number.isFinite(raw.equity)) bits.push(`equity=${Number(raw.equity).toFixed(2)}`);
  if (raw.position) bits.push(`pos abierta ${raw.position.side || ''}`.trim());
  return { component, status, detail: bits.join(', ') };
}

/** Check the data/health.json heartbeat written by liveRunner. */
function checkHealthFile() {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(HEALTH_FILE, 'utf8')); }
  catch (e) {
    // Missing heartbeat on a fresh install is a warning, not a hard down.
    if (e.code === 'ENOENT') return { component: 'health.json', status: 'WARN', detail: 'sin heartbeat todavia (runner no ha corrido)' };
    return { component: 'health.json', status: 'DOWN', detail: `ilegible: ${e.message}` };
  }
  const age = ageMs(raw.lastRunAt);
  const status = statusByAge(age);
  const bits = [
    `heartbeat hace ${fmtAge(age)}`,
    raw.pair ? `${raw.pair}${raw.tf ? ` ${raw.tf}` : ''}` : null,
    Number.isFinite(raw.equity) ? `equity=${Number(raw.equity).toFixed(2)}` : null,
    typeof raw.openPosition === 'boolean' ? (raw.openPosition ? 'pos abierta' : 'flat') : null,
    `errores=${raw.errors24h ?? '?'}`,
  ].filter(Boolean);
  return { component: 'health.json', status, detail: bits.join(', ') };
}

/** Treasury must be readable JSON with a numeric paperBalanceUSDT. */
function checkTreasury() {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(TREASURY_FILE, 'utf8')); }
  catch (e) {
    return { component: 'treasury', status: 'DOWN', detail: `ilegible: ${e.message}` };
  }
  const bal = Number(raw.paperBalanceUSDT);
  if (!Number.isFinite(bal)) {
    return { component: 'treasury', status: 'DOWN', detail: 'paperBalanceUSDT ausente o no numerico' };
  }
  const reserved = Array.isArray(raw.reservations)
    ? raw.reservations.reduce((s, r) => s + (Number(r.amount) || 0), 0)
    : 0;
  return { component: 'treasury', status: 'OK', detail: `balance=${bal.toFixed(2)} reservado=${reserved.toFixed(2)} (${Array.isArray(raw.reservations) ? raw.reservations.length : 0})` };
}

/** One cheap Binance fetchOHLCV round trip. */
async function checkFeed(pair = 'BTCUSDT', tf = '1h') {
  const t0 = Date.now();
  try {
    const candles = await fetchOHLCV(pair, tf, 5);
    if (!Array.isArray(candles) || candles.length === 0) {
      return { component: 'feed binance', status: 'DOWN', detail: `fetchOHLCV sin velas (${pair} ${tf})` };
    }
    const last = candles[candles.length - 1];
    // ccxt candle: [msOpen, o, h, l, c, v]; age measured from candle OPEN + tf window.
    const tfMs = tf.endsWith('m') ? parseInt(tf, 10) * 60000
      : tf.endsWith('h') ? parseInt(tf, 10) * 3600000
      : tf.endsWith('d') ? parseInt(tf, 10) * 86400000
      : 3600000;
    const lastTs = Number.isFinite(last?.[0]) ? last[0] + tfMs : NaN;
    const candleAge = Number.isFinite(lastTs) ? Date.now() - lastTs : NaN;
    const lat = Date.now() - t0;
    const bits = [`${candles.length} velas ${pair} ${tf}`, `ultima cierra hace ${fmtAge(candleAge)}`, `${lat}ms`];
    // Stale candles on a healthy HTTP call are suspicious but not fatal here;
    // the per-state checks already cover staleness of the trading loop.
    const status = Number.isFinite(candleAge) && candleAge >= DOWN_AGE_MS ? 'WARN' : 'OK';
    return { component: 'feed binance', status, detail: bits.join(', ') };
  } catch (e) {
    return { component: 'feed binance', status: 'DOWN', detail: `fetchOHLCV fallo: ${e.message}` };
  }
}

/**
 * Run every check and return the rows plus the aggregate exit code.
 * Exported so liveRunner.mjs can re-export the same logic (`--health`).
 */
export async function runHealthCheck({ pair, tf } = {}) {
  const rows = [];

  let stateFiles = [];
  try {
    stateFiles = fs.readdirSync(DATA_DIR)
      .filter(f => /^genesis_live_state_.+\.json$/.test(f))
      .sort();
  } catch { /* DATA_DIR missing -> zero state rows */ }

  if (stateFiles.length === 0) {
    rows.push({ component: 'live states', status: 'WARN', detail: 'ningun data/genesis_live_state_*.json encontrado' });
  } else {
    for (const f of stateFiles) rows.push(checkStateFile(f));
  }

  rows.push(checkHealthFile());
  rows.push(checkTreasury());
  rows.push(await checkFeed(pair, tf));

  const global = worst(rows.map(r => r.status));
  return { rows, global };
}

function printTable(rows) {
  const w = (arr, pad) => Math.max(...arr.map(s => s.length)) + pad;
  const cw = w(rows.map(r => r.component).concat('COMPONENTE'), 2);
  const sw = w(rows.map(r => r.status).concat('STATUS'), 2);
  const line = '-'.repeat(cw + sw + 30);
  console.log(`${'COMPONENTE'.padEnd(cw)}${'STATUS'.padEnd(sw)}DETALLE`);
  console.log(line);
  for (const r of rows) {
    console.log(`${r.component.padEnd(cw)}${r.status.padEnd(sw)}${r.detail}`);
  }
  console.log(line);
  console.log(`GLOBAL: ${globalOf(rows)}`);
}

function globalOf(rows) {
  if (rows.some(r => r.status === 'DOWN')) return 'DOWN';
  if (rows.some(r => r.status === 'WARN')) return 'WARN';
  return 'OK';
}

async function main() {
  const { rows, global } = await runHealthCheck({
    pair: process.env.GENESIS_PAIR || undefined,
    tf: process.env.GENESIS_TF || undefined,
  });
  printTable(rows);
  process.exit(global === 'DOWN' ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(url.fileURLToPath(import.meta.url))) {
  main().catch(e => { console.error('FATAL', e); process.exit(1); });
}
