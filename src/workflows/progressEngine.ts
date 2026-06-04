// Derived metrics from the live store state.

import type { GenesisStateShape } from '@core/store/genesisStore';
import { useGenesisState } from '@core/store/genesisStore';
import type { GenesisProgress } from '@core/types/progress';

export function computeProgress(s: GenesisStateShape): GenesisProgress {
  const agents = Object.values(s.agents);
  const fired = Object.values(s.firedAgents);
  const tasks = Object.values(s.tasks);
  const modules = Object.values(s.modules);
  const upgrades = Object.values(s.officeUpgrades);

  const onboardingAgents = agents.filter((a) => a.status === 'onboarding').length;
  const queued = tasks.filter((t) => t.status === 'queued').length;
  const active = tasks.filter((t) => t.status === 'assigned' || t.status === 'moving' || t.status === 'working').length;
  const completed = tasks.filter((t) => t.status === 'completed').length;
  const failed = tasks.filter((t) => t.status === 'failed').length;

  const modulesUnlocked = modules.filter((m) => m.state === 'ready' || m.state === 'visual-only').length;
  const upgradesCompleted = upgrades.filter((u) => u.status === 'completed').length;

  const bornMs = Date.parse(s.meta.bornAt);
  const ageHours = (Date.now() - bornMs) / (1000 * 60 * 60);

  const avgLearning = agents.length === 0
    ? 0
    : agents.reduce((acc, a) => acc + a.learningScore, 0) / agents.length;
  const avgTrust = agents.length === 0
    ? 0
    : agents.reduce((acc, a) => acc + a.trustScore, 0) / agents.length;

  return {
    bornAt: s.meta.bornAt,
    ageHours: Number(ageHours.toFixed(2)),
    activeAgents: agents.length - onboardingAgents,
    onboardingAgents,
    firedAgents: fired.length,
    hiringQueue: Object.values(s.hiringQueue).length,
    tasksQueued: queued,
    tasksActive: active,
    tasksCompleted: completed,
    tasksFailed: failed,
    modulesUnlocked,
    officeUpgradesCompleted: upgradesCompleted,
    learningLevel: Number(avgLearning.toFixed(3)),
    companyHealth: Number(Math.min(1, (avgTrust * 0.6 + avgLearning * 0.4)).toFixed(3)),
  };
}

export function useProgress(): GenesisProgress {
  const s = useGenesisState();
  return computeProgress(s);
}
