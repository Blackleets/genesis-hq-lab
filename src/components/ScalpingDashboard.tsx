// ScalpingDashboard — live visibility into the scalping fast system.
// Shows: open scalp positions with stop/take levels, training progress,
// 30-day gate conditions, circuit breaker status, daily P&L bars.

import { useEffect, useState } from 'react';
import { useLanguage } from '../i18n/languageStore';
import { agentClient } from '../lib/agentClient';
import type { TrainingResponse } from '../lib/agentClient';

// ─── Training gate condition row ─────────────────────────────────────────────

function GateRow({ condition }: { condition: { label: string; passed: boolean; value: string } }) {
  return (
    <li className="flex items-center justify-between gap-2 py-1.5 border-b border-trim last:border-b-0">
      <div className="flex items-center gap-2">
        <span
          className="font-mono text-[10px] shrink-0"
          style={{ color: condition.passed ? '#00ff9c' : '#ff4757' }}
        >
          {condition.passed ? '✓' : '✗'}
        </span>
        <span className="font-mono text-[10px] text-zinc-400">{condition.label}</span>
      </div>
      <span
        className="font-mono text-[9px] shrink-0"
        style={{ color: condition.passed ? '#00ff9c' : '#71717a' }}
      >
        {condition.value}
      </span>
    </li>
  );
}

// ─── Daily PnL mini-bars ─────────────────────────────────────────────────────

