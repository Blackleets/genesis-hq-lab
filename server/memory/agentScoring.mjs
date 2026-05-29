// agentScoring — tracks performance, promotes/demotes agents, evolves skills.
// Real improvement, not fake badges. Level = trust + capability + budget access.

import db, { tx } from '../db/database.mjs';
import { computeCalibration } from './tradingMemory.mjs';

// ─── Constants ────────────────────────────────────────────────────────────────

const LEVEL_UP_TRADES   = 10;     // trades required before level-up is considered
const LEVEL_UP_WINRATE  = 0.55;   // min win rate for promotion
const LEVEL_UP_CALIBRATION = 0.60; // min calibration score for promotion
const DEMOTION_STREAK   = 3;      // consecutive losses before soft demotion
const CRITICAL_LOSS_PCT = -0.20;  // PnL loss % that triggers immediate review

// ─── Update agent stats after a trade closes ─────────────────────────────────

export function updateAfterTrade(agentId, trade) {
  const agent = db.prepare('SELECT * FROM agent_profiles WHERE id = ?').get(agentId);
  if (!agent) return;

  const won = (trade.pnl ?? 0) > 0;

  tx(() => {
    // Update counters
    db.prepare(`
      UPDATE agent_profiles SET
        total_trades = total_trades + 1,
        wins         = wins + ?,
        losses       = losses + ?,
        total_pnl    = total_pnl + ?,
        win_streak   = CASE WHEN ? THEN win_streak + 1 ELSE 0 END,
        loss_streak  = CASE WHEN ? THEN loss_streak + 1 ELSE 0 END,
        max_win_streak  = MAX(max_win_streak,  CASE WHEN ? THEN win_streak + 1 ELSE win_streak END),
        max_loss_streak = MAX(max_loss_streak, CASE WHEN ? THEN loss_streak + 1 ELSE loss_streak END),
        last_active  = datetime('now')
      WHERE id = ?
    `).run(
      won ? 1 : 0, won ? 0 : 1,
      trade.pnl ?? 0,
      won ? 1 : 0, won ? 0 : 1,
      won ? 1 : 0, won ? 0 : 1,
      agentId,
    );

    // Recompute calibration
    const calibration = computeCalibration(agentId);
    db.prepare('UPDATE agent_profiles SET calibration_score = ? WHERE id = ?').run(calibration, agentId);

    // Update skill that was most relevant to this trade
    updateSkill(agentId, trade, won);
  });

  // Check for promotion or demotion
  const updated = db.prepare('SELECT * FROM agent_profiles WHERE id = ?').get(agentId);
  return checkPromotion(updated);
}

// ─── Skill evolution — granular per skill ────────────────────────────────────

function updateSkill(agentId, trade, won) {
  const delta = won ? 0.02 : -0.01;
  const floor = 0.1;
  const ceil  = 1.0;

  // Determine which skill was most relevant
  const lesson = db.prepare(`
    SELECT category FROM lessons WHERE trade_id = ? LIMIT 1
  `).get(trade.id);

  const category = lesson?.category ?? 'market_selection';

  const skillMap = {
    market_selection: 'skill_market_selection',
    timing:           'skill_timing',
    signal:           'skill_signal_reading',
    pattern:          'skill_pattern_recog',
    position_size:    'skill_position_sizing',
    confidence:       'skill_signal_reading',
  };

  const skillCol = skillMap[category] ?? 'skill_market_selection';

  db.prepare(`
    UPDATE agent_profiles
    SET ${skillCol} = MAX(?, MIN(?, ${skillCol} + ?))
    WHERE id = ?
  `).run(floor, ceil, delta, agentId);
}

// ─── Promotion / Demotion logic ───────────────────────────────────────────────

