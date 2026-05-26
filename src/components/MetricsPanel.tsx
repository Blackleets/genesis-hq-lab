// MetricsPanel — visual seed metrics shown in Dashboard + Progress.
// Hard pixel-style cards, no SaaS gradients. Numbers come from
// SEED_METRICS (clearly labeled).

import { useT } from '../i18n/languageStore';
import { SEED_METRICS } from '../data/officeEvents';

function Card({ label, value, hint, color = '#3da9fc' }: { label: string; value: string; hint?: string; color?: string }) {
  return (
    <div className="border border-trim bg-carbon-200 px-4 py-3">
      <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="font-mono text-2xl mt-1" style={{ color }}>{value}</div>
      {hint && <div className="font-mono text-[10px] text-zinc-600 mt-1">{hint}</div>}
    </div>
  );
}

function Bar({ label, value, color = '#3da9fc' }: { label: string; value: number; color?: string }) {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <div className="border border-trim bg-carbon-200 px-4 py-3">
      <div className="flex items-baseline justify-between">
        <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
        <div className="font-mono text-sm text-zinc-200">{(pct * 100).toFixed(0)}%</div>
      </div>
      <div className="mt-2 h-2 bg-carbon-300 border border-trim">
        <div className="h-full" style={{ width: `${pct * 100}%`, background: color }} />
      </div>
    </div>
  );
}

export default function MetricsPanel() {
  const t = useT();
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      <Card label={t('metric.genesisAge')}      value={t('metric.genesisAge.value')} color="#ffd24a" />
      <Card label={t('metric.activeAgents')}    value={String(SEED_METRICS.activeAgents)} color="#00ff9c" />
      <Card label={t('metric.hiringQueue')}     value={String(SEED_METRICS.hiringQueue)} color="#7c5cff" />
      <Card label={t('metric.modulesUnlocked')} value={`${SEED_METRICS.modulesUnlocked} / 9`} color="#3da9fc" />
      <Bar  label={t('metric.learningLevel')}   value={SEED_METRICS.learningLevel}    color="#22d3ee" />
      <Bar  label={t('metric.companyHealth')}   value={SEED_METRICS.companyHealth}    color="#00ff9c" />
      <Card label={t('metric.tasksCompleted')}  value={String(SEED_METRICS.tasksCompleted)} color="#3da9fc" />
      <Card label={t('metric.officeUpgrades')}  value={String(SEED_METRICS.officeUpgrades)} color="#ffb547" />
      <Card label={t('metric.agentsHired')}     value={String(SEED_METRICS.agentsHired)} color="#22d3ee" />
      <Card label={t('metric.agentsFired')}     value={String(SEED_METRICS.agentsFired)} color="#ff4757" />
    </div>
  );
}
