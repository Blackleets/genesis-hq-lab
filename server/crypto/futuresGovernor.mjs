import db from '../db/database.mjs';

const WINDOW_DAYS = parseInt(process.env.FUTURES_GOV_WINDOW_DAYS ?? '21', 10);
const DEGRADE_MIN_SAMPLES = parseInt(process.env.FUTURES_GOV_DEGRADE_MIN_SAMPLES ?? '6', 10);
const PAUSE_MIN_SAMPLES = parseInt(process.env.FUTURES_GOV_PAUSE_MIN_SAMPLES ?? '10', 10);
const DEGRADE_WIN_RATE = parseFloat(process.env.FUTURES_GOV_DEGRADE_WIN_RATE ?? '0.40');
const PAUSE_WIN_RATE = parseFloat(process.env.FUTURES_GOV_PAUSE_WIN_RATE ?? '0.30');
const SUPERVISOR_MAX_DAILY_LOSS = parseFloat(process.env.FUTURES_SUPERVISOR_MAX_DAILY_LOSS ?? '120');
const SUPERVISOR_MAX_CONSEC_LOSSES = parseInt(process.env.FUTURES_SUPERVISOR_MAX_CONSEC_LOSSES ?? '3', 10);
const SUPERVISOR_COOLDOWN_HOURS = parseInt(process.env.FUTURES_SUPERVISOR_COOLDOWN_HOURS ?? '6', 10);
const PROMOTE_MIN_SAMPLES = parseInt(process.env.FUTURES_GOV_PROMOTE_MIN_SAMPLES ?? '8', 10);
const ATTACK_MIN_SAMPLES = parseInt(process.env.FUTURES_GOV_ATTACK_MIN_SAMPLES ?? '12', 10);

const PROFILE_DEFS = [
  { id: 'short_micro', tradeType: 'crypto_futures_breakout_short_micro' },
  { id: 'short_core', tradeType: 'crypto_futures_breakout_short' },
  { id: 'short_alt', tradeType: 'crypto_futures_breakout_short_alt' },
  { id: 'long_probe', tradeType: 'crypto_futures_breakout_long' },
];
const JOURNAL_KEY = 'futures_governor_journal';
const MAX_JOURNAL = 60;

function round2(value) {
  return value == null ? null : Math.round(value * 100) / 100;
}

function round3(value) {
  return value == null ? null : Math.round(value * 1000) / 1000;
}