function checkPromotion(agent) {
  const totalClosed = db.prepare(`
    SELECT COUNT(*) AS cnt FROM trades WHERE agent_id = ? AND status = 'closed'
  `).get(agent.id)?.cnt ?? 0;

  if (totalClosed === 0) return { action: 'none', agent };

  const winRate     = agent.wins / (agent.wins + agent.losses + 0.001);
  const calibration = agent.calibration_score ?? 0.5;
  const level       = agent.level ?? 1;

  // ── PROMOTION ───────────────────────────────────────────────────────────────
  // Every 10 closed trades, check if promotion criteria are met
  if (totalClosed % LEVEL_UP_TRADES === 0 &&
      winRate >= LEVEL_UP_WINRATE &&
      calibration >= LEVEL_UP_CALIBRATION) {

    const newLevel     = level + 1;
    const newBudgetPct = Math.min(0.15, agent.budget_pct + 0.01); // +1% budget per level

    db.prepare(`
      UPDATE agent_profiles SET level = ?, budget_pct = ? WHERE id = ?
    `).run(newLevel, newBudgetPct, agent.id);

    console.log(`[agentScoring] 🎖️  ${agent.name} PROMOTED to level ${newLevel} (win rate: ${(winRate*100).toFixed(1)}%, calibration: ${(calibration*100).toFixed(1)}%)`);
    return { action: 'promoted', newLevel, winRate, calibration, agent: { ...agent, level: newLevel } };
  }

  // ── SOFT DEMOTION ────────────────────────────────────────────────────────────
  // 3+ consecutive losses → reduce budget, increase review threshold
  if (agent.loss_streak >= DEMOTION_STREAK) {
    const reducedBudget = Math.max(0.02, agent.budget_pct * 0.8); // -20% budget
    db.prepare(`
      UPDATE agent_profiles SET budget_pct = ? WHERE id = ?
    `).run(reducedBudget, agent.id);

    console.log(`[agentScoring] ⚠️  ${agent.name} soft-demoted: ${agent.loss_streak} consecutive losses, budget reduced to ${(reducedBudget*100).toFixed(1)}%`);
    return { action: 'soft_demotion', lossStreak: agent.loss_streak, newBudget: reducedBudget };
  }

  // ── HARD DEMOTION / RETRAINING ────────────────────────────────────────────────
  // Win rate < 30% after 20+ trades → retrain (stricter system prompt)
  if (totalClosed >= 20 && winRate < 0.30) {
    db.prepare(`
      UPDATE agent_profiles SET status = 'retrained', level = MAX(1, level - 1) WHERE id = ?
    `).run(agent.id);
    console.log(`[agentScoring] ⛔ ${agent.name} flagged for RETRAINING (win rate: ${(winRate*100).toFixed(1)}%)`);
    return { action: 'retrain', winRate, agent };
  }

  return { action: 'none', winRate, calibration, agent };
}

// ─── Get full agent performance report ───────────────────────────────────────

export function getAgentReport(agentId) {
  const agent = db.prepare('SELECT * FROM agent_profiles WHERE id = ?').get(agentId);
  if (!agent) return null;

  const stats = db.prepare(`
    SELECT
      COUNT(*) AS total, SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) AS wins,
      SUM(pnl) AS total_pnl, AVG(pnl) AS avg_pnl,
      AVG(confidence) AS avg_confidence,
      AVG(CASE WHEN pnl > 0 THEN confidence ELSE NULL END) AS win_avg_conf,
      AVG(CASE WHEN pnl <= 0 THEN confidence ELSE NULL END) AS loss_avg_conf
    FROM trades WHERE agent_id = ? AND status = 'closed'
  `).get(agentId);

  const recentLessons = db.prepare(`
    SELECT lesson_text, category, severity, times_prevented_loss
    FROM lessons WHERE agent_id = ? ORDER BY created_at DESC LIMIT 5
  `).all(agentId);

  const skills = {
    market_selection: agent.skill_market_selection,
    timing:           agent.skill_timing,
    signal_reading:   agent.skill_signal_reading,
    pattern_recog:    agent.skill_pattern_recog,
    position_sizing:  agent.skill_position_sizing,
  };

  const winRate = stats.total > 0 ? stats.wins / stats.total : 0;

  return {
    id:          agent.id,
    name:        agent.name,
    level:       agent.level,
    status:      agent.status,
    budgetPct:   agent.budget_pct,
    calibration: agent.calibration_score,
    skills,
    winRate,
    stats,
    recentLessons,
    streaks: {
      win:  agent.win_streak,
      loss: agent.loss_streak,
    },
  };
}

// ─── Get all agents leaderboard ───────────────────────────────────────────────

export function getLeaderboard() {
  return db.prepare(`
    SELECT id, name, level, status,
           wins, losses, total_pnl,
           calibration_score,
           ROUND(CAST(wins AS REAL) / MAX(wins + losses, 1), 3) AS win_rate,
           budget_pct
    FROM agent_profiles
    ORDER BY level DESC, win_rate DESC
  `).all();
}
