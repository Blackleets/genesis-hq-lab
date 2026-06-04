// Hiring Queue — list of pending candidates with a real Hire action.
// Clicking Hire moves the candidate out of the queue into the active
// roster with status=onboarding (24h timer). HR Evaluator + Genesis Core
// also voice the event via the bubble layer.

import { useLanguage, useT } from '@core/i18n/languageStore';
import type { Lang } from '@core/i18n/translations';
import { actions, useHiringQueue } from '@core/store/genesisStore';

function stateClasses(state: string) {
  switch (state) {
    case 'visual-seed': return 'border-amber-400/40 text-amber-200 bg-amber-500/10';
    case 'pending':     return 'border-zinc-400/40 text-zinc-300 bg-zinc-500/10';
    case 'unlockable':  return 'border-emerald-400/50 text-emerald-200 bg-emerald-500/10';
    default:            return 'border-trim text-zinc-300 bg-carbon-300';
  }
}

function stateKey(s: string): import('@core/i18n/translations').TKey {
  if (s === 'visual-seed') return 'hiring.statusVisualSeed';
  if (s === 'unlockable')  return 'hiring.statusUnlocked';
  return 'hiring.statusPending';
}

export default function HiringQueue() {
  const t = useT();
  const lang: Lang = useLanguage();
  const queue = useHiringQueue();

  return (
    <section className="gx-card">
      <header className="gx-card-head flex items-center justify-between">
        <span className="gx-card-title">
          {t('hr.queue.title')}
        </span>
        <span className="font-mono text-[10px] text-zinc-500">{queue.length}</span>
      </header>
      {queue.length === 0 ? (
        <div className="px-4 py-6 font-mono text-[12px] text-zinc-500">{t('hiring.queueEmpty')}</div>
      ) : (
        <ul className="divide-y divide-trim">
          {queue.map((a) => (
            <li key={a.id} className="px-4 py-3">
              <div className="flex items-baseline justify-between gap-3 mb-1">
                <div className="font-mono text-sm text-zinc-100">{a.name[lang]}</div>
                <span className={`font-mono text-[9px] uppercase tracking-wider px-2 py-0.5 border ${stateClasses(a.state)}`}>
                  {t(stateKey(a.state))}
                </span>
              </div>
              <div className="font-mono text-[11px] text-zinc-400 mb-2">{a.role[lang]}</div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-600 mb-1">
                {t('hr.queue.condition')}
              </div>
              <div className="text-zinc-300 text-[12px] leading-snug mb-3">{a.unlockReason[lang]}</div>
              <button
                type="button"
                onClick={() => a.state === 'unlockable' && actions.hireAgent(a.id)}
                disabled={a.state !== 'unlockable'}
                className={`font-mono text-[10px] uppercase tracking-wider px-3 py-1.5 border ${
                  a.state === 'unlockable'
                    ? 'border-emerald-400/60 text-emerald-300 bg-carbon-300 hover:bg-emerald-400/10 cursor-pointer'
                    : 'border-zinc-600/40 text-zinc-600 bg-carbon-300 cursor-not-allowed'
                }`}
              >
                {t('hiring.hireButton')} →
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
