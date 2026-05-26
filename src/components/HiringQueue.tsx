// Hiring Queue — list of pending candidates with a real Hire action.
// Clicking Hire moves the candidate out of the queue into the active
// roster with status=onboarding (24h timer). HR Evaluator + Genesis Core
// also voice the event via the bubble layer.

import { useLanguage, useT } from '../i18n/languageStore';
import type { Lang } from '../i18n/translations';
import { actions, useHiringQueue } from '../state/genesisStore';

function stateClasses(state: string) {
  switch (state) {
    case 'visual-seed': return 'border-amber-400/40 text-amber-200 bg-amber-500/10';
    case 'pending':     return 'border-zinc-400/40 text-zinc-300 bg-zinc-500/10';
    case 'unlockable':  return 'border-emerald-400/50 text-emerald-200 bg-emerald-500/10';
    default:            return 'border-trim text-zinc-300 bg-carbon-300';
  }
}

function stateKey(s: string): import('../i18n/translations').TKey {
  if (s === 'visual-seed') return 'hiring.statusVisualSeed';
  if (s === 'unlockable')  return 'hiring.statusUnlocked';
  return 'hiring.statusPending';
}

export default function HiringQueue() {
  const t = useT();
  const lang: Lang = useLanguage();
  const queue = useHiringQueue();

  return (
    <section className="border border-trim bg-carbon-200">
      <header className="px-4 py-2.5 border-b border-trim flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-300">
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
                onClick={() => actions.hireAgent(a.id)}
                className="font-mono text-[10px] uppercase tracking-wider px-3 py-1.5 border border-emerald-400/60 text-emerald-300 bg-carbon-300 hover:bg-emerald-400/10"
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
