// AutoView — goal → AI/keyword plan → execute as real tasks.

import { useState, type FormEvent } from 'react';
import { useT, useLanguage } from '@core/i18n/languageStore';
import { actions, useActiveAgents } from '@core/store/genesisStore';
import type { TaskType } from '@core/types/task';
import type { RoomId } from '@core/types/office';

type AutoTask = { title: { es: string; en: string }; type: TaskType; room: RoomId };

function generatePlan(goal: string): AutoTask[] {
  const g = goal.toLowerCase();
  if (g.includes('mercado') || g.includes('market')) return [
    { title: { es: 'Escanear señales de mercado',  en: 'Scan market signals'  }, type: 'market_scan',    room: 'market-desk'    },
    { title: { es: 'Revisar riesgo de exposición', en: 'Review exposure risk' }, type: 'risk_review',    room: 'risk-bunker'    },
    { title: { es: 'Archivar hallazgos',           en: 'Archive findings'     }, type: 'memory_archive', room: 'memory-archive' },
  ];
  if (g.includes('riesgo') || g.includes('risk')) return [
    { title: { es: 'Evaluación de riesgo',  en: 'Risk assessment'   }, type: 'risk_review',    room: 'risk-bunker'    },
    { title: { es: 'Consulta a la junta',   en: 'Board consultation'}, type: 'decision_review',room: 'board-room'     },
    { title: { es: 'Registro en memoria',   en: 'Memory entry'      }, type: 'memory_archive', room: 'memory-archive' },
  ];
  if (g.includes('decisi') || g.includes('decision') || g.includes('debate')) return [
    { title: { es: 'Recopilar contexto',      en: 'Gather context'      }, type: 'memory_archive', room: 'memory-archive' },
    { title: { es: 'Debate de posiciones',    en: 'Debate positions'    }, type: 'decision_review',room: 'debate-room'    },
    { title: { es: 'Ratificación en junta',  en: 'Board ratification'  }, type: 'decision_review',room: 'board-room'     },
  ];
  if (g.includes('memoria') || g.includes('memory') || g.includes('archivo') || g.includes('archive')) return [
    { title: { es: 'Catalogar datos',       en: 'Catalog data'   }, type: 'memory_archive', room: 'memory-archive' },
    { title: { es: 'Verificar integridad',  en: 'Verify integrity'}, type: 'system_check',   room: 'memory-archive' },
  ];
  return [
    { title: { es: 'Diagnóstico del sistema',   en: 'System diagnostics'    }, type: 'system_check',   room: 'open-workspace' },
    { title: { es: 'Revisión de plantilla',     en: 'Roster review'         }, type: 'hr_review',      room: 'hr-pod'         },
    { title: { es: 'Coordinación de ciclo',     en: 'Cycle coordination'    }, type: 'system_check',   room: 'open-workspace' },
  ];
}

