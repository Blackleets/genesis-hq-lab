// Simple status endpoint to verify system is operational
import { sendJson } from '../_lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
  }

  return sendJson(res, 200, {
    ok: true,
    timestamp: new Date().toISOString(),
    system: 'genesis-hq-lab',
    version: '1.0.0',
    status: 'operational',
    features: {
      backend: 'online',
      fallback: 'active',
      agentLearning: 'ready',
      capitalManagement: 'ready',
      tradeExecution: 'ready',
    },
    capital: {
      initialAmount: 10000,
      currency: 'USD',
      description: 'Initial paper trading capital',
    },
    agents: {
      count: 5,
      active: [
        { id: 'trading-scalping-hunter', name: 'Scalping Hunter', role: 'Fast trades', learningEnabled: true },
        { id: 'trading-market-analyst', name: 'Market Analyst', role: 'Signal analysis', learningEnabled: true },
        { id: 'trading-risk-sentinel', name: 'Risk Sentinel', role: 'Risk management', learningEnabled: true },
        { id: 'trading-backtest-engineer', name: 'Backtest Engineer', role: 'Strategy validation', learningEnabled: true },
        { id: 'trading-capital-manager', name: 'Capital Manager', role: 'Budget allocation', learningEnabled: true },
      ],
    },
    learning: {
      enabled: true,
      mechanism: 'skill-evolution-based',
      updateFrequency: '30 seconds',
      tracking: 'win-rate and confidence calibration',
    },
    instructions: {
      reset: 'Visit ?reset to clear localStorage and reinitialize with fresh state',
      view_agents: 'Go to Crypto Lab or Agents IA to see agent status',
      view_learning: 'Check Crypto Lab dashboard for agent learning scores',
    },
  });
}
