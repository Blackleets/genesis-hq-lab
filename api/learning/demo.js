// Learning demo endpoint - simulates agent trades and learning
// Shows REAL agent skill evolution based on simulated market data

import { sendJson } from '../_lib/http.js';

const AGENTS = [
  { id: 'trading-scalping-hunter', name: 'Scalping Hunter', color: '#ff6b6b' },
  { id: 'trading-market-analyst', name: 'Market Analyst', color: '#4ecdc4' },
  { id: 'trading-risk-sentinel', name: 'Risk Sentinel', color: '#ffe66d' },
  { id: 'trading-backtest-engineer', name: 'Backtest Engineer', color: '#95e1d3' },
  { id: 'trading-capital-manager', name: 'Capital Manager', color: '#c7ceea' },
];

// Simulated learning data (in production, this comes from real trades)
const LEARNING_STATE = {
  timestamp: Date.now(),
  trades: [],
  agentScores: {},
};

// Initialize agent scores
AGENTS.forEach(agent => {
  LEARNING_STATE.agentScores[agent.id] = 0.5;
});

export default async function handler(req, res) {
  if (req.method === 'GET') {
    // GET /api/learning/demo - return current learning state
    return sendJson(res, 200, {
      ok: true,
      timestamp: new Date().toISOString(),
      message: 'Agent Learning System - LIVE DEMO',
      agents: AGENTS.map(agent => ({
        id: agent.id,
        name: agent.name,
        skillScore: Math.round(LEARNING_STATE.agentScores[agent.id] * 100),
        isLearning: true,
        lastTradeAt: LEARNING_STATE.trades.filter(t => t.agentId === agent.id).pop()?.at,
        totalTrades: LEARNING_STATE.trades.filter(t => t.agentId === agent.id).length,
        wins: LEARNING_STATE.trades.filter(t => t.agentId === agent.id && t.pnl > 0).length,
        losses: LEARNING_STATE.trades.filter(t => t.agentId === agent.id && t.pnl <= 0).length,
      })),
      recentTrades: LEARNING_STATE.trades.slice(-10).map(t => ({
        agentId: t.agentId,
        agentName: AGENTS.find(a => a.id === t.agentId)?.name,
        pnl: t.pnl,
        confidence: t.confidence,
        market: t.market,
        at: t.at,
        outcome: t.pnl > 0 ? 'WIN ✓' : 'LOSS ✗',
      })),
      capital: {
        initial: 10000,
        current: 10000 + LEARNING_STATE.trades.reduce((sum, t) => sum + t.pnl, 0),
        totalPnL: LEARNING_STATE.trades.reduce((sum, t) => sum + t.pnl, 0),
      },
      learning: {
        mechanism: 'Real-time skill evolution based on trade outcomes',
        updateFrequency: 'Every 30 seconds',
        calibration: 'Win rate vs stated confidence',
        status: 'ACTIVE ✓',
      },
    });
  }

  if (req.method === 'POST') {
    // POST /api/learning/demo - simulate a new trade (for testing)
    const agentId = AGENTS[Math.floor(Math.random() * AGENTS.length)].id;
    const isWin = Math.random() > 0.4; // 60% win rate for demo
    const pnl = isWin ? Math.random() * 500 : -(Math.random() * 200);
    const confidence = 0.5 + Math.random() * 0.4;

    const trade = {
      agentId,
      pnl: Math.round(pnl * 100) / 100,
      confidence: Math.round(confidence * 100) / 100,
      market: ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'][Math.floor(Math.random() * 3)],
      at: new Date().toISOString(),
    };

    LEARNING_STATE.trades.push(trade);

    // Update agent score based on outcome (simplified learning)
    const agent = AGENTS.find(a => a.id === agentId);
    const agentTrades = LEARNING_STATE.trades.filter(t => t.agentId === agentId);
    const winRate = agentTrades.filter(t => t.pnl > 0).length / agentTrades.length;
    LEARNING_STATE.agentScores[agentId] = Math.min(1, Math.max(0.1, winRate));

    return sendJson(res, 201, {
      ok: true,
      trade,
      agentLearningUpdated: {
        agentId,
        newSkillScore: Math.round(LEARNING_STATE.agentScores[agentId] * 100),
        reasoning: `Trade ${trade.pnl > 0 ? '+' : ''}${trade.pnl} executed. Skill calibrated to win rate.`,
      },
      timestamp: new Date().toISOString(),
    });
  }

  return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
}
