// memoryStore — persistent JSON-file memory for Genesis HQ agents.
// All agent knowledge lives here: trades, lessons, capital, agent stats.
// No database required. Files live in data/memory/.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const MEMORY_DIR = join(__dir, '..', 'data', 'memory');

async function ensureDir() {
  if (!existsSync(MEMORY_DIR)) await mkdir(MEMORY_DIR, { recursive: true });
}

async function read(filename, fallback) {
  await ensureDir();
  const path = join(MEMORY_DIR, filename);
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function write(filename, data) {
  await ensureDir();
  await writeFile(join(MEMORY_DIR, filename), JSON.stringify(data, null, 2), 'utf8');
}

// ─── Capital ──────────────────────────────────────────────────────────────────

export async function getCapital() {
  return read('capital.json', {
    total: 10000,
    available: 10000,
    inTrades: 0,
    reserve: 0,
    history: [],
    // Reinvestment buckets (Regla #6)
    buckets: {
      reserve:      0,   // 40%
      agentUpgrade: 0,   // 25%
      experiments:  0,   // 15%
      expansion:    0,   // 10%
      liquidity:    0,   // 10%
    },
  });
}

export async function saveCapital(capital) {
  await write('capital.json', capital);
}

export async function allocateGain(pnl) {
  if (pnl <= 0) return;
  const capital = await getCapital();
  capital.buckets.reserve      += pnl * 0.40;
  capital.buckets.agentUpgrade += pnl * 0.25;
  capital.buckets.experiments  += pnl * 0.15;
  capital.buckets.expansion    += pnl * 0.10;
  capital.buckets.liquidity    += pnl * 0.10;
  capital.total += pnl;
  capital.available += pnl;
  capital.history.push({ at: new Date().toISOString(), pnl, total: capital.total });
  if (capital.history.length > 200) capital.history = capital.history.slice(-200);
  await saveCapital(capital);
  return capital;
}

// ─── Trades ───────────────────────────────────────────────────────────────────

export async function getTrades() {
  return read('trades.json', []);
}

export async function saveTrade(trade) {
  const trades = await getTrades();
  const idx = trades.findIndex(t => t.id === trade.id);
  if (idx >= 0) trades[idx] = trade;
  else trades.push(trade);
  await write('trades.json', trades);
  return trade;
}

export async function getOpenTrades() {
  const trades = await getTrades();
  return trades.filter(t => t.status === 'open');
}

export async function closeTrade(tradeId, resolvedOutcome, currentPrice) {
  const trades = await getTrades();
  const trade = trades.find(t => t.id === tradeId);
  if (!trade) return null;

  const won = trade.outcome === resolvedOutcome;
  const exitPrice = won ? 1.0 : 0.0;
  const pnl = (exitPrice - trade.entryPrice) * trade.shares;

  trade.status = 'closed';
  trade.resolvedOutcome = resolvedOutcome;
  trade.exitPrice = exitPrice;
  trade.pnl = pnl;
  trade.closedAt = new Date().toISOString();

  await write('trades.json', trades);
  if (pnl > 0) await allocateGain(pnl);
  return trade;
}

// ─── Lessons ──────────────────────────────────────────────────────────────────

export async function getLessons() {
  return read('lessons.json', []);
}

export async function getRecentLessons(n = 10) {
  const lessons = await getLessons();
  return lessons.slice(-n);
}

export async function saveLesson(lesson) {
  const lessons = await getLessons();
  lessons.push({ ...lesson, id: `lesson-${Date.now()}`, savedAt: new Date().toISOString() });
  // Keep max 500 lessons
  if (lessons.length > 500) lessons.splice(0, lessons.length - 500);
  await write('lessons.json', lessons);
}

// ─── Agent Stats ──────────────────────────────────────────────────────────────

export async function getAgentStats() {
  return read('agent-stats.json', {});
}

export async function updateAgentStats(agentId, tradeResult) {
  const stats = await getAgentStats();
  if (!stats[agentId]) {
    stats[agentId] = {
      level: 1, trades: 0, wins: 0, losses: 0,
      winRate: 0, totalPnL: 0, lessons: 0, lastActive: null,
    };
  }
  const s = stats[agentId];
  s.trades++;
  if (tradeResult.pnl > 0) s.wins++;
  else s.losses++;
  s.totalPnL += tradeResult.pnl;
  s.winRate = s.trades > 0 ? s.wins / s.trades : 0;
  s.lastActive = new Date().toISOString();
  // Level up every 10 trades with >50% win rate
  if (s.trades % 10 === 0 && s.winRate >= 0.5) s.level++;
  await write('agent-stats.json', stats);
  return stats[agentId];
}

// ─── Decisions log ────────────────────────────────────────────────────────────

export async function getDecisions() {
  return read('decisions.json', []);
}

export async function logDecision(decision) {
  const decisions = await getDecisions();
  decisions.push({ ...decision, id: `dec-${Date.now()}`, at: new Date().toISOString() });
  if (decisions.length > 1000) decisions.splice(0, decisions.length - 1000);
  await write('decisions.json', decisions);
}

// ─── Human orders ─────────────────────────────────────────────────────────────

export async function getActiveOrders() {
  return read('human-orders.json', []);
}

export async function addHumanOrder(order) {
  const orders = await getActiveOrders();
  orders.push({ ...order, id: `ord-${Date.now()}`, issuedAt: new Date().toISOString(), active: true });
  await write('human-orders.json', orders);
}

export async function clearOrder(orderId) {
  const orders = await getActiveOrders();
  const updated = orders.map(o => o.id === orderId ? { ...o, active: false } : o);
  await write('human-orders.json', updated);
}

// ─── Full state snapshot (for /api/agent/status) ──────────────────────────────

export async function getSnapshot() {
  const [capital, trades, lessons, agentStats] = await Promise.all([
    getCapital(), getTrades(), getLessons(), getAgentStats(),
  ]);
  const openTrades = trades.filter(t => t.status === 'open');
  const closedTrades = trades.filter(t => t.status === 'closed');
  const wins = closedTrades.filter(t => (t.pnl ?? 0) > 0).length;
  return {
    capital,
    trades: { open: openTrades.length, closed: closedTrades.length, all: trades.slice(-20) },
    lessons: lessons.slice(-5),
    agentStats,
    performance: {
      totalTrades: closedTrades.length,
      winRate: closedTrades.length > 0 ? wins / closedTrades.length : 0,
      totalPnL: closedTrades.reduce((s, t) => s + (t.pnl ?? 0), 0),
    },
  };
}
