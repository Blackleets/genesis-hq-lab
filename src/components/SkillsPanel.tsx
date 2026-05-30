// SkillsPanel — deployed agent skills (SkillOpt) from /api/agent/skills.
// Shows each agent's live skill version + metrics. Read-only.

import { useAgentData } from '../hooks/useAgentData';
import { useLanguage } from '../i18n/languageStore';

const AGENT_LABEL: Record<string, string> = {
  polymarket_agent: 'Polymarket',
  kalshi_agent:     'Kalshi',
  risk_agent:       'Risk',
  marketing_agent:  'Marketing',
  research_agent:   'Research',
};

export default function SkillsPanel() {
  const lang = useLanguage();
  const { skills, online } = useAgentData();

  if (!online || skills.length === 0) return null;

  return (
    <div className="border border-trim bg-carbon-200">
      <div className="px-4 py-2 border-b border-trim flex items-center justify-between">
        <span className="font-mono text-[9px] uppercase tracking-widest text-zinc-500">
          {lang === 'es' ? 'Skills de Agentes · SkillOpt' : 'Agent Skills · SkillOpt'}
        </span>
        <span className="font-mono text-[9px] text-zinc-600">{skills.length}</span>
      </div>
      <ul className="divide-y divide-trim">
        {skills.map((s) => (
          <li key={s.agent} className="px-4 py-2.5 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="font-mono text-[11px] text-zinc-200">
                {AGENT_LABEL[s.agent] ?? s.agent}
              </div>
              <div className="font-mono text-[8px] text-zinc-600 uppercase tracking-wider">
                v{s.version} · {s.status}
              </div>
            </div>
            <div className="shrink-0 flex items-center gap-3 font-mono text-[9px]">
              {s.brier != null ? (
                <span className="text-zinc-500">Brier <span className="text-zinc-300">{s.brier.toFixed(2)}</span></span>
              ) : (
                <span className="text-zinc-700">{lang === 'es' ? 'sin métricas aún' : 'no metrics yet'}</span>
              )}
              {s.win_rate != null && (
                <span className="text-zinc-500">WR <span className="text-emerald-400">{(s.win_rate * 100).toFixed(0)}%</span></span>
              )}
              <span
                className="inline-block w-1.5 h-1.5 rounded-full"
                style={{ background: s.status === 'deployed' ? '#00ff9c' : '#4a5568' }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