export default function AutoView() {
  const t = useT();
  const lang = useLanguage();
  const agents = useActiveAgents();
  const [goal, setGoal] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [plan, setPlan] = useState<AutoTask[] | null>(null);
  const [executed, setExecuted] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [planSource, setPlanSource] = useState<'ai' | 'fallback' | null>(null);

  function toggleAgent(id: string) {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  async function handlePropose(e: FormEvent) {
    e.preventDefault();
    if (!goal.trim()) return;
    setPlanning(true);
    setPlan(null);
    setExecuted(false);
    setPlanSource(null);
    try {
      const res = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal: goal.trim() }),
      });
      if (res.ok) {
        const data = await res.json() as { ok: boolean; tasks: AutoTask[] };
        if (data.ok && Array.isArray(data.tasks) && data.tasks.length > 0) {
          setPlan(data.tasks);
          setPlanSource('ai');
          return;
        }
      }
    } catch {
      // network error — fall through to local fallback
    } finally {
      setPlanning(false);
    }
    // Fallback to local keyword plan
    setPlan(generatePlan(goal));
    setPlanSource('fallback');
  }

  function handleExecute() {
    if (!plan) return;
    plan.forEach((task) => {
      actions.createTask({
        title: task.title,
        description: { es: goal, en: goal },
        type: task.type,
        room: task.room,
        priority: 'normal',
        sourceModule: 'hq',
        assignedAgentIds: selectedIds,
        estimatedMs: 4 * 60 * 1000,
        isReal: true,
        isVisualSeed: false,
      });
    });
    setExecuted(true);
    setPlan(null);
    setGoal('');
    setSelectedIds([]);
  }

  return (
    <main className="flex-1 min-w-0 min-h-0 overflow-y-auto px-8 py-8 bg-carbon-300">
      <div className="max-w-2xl mx-auto space-y-6">
        <header>
          <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-500 mb-1">{t('header.title')}</div>
          <h1 className="font-mono text-2xl text-zinc-100">{t('auto.title')}</h1>
          <p className="font-mono text-[12px] text-zinc-500 mt-1">{t('auto.intro')}</p>
        </header>

        {executed && (
          <div className="border border-emerald-400/50 bg-emerald-500/10 px-4 py-3 font-mono text-[12px] text-emerald-200">
            ✓ {t('auto.success')}
          </div>
        )}

        <form onSubmit={handlePropose} className="gx-card p-5 space-y-4">
          <div>
            <label className="block gx-label mb-1">
              {t('auto.form.goal')}
            </label>
            <textarea
              value={goal}
              onChange={(e) => { setGoal(e.target.value); setPlan(null); setExecuted(false); }}
              rows={3}
              maxLength={300}
              required
              className="w-full gx-tile font-mono text-[13px] text-zinc-100 px-3 py-2 focus:outline-none focus:border-zinc-400 resize-none"
              placeholder={lang === 'es' ? 'ej. Analizar el mercado de criptomonedas esta semana' : 'e.g. Analyze the crypto market this week'}
            />
          </div>

          {agents.length > 0 && (
            <div>
              <div className="gx-label mb-2">
                {t('auto.form.agents')}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {agents.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => toggleAgent(a.id)}
                    className={`font-mono text-[11px] px-2.5 py-1 border transition ${
                      selectedIds.includes(a.id)
                        ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-200'
                        : 'border-trim text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {a.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <button type="submit" disabled={!goal.trim() || planning}
            className="font-mono text-[11px] uppercase tracking-wider px-4 py-2 border border-[#3da9fc]/60 text-[#3da9fc] hover:bg-[#3da9fc]/10 disabled:opacity-40 disabled:cursor-not-allowed">
            {planning
              ? (lang === 'es' ? 'Generando plan…' : 'Generating plan…')
              : t('auto.propose')}
          </button>
        </form>

        {plan && (
          <section className="gx-card p-5 space-y-3">
            <div className="flex items-center justify-between mb-2">
              <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-300">{t('auto.plan.title')}</div>
              {planSource === 'ai' && (
                <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 border border-emerald-400/40 text-emerald-400">
                  Claude AI
                </span>
              )}
              {planSource === 'fallback' && (
                <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 border border-zinc-600 text-zinc-500">
                  {lang === 'es' ? 'modo local' : 'local mode'}
                </span>
              )}
            </div>
            <ol className="space-y-2">
              {plan.map((task, i) => (
                <li key={i} className="flex items-start gap-3 font-mono text-[12px]">
                  <span className="text-zinc-600 w-4 shrink-0">{i + 1}.</span>
                  <div>
                    <div className="text-zinc-200">{task.title[lang]}</div>
                    <div className="text-zinc-500 text-[10px] mt-0.5">{task.type} → {task.room}</div>
                  </div>
                </li>
              ))}
            </ol>
            <button
              type="button"
              onClick={handleExecute}
              className="font-mono text-[11px] uppercase tracking-wider px-4 py-2 border border-emerald-400/60 text-emerald-300 bg-carbon-300 hover:bg-emerald-400/10"
            >
              {t('auto.execute')}
            </button>
          </section>
        )}
      </div>
    </main>
  );
}
