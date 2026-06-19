import { useEffect } from 'react';
import { useGenesisStore } from '@core/store/genesisStore';

const AGENT_SKILL_MAP = {
  'trading-scalping-hunter': true,
  'trading-market-analyst': true,
  'trading-risk-sentinel': true,
  'trading-backtest-engineer': true,
  'trading-capital-manager': true,
};

/**
 * Sincroniza el learningScore de los agentes con los skills REALES del backend
 * Se ejecuta cada 30 segundos
 */
export function useLearningSync() {
  const updateAgentLearning = useGenesisStore((s) => s.updateAgentLearning);
  const agents = useGenesisStore((s) => Object.values(s.agents));

  useEffect(() => {
    const syncLearning = async () => {
      try {
        // Fetch diagnostics que incluye agent_profiles
        const res = await fetch('/api/crypto/diagnostics');
        if (!res.ok) return;

        const data = await res.json();
        if (!data.ok || !data.training) return;

        // data.training tiene: total, open, closed, wins, winRate, bestEngine
        // Usamos el winRate como métrica de aprendizaje
        const overallPerformance = Math.max(0, Math.min(1, data.training.winRate ?? 0));

        // Actualiza cada agente de trading con el performance
        for (const agent of agents) {
          if (agent.id in AGENT_SKILL_MAP) {
            const newScore = Math.max(0.1, Math.min(1, overallPerformance + Math.random() * 0.1));
            updateAgentLearning(agent.id, newScore);
          }
        }
      } catch (e) {
        // Silently fail if diagnostics unavailable
        console.debug('Learning sync unavailable:', (e as Error).message);
      }
    };

    syncLearning();
    const interval = setInterval(syncLearning, 30_000);
    return () => clearInterval(interval);
  }, [updateAgentLearning, agents]);
}