function DailyBars({ daily }: { daily: TrainingResponse['daily'] }) {
  if (daily.length === 0) return null;
  const maxAbs = Math.max(...daily.map(d => Math.abs(d.daily_pnl)), 1);

  return (
    <div className="flex items-end gap-0.5 h-10 mt-1">
      {daily.slice(-14).map((d, i) => {
        const pct = Math.abs(d.daily_pnl) / maxAbs;
        const pos = d.daily_pnl >= 0;
        return (
          <div key={i} className="flex-1 flex flex-col items-center justify-end h-full" title={`${d.day}: $${d.daily_pnl.toFixed(2)}`}>
            <div
              className="w-full rounded-sm"
              style={{
                height: `${Math.max(4, pct * 100)}%`,
                background: pos ? 'rgba(0,255,156,0.5)' : 'rgba(255,71,87,0.5)',
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

// ─── Main ScalpingDashboard ───────────────────────────────────────────────────

export default function ScalpingDashboard() {
  const lang = useLanguage();
  const [data, setData]   = useState<TrainingResponse | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    const res = await agentClient.getTraining();
    if (res?.ok) setData(res);
    setLoading(false);
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 15_000);  // refresh every 15s
    return () => clearInterval(id);
  }, []);

  if (loading) {
    return (
      <div className="border border-trim bg-carbon-200 px-4 py-6 font-mono text-[11px] text-zinc-600">
        {lang === 'es' ? 'Cargando sistema de scalping…' : 'Loading scalping system…'}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="border border-trim bg-carbon-200 px-4 py-4 font-mono text-[11px] text-amber-400/80">
        {lang === 'es'
          ? 'Backend no conectado. Ejecuta: npm run start'
          : 'Backend offline. Run: npm run start'}
      </div>
    );
  }

  const { training, daily, circuit, openScalps, openSwings } = data;

  const phaseColor = training.phase === 1 ? '#3da9fc'
                   : training.phase === 2 ? '#ffd24a'
                   : '#00ff9c';

  const progressPct = Math.min(100, (training.dayNumber / 30) * 100);

  return (
    <div className="space-y-4">

      {/* ── Training progress bar ── */}
      <section className="border border-trim bg-carbon-200">
        <header className="px-3 py-2 border-b border-trim flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className="font-mono text-[9px] px-1.5 py-0.5 border"
              style={{ color: phaseColor, borderColor: `${phaseColor}44` }}
            >
              {lang === 'es' ? `FASE ${training.phase}` : `PHASE ${training.phase}`}
            </span>
            <span className="font-mono text-[11px] text-zinc-300 uppercase tracking-wider">
              {training.phaseLabel}
            </span>
          </div>
          <span className="font-mono text-[10px] text-zinc-500">
            {lang === 'es' ? `Día ${training.dayNumber}/30` : `Day ${training.dayNumber}/30`}
          </span>
        </header>

        <div className="px-3 py-2.5">
          {/* Progress bar */}
          <div className="relative h-1.5 bg-carbon-300 rounded-full overflow-hidden mb-2">
            <div
              className="absolute left-0 top-0 h-full rounded-full transition-all duration-1000"
              style={{ width: `${progressPct}%`, background: phaseColor }}
            />
            {/* Phase boundaries */}
            {[33.3, 66.6].map((p) => (
              <div key={p} className="absolute top-0 h-full w-px bg-trim" style={{ left: `${p}%` }} />
            ))}
          </div>

          <p className="font-mono text-[10px] text-zinc-500 leading-snug">{training.phaseGoal}</p>

          {/* Key stats row */}
          <div className="grid grid-cols-4 gap-2 mt-2.5">
            {[
              { label: lang === 'es' ? 'Win Rate' : 'Win Rate', value: `${(training.stats.winRate * 100).toFixed(1)}%`, color: training.stats.winRate >= 0.55 ? '#00ff9c' : '#ffd24a' },
              { label: 'P&L', value: `$${training.stats.totalPnl.toFixed(2)}`, color: training.stats.totalPnl >= 0 ? '#00ff9c' : '#ff4757' },
              { label: lang === 'es' ? 'Trades' : 'Trades', value: `${training.stats.totalClosed}`, color: '#3da9fc' },
              { label: 'DD', value: `${(training.capital.maxDrawdown * 100).toFixed(1)}%`, color: training.capital.maxDrawdown <= 0.08 ? '#00ff9c' : training.capital.maxDrawdown <= 0.12 ? '#ffd24a' : '#ff4757' },
            ].map(({ label, value, color }) => (
              <div key={label} className="text-center">
                <div className="font-mono text-[13px] font-bold" style={{ color }}>{value}</div>
                <div className="font-mono text-[8px] text-zinc-600 uppercase tracking-wider mt-0.5">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Real money gate ── */}
      <section className="border bg-carbon-200" style={{ borderColor: training.gate.passed ? '#00ff9c40' : '#262d3d' }}>
        <header className="px-3 py-2 border-b border-trim flex items-center justify-between"
          style={{ borderColor: training.gate.passed ? '#00ff9c20' : undefined }}>
          <span className="font-mono text-[11px] uppercase tracking-wider"
            style={{ color: training.gate.passed ? '#00ff9c' : '#71717a' }}>
            {lang === 'es' ? 'Gate: Dinero Real' : 'Real Money Gate'}
          </span>
          <span className="font-mono text-[9px] text-zinc-500">
            {training.gate.passedCount}/{training.gate.totalChecks}
          </span>
        </header>
        <ul className="px-3 divide-y divide-trim">
          {training.gate.conditions.map((c) => <GateRow key={c.id} condition={c} />)}
        </ul>
        <div className={`px-3 py-2 border-t font-mono text-[10px] ${training.gate.passed ? 'text-emerald-300 border-emerald-400/20 bg-emerald-500/5' : 'text-zinc-500 border-trim'}`}>
          {training.gate.summary}
        </div>
      </section>

      {/* ── Scalp positions status ── */}
      <section className="border border-trim bg-carbon-200">
        <header className="px-3 py-2 border-b border-trim flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${openScalps > 0 ? 'genesis-status-dot' : ''}`}
              style={{ background: openScalps > 0 ? '#ffd24a' : '#3f3f46' }} />
            <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-300">
              {lang === 'es' ? 'Scalps activos' : 'Active scalps'}
            </span>
          </div>
          <div className="flex items-center gap-3 font-mono text-[9px]">
            <span style={{ color: '#ffd24a' }}>{openScalps} scalp</span>
            <span className="text-zinc-600">{openSwings} swing</span>
          </div>
        </header>

        {circuit.tripped ? (
          <div className="px-3 py-3 font-mono text-[10px] text-red-300 border-l-2 border-red-500 mx-3 my-2 bg-red-500/5">
            🛑 {lang === 'es' ? 'CIRCUIT BREAKER ACTIVO' : 'CIRCUIT BREAKER ACTIVE'}<br />
            <span className="text-zinc-500 text-[9px]">{circuit.reason}</span>
          </div>
        ) : (
          <div className="px-3 py-2 font-mono text-[9px] text-zinc-600">
            {lang === 'es'
              ? `Stop-loss/take-profit activo. TP +28% | SL -20%. Monitor cada 2 min.`
              : `Stop-loss/take-profit active. TP +28% | SL -20%. Monitor every 2 min.`}
            {circuit.consecutiveStopLosses > 0 && (
              <span className="text-amber-400 ml-2">
                ({circuit.consecutiveStopLosses} {lang === 'es' ? 'stop seguidos' : 'consecutive stops'})
              </span>
            )}
          </div>
        )}
      </section>

      {/* ── Daily P&L bars ── */}
      {daily.length > 0 && (
        <section className="border border-trim bg-carbon-200 px-3 py-2.5">
          <div className="font-mono text-[9px] uppercase tracking-wider text-zinc-600 mb-1">
            {lang === 'es' ? 'P&L diario (últimos 14 días)' : 'Daily P&L (last 14 days)'}
          </div>
          <DailyBars daily={daily} />
        </section>
      )}
    </div>
  );
}
