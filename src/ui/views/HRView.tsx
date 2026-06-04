// HRView — active roster + onboarding + hiring queue.

import { useT, useLanguage } from '@core/i18n/languageStore';
import { useActiveAgents } from '@core/store/genesisStore';
import { pickRole } from '@agents/agentHelpers';
import OnboardingPanel from '@agents/OnboardingPanel';
import HiringQueue from '@agents/HiringQueue';

export default function HRView() {
  const t = useT();
  const lang = useLanguage();
  const agents = useActiveAgents();
  return (
    <main className="flex-1 min-w-0 min-h-0 overflow-y-auto px-8 py-8 bg-carbon-300">
      <div className="max-w-6xl mx-auto space-y-6">
        <header>
          <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-500 mb-1">
            {t('header.title')}
          </div>
          <h1 className="font-mono text-2xl text-zinc-100">{t('hr.title')}</h1>
          <p className="font-mono text-[12px] text-zinc-500 mt-1 max-w-2xl">{t('hr.intro')}</p>
        </header>
        <OnboardingPanel />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <section className="gx-card">
            <header className="gx-card-head flex items-center justify-between">
              <span className="gx-card-title">
                {t('hr.active.title')}
              </span>
              <span className="font-mono text-[10px] text-zinc-500">{agents.length}</span>
            </header>
            <ul className="divide-y divide-trim">
              {agents.map((a) => (
                <li key={a.id} className="px-4 py-3">
                  <div className="font-mono text-sm text-zinc-100">{a.name}</div>
                  <div className="font-mono text-[11px] text-zinc-400">{pickRole(a.role, lang)}</div>
                  <div className="font-mono text-[10px] text-zinc-600 mt-1">
                    {a.department} · {a.rank} · {a.status}
                  </div>
                  {a.currentTask && (
                    <div className="font-mono text-[11px] text-zinc-300 mt-1 italic line-clamp-2">
                      "{a.currentTask[lang]}"
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
          <HiringQueue />
        </div>
        <section className="gx-card px-4 py-3">
          <div className="gx-label mb-1">
            {t('hr.recommendation.title')}
          </div>
          <div className="text-zinc-200 text-[13px] leading-snug">
            {lang === 'es'
              ? '«Génesis nació con 5 agentes. Recomiendo contratar al Agente de Debate cuando haya 5 decisiones registradas.»'
              : '"Genesis was born with 5 agents. I recommend hiring the Debate Agent once 5 decisions are recorded."'}
          </div>
        </section>
      </div>
    </main>
  );
}
