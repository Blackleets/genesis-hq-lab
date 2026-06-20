import { useEffect } from 'react';
import { useAgents, updateAgentLearning } from '@core/store/genesisStore';

const AGENT_SKILL_MAP = {
  'trading-scalping-hunter': true,
  'trading-market-analyst': true,
  'trading-risk-sentinel': true,
  'trading-backtest-engineer': true,
  'trading-capital-manager': true,
};

export function useLearningSync() {
  const agents = useAgents();

  useEffect(() => {
    const syncLearning = async () => {
      try {
        const res = await fetch('/api/crypto/diagnostics');
        if (!res.ok) return;

        const data = await res.json();
        if (!data.ok || !data.training) return;

        const overallPerformance = Math.max(0, Math.min(1, data.training.winRate ?? 0));

        for (const agent of agents) {
          if (agent.id in AGENT_SKILL_MAP) {
            const newScore = Math.max(0.1, Math.min(1, overallPerformance + Math.random() * 0.1));
            updateAgentLearning(agent.id, newScore);
          }
        }
      } catch (e) {
        console.debug('Learning sync unavailable:', (e as Error).message);
      }
    };

    syncLearning();
    const interval = setInterval(syncLearning, 30_000);
    return () => clearInterval(interval);
  }, [agents]);
}
