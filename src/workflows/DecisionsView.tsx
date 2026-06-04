// DecisionsView — decision log + create form + MiroFish AI debate per card.

import { useState, useEffect, type FormEvent } from 'react';
import { useT, useLanguage } from '@core/i18n/languageStore';
import { actions, useDecisions } from '@core/store/genesisStore';
import type { DecisionRecord } from '@core/store/genesisStore';
import { runQuickDebate, checkMiroFishHealth } from '@services/miroFishClient';
import type { DebateResult } from '@services/miroFishClient';
import { apiUrl } from '@services/apiBase';

// ── Agent Debates ──────────────────────────────────────────────────────────

interface AgentDebate {
  id: string;
  event_type: string;
  topic: string;
  summary: string;
  outcome: string;
  decision_made: string;
  created_at: string;
}

interface ParsedDecision {
  action?: string;
  confidence?: number;
  bull_confidence?: number;
  bear_confidence?: number;
  winner?: string;
}

function timeAgo(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  return `${Math.floor(diffHr / 24)}d`;
}

function AgentDebatesPanel() {
  const [debates, setDebates] = useState<AgentDebate[] | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchDebates() {
      try {
        const res = await fetch(apiUrl('/api/trading/debates?limit=10'));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { ok: boolean; debates: AgentDebate[] };
        if (!cancelled) {
          setDebates(data.debates ?? []);
          setOffline(false);
        }
      } catch {
        if (!cancelled) setOffline(true);
      }
    }

    void fetchDebates();
    const id = setInterval(() => { void fetchDebates(); }, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return (
    <section className="gx-card p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
        </span>
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-emerald-300">
          Debates del Agente · En vivo
        </span>
      </div>

      {/* Offline */}
      {offline && (
        <p className="font-mono text-[12px] text-zinc-500">Conectando con el agente...</p>
      )}

      {/* Loading */}
      {!offline && debates === null && (
        <p className="font-mono text-[12px] text-zinc-500">Cargando debates...</p>
      )}

      {/* Empty */}
      {!offline && debates !== null && debates.length === 0 && (
        <p className="font-mono text-[12px] text-zinc-500">
          Esperando primeros debates — el agente tarda 5 min en el primer ciclo
        </p>
      )}

      {/* Debate list */}
      {!offline && debates !== null && debates.length > 0 && (
        <ul className="space-y-2">
          {debates.map((debate) => {
            let parsed: ParsedDecision = {};
            try { parsed = JSON.parse(debate.decision_made) as ParsedDecision; } catch { /* ignore */ }
            const confidence = parsed.confidence !== undefined
              ? Math.round(parsed.confidence * 100)
              : null;
            const winner = parsed.winner ?? null;
            const isTrade = debate.outcome === 'TRADE';

            return (
              <li key={debate.id} className="gx-tile px-3 py-2 flex flex-col gap-1">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-mono text-[11px] text-zinc-200 leading-snug">
                    {debate.topic.length > 60
                      ? `${debate.topic.slice(0, 60)}…`
                      : debate.topic}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {/* Outcome badge */}
                    <span className={`font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 border ${
                      isTrade
                        ? 'border-emerald-400/60 text-emerald-300'
                        : 'border-zinc-500/60 text-zinc-400'
                    }`}>
                      {debate.outcome}
                    </span>
                    {/* Time ago */}
                    <span className="font-mono text-[10px] text-zinc-500">
                      {timeAgo(debate.created_at)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3 font-mono text-[10px]">
                  {confidence !== null && (
                    <span className="text-zinc-400">
                      Conf. <span className="text-zinc-200">{confidence}%</span>
                    </span>
                  )}
                  {winner && (
                    <span className={winner === 'bull' ? 'text-emerald-400' : 'text-red-400'}>
                      {winner === 'bull' ? '▲ Bull' : '▼ Bear'}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ── Founder Decision Card ──────────────────────────────────────────────────

function DecisionCard({ d }: { d: DecisionRecord }) {
  const lang = useLanguage();
  const t = useT();
  const [resolving, setResolving] = useState(false);
  const [outcome, setOutcome] = useState('');
  const [debating, setDebating] = useState(false);
  const [debateResult, setDebateResult] = useState<DebateResult | null>(null);
  const [debateError, setDebateError] = useState<string | null>(null);

  async function handleDebate() {
    setDebating(true);
    setDebateResult(null);
    setDebateError(null);
    try {
      const online = await checkMiroFishHealth();
      if (!online) {
        setDebateError(lang === 'es'
          ? 'MiroFish no está activo. Ejecuta: cd MiroFish && npm run backend'
          : 'MiroFish is offline. Run: cd MiroFish && npm run backend');
        return;
      }
      const context = `Option A: ${d.optionA}. Option B: ${d.optionB}. ${d.context ?? ''}`;
      const result = await runQuickDebate(d.title, context, 5);
      setDebateResult(result);
    } catch (e) {
      setDebateError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setDebating(false);
    }
  }

  return (
    <div className="gx-card p-4 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="font-mono text-sm text-zinc-100">{d.title}</div>
        <span className={`font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 border shrink-0 ${
          d.status === 'resolved'
            ? 'border-emerald-400/50 text-emerald-300'
            : 'border-amber-400/50 text-amber-300'
        }`}>
          {d.status === 'resolved' ? t('decisions.status.resolved') : t('decisions.status.pending')}
        </span>
      </div>
      {d.context && <p className="font-mono text-[11px] text-zinc-400 leading-snug">{d.context}</p>}
      <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
        <div className="gx-tile px-2 py-1.5">
          <div className="text-zinc-500 text-[9px] uppercase tracking-wider mb-0.5">{t('decisions.form.optionA')}</div>
          <div className="text-zinc-200">{d.optionA}</div>
        </div>
        <div className="gx-tile px-2 py-1.5">
          <div className="text-zinc-500 text-[9px] uppercase tracking-wider mb-0.5">{t('decisions.form.optionB')}</div>
          <div className="text-zinc-200">{d.optionB}</div>
        </div>
      </div>
      {d.status === 'resolved' && d.outcome && (
        <div className="font-mono text-[11px] text-emerald-300 border border-emerald-400/30 bg-emerald-500/5 px-2 py-1.5">
          {lang === 'es' ? 'Resultado:' : 'Outcome:'} {d.outcome}
        </div>
      )}
      {/* MiroFish debate button */}
      {d.status === 'pending' && !resolving && (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setResolving(true)}
            className="font-mono text-[10px] uppercase tracking-wider px-3 py-1 border border-zinc-500/60 text-zinc-300 hover:bg-white/5"
          >
            {t('decisions.resolve')}
          </button>
          <button
            type="button"
            onClick={() => { void handleDebate(); }}
            disabled={debating}
            className="font-mono text-[10px] uppercase tracking-wider px-3 py-1 border border-violet-400/60 text-violet-300 hover:bg-violet-400/10 disabled:opacity-40"
          >
            {debating
              ? (lang === 'es' ? '⟳ Debatiendo…' : '⟳ Debating…')
              : (lang === 'es' ? '⚡ Debate con IA' : '⚡ AI Debate')}
          </button>
        </div>
      )}

      {/* MiroFish debate error */}
      {debateError && (
        <div className="border border-red-400/40 bg-red-500/5 px-3 py-2 font-mono text-[11px] text-red-300">
          {debateError}
        </div>
      )}

      {/* MiroFish debate result */}
      {debateResult && (
        <div className="border border-violet-400/30 bg-violet-500/5 space-y-3 p-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-wider text-violet-400">
              MiroFish · {debateResult.agent_count} agents
            </span>
            <span
              className="font-mono text-[11px] uppercase tracking-wider px-2 py-0.5 border"
              style={{
                color: debateResult.recommendation === 'PASS' ? '#ffd24a'
                  : debateResult.recommendation === 'BUY_YES' ? '#00ff9c' : '#ff4757',
                borderColor: 'currentColor',
              }}
            >
              {debateResult.recommendation}
            </span>
          </div>
          <div className="flex gap-4 font-mono text-[11px]">
            <span style={{ color: '#00ff9c' }}>YES {debateResult.yes_count}</span>
            <span style={{ color: '#ff4757' }}>NO {debateResult.no_count}</span>
            <span className="text-zinc-400">
              {lang === 'es' ? 'Confianza' : 'Confidence'}: {(debateResult.confidence * 100).toFixed(0)}%
            </span>
          </div>
          <p className="font-mono text-[11px] text-zinc-300 leading-snug">{debateResult.summary}</p>
          <details className="font-mono text-[10px]">
            <summary className="text-zinc-500 cursor-pointer hover:text-zinc-300">
              {lang === 'es' ? 'Ver votos individuales' : 'Show individual votes'}
            </summary>
            <ul className="mt-2 space-y-1.5">
              {debateResult.votes.map((v) => (
                <li key={v.agent} className="flex gap-2 items-start">
                  <span
                    className="shrink-0 px-1.5 py-0.5 border text-[9px] uppercase"
                    style={{ color: v.vote === 'YES' ? '#00ff9c' : '#ff4757', borderColor: 'currentColor' }}
                  >
                    {v.vote}
                  </span>
                  <span className="text-violet-300">{v.agent}</span>
                  <span className="text-zinc-500 leading-snug">{v.reasoning}</span>
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
      {resolving && (
        <div className="flex gap-2">
          <input
            type="text"
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            placeholder={t('decisions.outcome')}
            className="flex-1 gx-tile font-mono text-[12px] text-zinc-100 px-2 py-1 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => { actions.resolveDecision(d.id, outcome); setResolving(false); }}
            disabled={!outcome.trim()}
            className="font-mono text-[10px] uppercase tracking-wider px-3 py-1 border border-emerald-400/60 text-emerald-300 hover:bg-emerald-400/10 disabled:opacity-40"
          >
            ✓
          </button>
          <button type="button" onClick={() => setResolving(false)}
            className="font-mono text-[10px] text-zinc-500 hover:text-zinc-300 px-2">✕</button>
        </div>
      )}
    </div>
  );
}

export default function DecisionsView() {
  const t = useT();
  const decisions = useDecisions();
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [context, setContext] = useState('');
  const [optionA, setOptionA] = useState('');
  const [optionB, setOptionB] = useState('');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !optionA.trim() || !optionB.trim()) return;
    actions.addDecision({ title: title.trim(), context: context.trim(), optionA: optionA.trim(), optionB: optionB.trim() });
    setTitle(''); setContext(''); setOptionA(''); setOptionB('');
    setShowForm(false);
  }

  return (
    <main className="flex-1 min-w-0 min-h-0 overflow-y-auto px-8 py-8 bg-carbon-300">
      <div className="max-w-3xl mx-auto space-y-6">
        <AgentDebatesPanel />

        <header className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-500 mb-1">{t('header.title')}</div>
            <h1 className="font-mono text-2xl text-zinc-100">{t('decisions.title')}</h1>
            <p className="font-mono text-[12px] text-zinc-500 mt-1">{t('decisions.hint')}</p>
          </div>
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="font-mono text-[11px] uppercase tracking-wider px-4 py-2 border border-emerald-400/60 text-emerald-300 bg-carbon-200 hover:bg-emerald-400/10"
          >
            {showForm ? '✕' : `+ ${t('decisions.new')}`}
          </button>
        </header>

        {showForm && (
          <form onSubmit={handleSubmit} className="border border-emerald-400/40 bg-carbon-200 p-5 space-y-3">
            <div className="font-mono text-[10px] uppercase tracking-wider text-emerald-300 mb-1">{t('decisions.new')}</div>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={80}
              placeholder={t('decisions.form.title')}
              className="w-full gx-tile font-mono text-[13px] text-zinc-100 px-3 py-2 focus:outline-none focus:border-zinc-400" />
            <textarea value={context} onChange={(e) => setContext(e.target.value)} rows={2} maxLength={300}
              placeholder={t('decisions.form.context')}
              className="w-full gx-tile font-mono text-[12px] text-zinc-100 px-3 py-2 focus:outline-none focus:border-zinc-400 resize-none" />
            <div className="grid grid-cols-2 gap-3">
              <input type="text" value={optionA} onChange={(e) => setOptionA(e.target.value)} required maxLength={60}
                placeholder={t('decisions.form.optionA')}
                className="gx-tile font-mono text-[12px] text-zinc-100 px-3 py-2 focus:outline-none focus:border-zinc-400" />
              <input type="text" value={optionB} onChange={(e) => setOptionB(e.target.value)} required maxLength={60}
                placeholder={t('decisions.form.optionB')}
                className="gx-tile font-mono text-[12px] text-zinc-100 px-3 py-2 focus:outline-none focus:border-zinc-400" />
            </div>
            <button type="submit" disabled={!title.trim() || !optionA.trim() || !optionB.trim()}
              className="font-mono text-[11px] uppercase tracking-wider px-4 py-2 border border-emerald-400/60 text-emerald-300 hover:bg-emerald-400/10 disabled:opacity-40 disabled:cursor-not-allowed">
              {t('decisions.submit')}
            </button>
          </form>
        )}

        {decisions.length === 0 && !showForm ? (
          <div className="font-mono text-[12px] text-zinc-500 py-4">{t('decisions.empty')}</div>
        ) : (
          <div className="space-y-3">
            {decisions.map((d) => <DecisionCard key={d.id} d={d} />)}
          </div>
        )}
      </div>
    </main>
  );
}
