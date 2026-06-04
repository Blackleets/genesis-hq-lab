// Shows every agent currently in onboarding with a live countdown.
// Dev-mode adds an "Complete now" button per agent so we can validate
// the post-onboarding state without waiting 24h.

import { useEffect, useState } from 'react';
import { useLanguage, useT } from '@core/i18n/languageStore';
import { actions, useOnboardingAgents } from '@core/store/genesisStore';
import { pickRole } from '@agents/agentHelpers';

function formatRemaining(endsAt: string, now: number, lang: 'es' | 'en'): string {
  const ms = Math.max(0, Date.parse(endsAt) - now);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  if (h > 0) return `${h}${lang === 'es' ? 'h' : 'h'} ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export default function OnboardingPanel() {
  const t = useT();
  const lang = useLanguage();
  const agents = useOnboardingAgents();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);

  return (
    <section className="gx-card">
      <header className="gx-card-head flex items-center justify-between">
        <span className="gx-card-title">
          {t('onboarding.title')}
        </span>
        <span className="font-mono text-[10px] text-zinc-500">{agents.length}</span>
      </header>
      {agents.length === 0 ? (
        <div className="px-4 py-6 font-mono text-[12px] text-zinc-500">{t('onboarding.empty')}</div>
      ) : (
        <ul className="divide-y divide-trim">
          {agents.map((a) => {
            const ready = a.onboardingEndsAt && Date.parse(a.onboardingEndsAt) <= now;
            return (
              <li key={a.id} className="px-4 py-3">
                <div className="font-mono text-sm text-zinc-100">{a.name}</div>
                <div className="font-mono text-[11px] text-zinc-400">{pickRole(a.role, lang)}</div>
                <div className="font-mono text-[10px] text-zinc-600 mt-1">
                  {a.department}
                </div>
                <div className="mt-2 font-mono text-[11px]">
                  {a.onboardingEndsAt && (
                    <span className={ready ? 'text-emerald-300' : 'text-amber-300'}>
                      {ready
                        ? t('hiring.onboardingNow')
                        : `${t('hiring.onboardingIn')}: ${formatRemaining(a.onboardingEndsAt, now, lang)}`}
                    </span>
                  )}
                </div>
                <div className="mt-2 space-y-1 font-mono text-[10px] text-zinc-500">
                  <div>{t('onboarding.startedAt')}: {a.onboardingStartedAt ?? '—'}</div>
                  <div>{t('onboarding.endsAt')}: {a.onboardingEndsAt ?? '—'}</div>
                </div>
                <button
                  type="button"
                  onClick={() => actions.completeOnboarding(a.id)}
                  className="mt-3 font-mono text-[10px] uppercase tracking-wider px-2.5 py-1 border border-emerald-400/60 text-emerald-300 bg-carbon-300 hover:bg-emerald-400/10"
                >
                  {t('hiring.completeNow')}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <footer className="px-4 py-2 font-mono text-[10px] text-zinc-600 border-t border-trim leading-snug">
        {t('onboarding.duration')} · {t('onboarding.hint')}
      </footer>
    </section>
  );
}