function readJournal() {
  try {
    const row = db.prepare(`SELECT value FROM org_state WHERE key = ?`).get(JOURNAL_KEY);
    if (!row?.value) return [];
    const parsed = JSON.parse(row.value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getSupervisorState(tradeType) {
  const daily = db.prepare(`
    SELECT
      COUNT(*) AS trades,
      COALESCE(SUM(pnl), 0) AS totalPnl
    FROM trades
    WHERE trade_type = ?
      AND status = 'closed'
      AND pnl IS NOT NULL
      AND closed_at >= datetime('now', 'start of day')
  `).get(tradeType);

  const closes = db.prepare(`
    SELECT pnl, closed_at
    FROM trades
    WHERE trade_type = ?
      AND status = 'closed'
      AND pnl IS NOT NULL
    ORDER BY closed_at DESC
    LIMIT ?
  `).all(tradeType, SUPERVISOR_MAX_CONSEC_LOSSES);

  let consecutiveLosses = 0;
  for (const close of closes) {
    if ((close.pnl ?? 0) < 0) consecutiveLosses++;
    else break;
  }

  const lastClosedAt = closes[0]?.closed_at ?? null;
  const cooldownUntil = lastClosedAt
    ? new Date(new Date(lastClosedAt).getTime() + (SUPERVISOR_COOLDOWN_HOURS * 60 * 60 * 1000)).toISOString()
    : null;

  const dailyPnl = round2(daily?.totalPnl ?? 0);
  const dailyTrades = daily?.trades ?? 0;
  const dailyLossTriggered = dailyPnl <= -Math.abs(SUPERVISOR_MAX_DAILY_LOSS);
  const streakTriggered = consecutiveLosses >= SUPERVISOR_MAX_CONSEC_LOSSES;
  const coolingDown = (dailyLossTriggered || streakTriggered)
    && cooldownUntil != null
    && new Date(cooldownUntil).getTime() > Date.now();

  return {
    dailyTrades,
    dailyPnl,
    consecutiveLosses,
    cooldownUntil,
    mode: coolingDown ? 'cooldown' : 'live',
    reason: dailyLossTriggered
      ? `daily loss ${dailyPnl} <= -${Math.abs(SUPERVISOR_MAX_DAILY_LOSS)}`
      : streakTriggered
        ? `${consecutiveLosses} consecutive losses`
        : null,
  };
}

function writeJournal(entries) {
  try {
    db.prepare(`
      INSERT OR REPLACE INTO org_state (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
    `).run(JOURNAL_KEY, JSON.stringify(entries.slice(-MAX_JOURNAL)));
  } catch {
    // Non-fatal
  }
}

function evaluateProfile(row) {
  const trades = row?.trades ?? 0;
  const wins = row?.wins ?? 0;
  const totalPnl = row?.totalPnl ?? 0;
  const avgPnl = row?.avgPnl ?? 0;
  const winRate = trades > 0 ? wins / trades : null;
  const grossProfit = row?.grossProfit ?? 0;
  const grossLoss = row?.grossLoss ?? 0;
  const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss) : (grossProfit > 0 ? Infinity : null);

  if (trades < DEGRADE_MIN_SAMPLES) {
    return {
      mode: 'learning',
      capitalMultiplier: 1,
      leverageMultiplier: 1,
      reason: `learning window: ${trades}/${DEGRADE_MIN_SAMPLES} closed trades`,
    };
  }

  if (trades >= PAUSE_MIN_SAMPLES && totalPnl < 0 && (winRate ?? 1) <= PAUSE_WIN_RATE) {
    return {
      mode: 'paused',
      capitalMultiplier: 0,
      leverageMultiplier: 0,
      reason: `${trades} trades, WR ${Math.round((winRate ?? 0) * 100)}%, PnL $${round2(totalPnl)}`,
    };
  }

  if (totalPnl < 0 || (winRate ?? 1) < DEGRADE_WIN_RATE || avgPnl < 0) {
    return {
      mode: 'degraded',
      capitalMultiplier: 0.5,
      leverageMultiplier: 0.67,
      reason: `${trades} trades, WR ${Math.round((winRate ?? 0) * 100)}%, avg $${round2(avgPnl)}`,
    };
  }

  if (
    trades >= ATTACK_MIN_SAMPLES
    && totalPnl > 120
    && (winRate ?? 0) >= 0.58
    && avgPnl >= 12
    && (profitFactor == null || profitFactor === Infinity || profitFactor >= 1.6)
  ) {
    return {
      mode: 'active',
      capitalMultiplier: 1.35,
      leverageMultiplier: 1.15,
      reason: `attack profile: ${trades} trades, WR ${Math.round((winRate ?? 0) * 100)}%, avg $${round2(avgPnl)}, PnL $${round2(totalPnl)}`,
    };
  }

  if (
    trades >= PROMOTE_MIN_SAMPLES
    && totalPnl > 40
    && (winRate ?? 0) >= 0.5
    && avgPnl >= 5
    && (profitFactor == null || profitFactor === Infinity || profitFactor >= 1.2)
  ) {
    return {
      mode: 'active',
      capitalMultiplier: 1.15,
      leverageMultiplier: 1.05,
      reason: `promoted profile: ${trades} trades, WR ${Math.round((winRate ?? 0) * 100)}%, avg $${round2(avgPnl)}, PnL $${round2(totalPnl)}`,
    };
  }

  return {
    mode: 'active',
    capitalMultiplier: 1,
    leverageMultiplier: 1,
    reason: `${trades} trades, WR ${Math.round((winRate ?? 0) * 100)}%, PnL $${round2(totalPnl)}`,
  };
}

export function getFuturesGovernorSnapshot() {
  const profiles = PROFILE_DEFS.map((profile) => {
    const row = db.prepare(`
      SELECT
        COUNT(*) AS trades,
        SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) AS wins,
        COALESCE(SUM(pnl), 0) AS totalPnl,
        COALESCE(AVG(pnl), 0) AS avgPnl,
        COALESCE(SUM(CASE WHEN pnl > 0 THEN pnl ELSE 0 END), 0) AS grossProfit,
        COALESCE(ABS(SUM(CASE WHEN pnl < 0 THEN pnl ELSE 0 END)), 0) AS grossLoss
      FROM trades
      WHERE trade_type = ?
        AND status = 'closed'
        AND pnl IS NOT NULL
        AND closed_at > datetime('now', ?)
    `).get(profile.tradeType, `-${WINDOW_DAYS} days`);

    const verdict = evaluateProfile(row);
    const trades = row?.trades ?? 0;
    const wins = row?.wins ?? 0;
    const winRate = trades > 0 ? wins / trades : null;
    const profitFactor = (row?.grossLoss ?? 0) > 0
      ? (row.grossProfit / row.grossLoss)
      : (row?.grossProfit ?? 0) > 0 ? Infinity : null;
    const closes = db.prepare(`
      SELECT pnl
      FROM trades
      WHERE trade_type = ?
        AND status = 'closed'
        AND pnl IS NOT NULL
        AND closed_at > datetime('now', ?)
      ORDER BY closed_at ASC
    `).all(profile.tradeType, `-${WINDOW_DAYS} days`);
    let equity = 0;
    let peak = 0;
    let maxDrawdown = 0;
    for (const close of closes) {
      equity += close.pnl ?? 0;
      peak = Math.max(peak, equity);
      maxDrawdown = Math.min(maxDrawdown, equity - peak);
    }
    const rankScore = round2(((winRate ?? 0) * 100) + (row?.avgPnl ?? 0) + ((profitFactor && Number.isFinite(profitFactor)) ? profitFactor * 5 : 0));
    const supervisor = getSupervisorState(profile.tradeType);

    return {
      id: profile.id,
      tradeType: profile.tradeType,
      trades,
      wins,
      winRate: round3(winRate),
      totalPnl: round2(row?.totalPnl ?? 0),
      avgPnl: round2(row?.avgPnl ?? 0),
      expectancy: round2(row?.avgPnl ?? 0),
      profitFactor: profitFactor == null || profitFactor === Infinity ? profitFactor : round2(profitFactor),
      maxDrawdown: round2(maxDrawdown),
      rankScore,
      supervisor,
      ...verdict,
    };
  });

  return {
    windowDays: WINDOW_DAYS,
    degradeMinSamples: DEGRADE_MIN_SAMPLES,
    pauseMinSamples: PAUSE_MIN_SAMPLES,
    supervisor: {
      maxDailyLoss: SUPERVISOR_MAX_DAILY_LOSS,
      maxConsecutiveLosses: SUPERVISOR_MAX_CONSEC_LOSSES,
      cooldownHours: SUPERVISOR_COOLDOWN_HOURS,
    },
    profiles,
    journal: readJournal(),
    evaluatedAt: new Date().toISOString(),
  };
}

export function syncFuturesGovernorJournal(snapshot) {
  const current = snapshot ?? getFuturesGovernorSnapshot();
  const journal = readJournal();
  const lastByProfile = new Map(journal.map((entry) => [entry.profileId, entry]));
  let mutated = false;

  for (const profile of current.profiles) {
    const prev = lastByProfile.get(profile.id);
    if (!prev || prev.mode !== profile.mode || prev.reason !== profile.reason) {
      journal.push({
        profileId: profile.id,
        tradeType: profile.tradeType,
        mode: profile.mode,
        reason: profile.reason,
        trades: profile.trades,
        winRate: profile.winRate,
        totalPnl: profile.totalPnl,
        capitalMultiplier: profile.capitalMultiplier,
        leverageMultiplier: profile.leverageMultiplier,
        at: new Date().toISOString(),
      });
      mutated = true;
    }
  }

  if (mutated) writeJournal(journal);
  return journal.slice(-MAX_JOURNAL);
}
