// skillEvolution.mjs — Agent skill tracking and improvement over time
// Monitors 5 core skills: market selection, timing, position sizing, signal reading, pattern recognition

import db, { tx } from '../db/database.mjs';

export const SKILL_NAMES = [
  'skill_market_selection',
  'skill_timing',
  'skill_position_sizing',
  'skill_signal_reading',
  'skill_pattern_recog',
];

// How much to adjust skill after each trade (0.01 = 1%)
const SKILL_ADJUSTMENT_FACTOR = 0.02;
const MIN_SKILL = 0.01;
const MAX_SKILL = 0.99;

/**
 * Update agent skills after a trade closes (win or loss)
 * Win: skill += adjustment, Loss: skill -= adjustment
 * Confidence affects magnitude of adjustment
 */
export function updateSkillsAfterTrade(agentId, tradeOutcome, confidence) {
  const isWin = tradeOutcome === 'WIN';
  const sign = isWin ? 1 : -1;

  // Confidence affects learning speed
  // High confidence wins = big boost, high confidence losses = bigger penalty
  const adjustment = sign * confidence * SKILL_ADJUSTMENT_FACTOR;

  try {
    tx(() => {
      const agent = db.prepare('SELECT * FROM agent_profiles WHERE id = ?').get(agentId);
      if (!agent) return;

      const updates = {};
      for (const skill of SKILL_NAMES) {
        const current = agent[skill] ?? 0.3;
        const newValue = Math.max(MIN_SKILL, Math.min(MAX_SKILL, current + adjustment));
        updates[skill] = newValue;
      }

      // Build dynamic UPDATE statement
      const setClauses = SKILL_NAMES.map(s => `${s} = ?`).join(', ');
      const values = SKILL_NAMES.map(s => updates[s]);
      values.push(agentId);

      db.prepare(`
        UPDATE agent_profiles
        SET ${setClauses}
        WHERE id = ?
      `).run(...values);

      console.log(`[skill] ${agentId} ${isWin ? 'WIN' : 'LOSS'} (conf=${(confidence*100).toFixed(0)}%): skills adjusted`);
    });
  } catch (err) {
    console.error('[skill] Failed to update skills:', err.message);
  }
}

/**
 * Get agent's current skill profile
 */
export function getSkillProfile(agentId) {
  const agent = db.prepare('SELECT * FROM agent_profiles WHERE id = ?').get(agentId);
  if (!agent) return null;

  return {
    agentId,
    name: agent.name,
    marketSelection: agent.skill_market_selection ?? 0.3,
    timing: agent.skill_timing ?? 0.3,
    positionSizing: agent.skill_position_sizing ?? 0.3,
    signalReading: agent.skill_signal_reading ?? 0.3,
    patternRecognition: agent.skill_pattern_recog ?? 0.3,
    average: (
      (agent.skill_market_selection ?? 0.3) +
      (agent.skill_timing ?? 0.3) +
      (agent.skill_position_sizing ?? 0.3) +
      (agent.skill_signal_reading ?? 0.3) +
      (agent.skill_pattern_recog ?? 0.3)
    ) / 5,
  };
}

/**
 * Get all agent skill profiles (for dashboard)
 */
export function getAllSkillProfiles() {
  const agents = db.prepare('SELECT * FROM agent_profiles WHERE status = ?').all('active');
  return agents.map(a => {
    return {
      agentId: a.id,
      name: a.name,
      marketSelection: a.skill_market_selection ?? 0.3,
      timing: a.skill_timing ?? 0.3,
      positionSizing: a.skill_position_sizing ?? 0.3,
      signalReading: a.skill_signal_reading ?? 0.3,
      patternRecognition: a.skill_pattern_recog ?? 0.3,
    };
  });
}

/**
 * Identify agent's strongest and weakest skills
 */
export function getSkillStrengthsWeaknesses(agentId) {
  const profile = getSkillProfile(agentId);
  if (!profile) return null;

  const skills = [
    { name: 'Market Selection', value: profile.marketSelection },
    { name: 'Timing', value: profile.timing },
    { name: 'Position Sizing', value: profile.positionSizing },
    { name: 'Signal Reading', value: profile.signalReading },
    { name: 'Pattern Recognition', value: profile.patternRecognition },
  ];

  const sorted = [...skills].sort((a, b) => b.value - a.value);
  const strengths = sorted.slice(0, 2);
  const weaknesses = sorted.slice(-2).reverse();

  return {
    agentId,
    name: profile.name,
    strengths,
    weaknesses,
    average: profile.average,
    needsImprovement: weaknesses[0].value < 0.4, // Flag if weakest < 40%
  };
}

/**
 * Recommend training: identify skills below threshold
 */
export function getTrainingRecommendations(agentId, threshold = 0.40) {
  const profile = getSkillProfile(agentId);
  if (!profile) return [];

  const skills = [
    { name: 'Market Selection', value: profile.marketSelection, bucket: 'market_analysis' },
    { name: 'Timing', value: profile.timing, bucket: 'entry_exit' },
    { name: 'Position Sizing', value: profile.positionSizing, bucket: 'risk_management' },
    { name: 'Signal Reading', value: profile.signalReading, bucket: 'signal_analysis' },
    { name: 'Pattern Recognition', value: profile.patternRecognition, bucket: 'technical_analysis' },
  ];

  return skills
    .filter(s => s.value < threshold)
    .map(s => ({
      skill: s.name,
      current: s.value,
      target: threshold,
      trainingBucket: s.bucket,
      priority: 'high',
    }));
}
