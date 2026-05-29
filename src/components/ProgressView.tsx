import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useLanguage } from '../i18n/languageStore';
import { useActiveAgents, useEvents, useTasks, useTradingStats } from '../state/genesisStore';
import { useProgress } from '../lib/progressEngine';
import CapitalChart from './charts/CapitalChart';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border border-trim bg-carbon-200">
      <header className="px-4 py-2.5 border-b border-trim font-mono text-[11px] uppercase tracking-wider text-zinc-300">
        {title}
      </header>
      {children}
    </section>
  );
}

export default function ProgressView() {
  const lang = useLanguage();
  const agents = useActiveAgents();
  const events = useEvents();
  const tasks = useTasks();
  const progress = useProgress();
  const tradingStats = useTradingStats();

  const learningData = useMemo(
    () =>
      [...agents]
        .sort((a, b) => b.learningScore - a.learningScore)
        .map((a) => ({
          name: a.name.split(' ')[0],
          score: Math.round(a.learningScore * 100),
          rank: a.rank,
        })),
    [agents]
  );

  const taskCompletionData = useMemo(() => {
    const completed = events.filter((e) => e.kind === 'task.completed').length;
    const failed = events.filter((e) => e.kind === 'task.failed').length;
    const active = tasks.filter((t) => t.status === 'working' || t.status === 'assigned').length;
    const queued = tasks.filter((t) => t.status === 'queued').length;
    return [
      { name: lang === 'es' ? 'Completadas' : 'Completed', value: completed, color: '#00ff9c' },
      { name: lang === 'es' ? 'Fallidas' : 'Failed', value: failed, color: '#ff4757' },
      { name: lang === 'es' ? 'Activas' : 'Active', value: active, color: '#3da9fc' },
      { name: lang === 'es' ? 'En cola' : 'Queued', value: queued, color: '#9ca3af' },
    ];
  }, [events, tasks, lang]);

  const milestones = useMemo(() => {
    const kinds = new Set([
      'module.unlocked', 'agent.promoted', 'agent.hired', 'agent.fired', 'agent.auto_fired',
      'trade.profit', 'trade.loss', 'office.upgrade.completed',
    ]);
    return [...events]
      .filter((e) => kinds.has(e.kind))
      .reverse()
      .slice(0, 15);
  }, [events]);

  return (
    <main className="flex-1 min-w-0 min-h-0 overflow-y-auto px-8 py-8 bg-carbon-300">
      <div className="max-w-5xl mx-auto space-y-6">
        <header>
          <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-500 mb-1">Genesis HQ</div>
          <h1 className="font-mono text-2xl text-zinc-100">
            {lang === 'es' ? 'Progreso de Génesis' : 'Genesis Progress'}
          </h1>
          <p className="font-mono text-[12px] text-zinc-500 mt-1">
            {lang === 'es' ? 'Métricas reales de crecimiento — sin datos inventados.' : 'Real growth metrics — no fabricated data.'}
          </p>
        </header>

        {/* Top metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: lang === 'es' ? 'Edad' : 'Age', value: `${progress.ageHours.toFixed(1)}h`, color: '#ffd24a' },
            { label: lang === 'es' ? 'Agentes' : 'Agents', value: String(progress.activeAgents), color: '#00ff9c' },
            { label: lang === 'es' ? 'Aprendizaje' : 'Learning', value: `${(progress.learningLevel * 100).toFixed(0)}%`, color: '#22d3ee' },
            { label: lang === 'es' ? 'Salud' : 'Health', value: `${(progress.companyHealth * 100).toFixed(0)}%`, color: '#3da9fc' },
          ].map(({ label, value, color }) => (
            <div key={label} className="border border-trim bg-carbon-200 px-4 py-3">
              <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
              <div className="font-mono text-2xl mt-1" style={{ color }}>{value}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Task funnel */}
          <Section title={lang === 'es' ? 'Estado de tareas' : 'Task status'}>
            <div className="px-2 py-3">
              <ResponsiveContainer width="100%" height={120}>
                <BarChart data={taskCompletionData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <XAxis dataKey="name" tick={{ fill: '#6b7280', fontSize: 9, fontFamily: 'monospace' }} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <Tooltip
                    contentStyle={{ background: '#18181b', border: '1px solid #27272a', borderRadius: 0, fontSize: 10, fontFamily: 'monospace', color: '#e4e4e7' }}
                  />
                  <Bar dataKey="value" radius={0} isAnimationActive={false}>
                    {taskCompletionData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} fillOpacity={0.8} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Section>

          {/* Trading stats */}
          <Section title={lang === 'es' ? 'Trading P&L' : 'Trading P&L'}>
            <CapitalChart />
            <div className="grid grid-cols-3 border-t border-trim">
              {[
                { label: 'Trades', value: String(tradingStats.totalTrades), color: '#3da9fc' },
                { label: 'Win rate', value: tradingStats.totalTrades > 0 ? `${(tradingStats.winRate * 100).toFixed(0)}%` : '—', color: '#ffd24a' },
                { label: 'P&L', value: `${tradingStats.totalPnL >= 0 ? '+' : ''}$${tradingStats.totalPnL.toFixed(0)}`, color: tradingStats.totalPnL >= 0 ? '#00ff9c' : '#ff4757' },
              ].map(({ label, value, color }) => (
                <div key={label} className="px-4 py-2 border-r border-trim last:border-r-0">
                  <div className="font-mono text-[9px] uppercase tracking-wider text-zinc-600">{label}</div>
                  <div className="font-mono text-sm mt-0.5" style={{ color }}>{value}</div>
                </div>
              ))}
            </div>
          </Section>
        </div>

        {/* Learning scores */}
        {learningData.length > 0 && (
          <Section title={lang === 'es' ? 'Scores de aprendizaje' : 'Learning scores'}>
            <div className="px-2 py-3">
              <ResponsiveContainer width="100%" height={Math.max(80, learningData.length * 24)}>
                <BarChart data={learningData} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 0 }}>
                  <XAxis type="number" domain={[0, 100]} tick={{ fill: '#4a5568', fontSize: 9, fontFamily: 'monospace' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
                  <YAxis type="category" dataKey="name" tick={{ fill: '#9ca3af', fontSize: 9, fontFamily: 'monospace' }} axisLine={false} tickLine={false} width={52} />
                  <Tooltip
                    contentStyle={{ background: '#18181b', border: '1px solid #27272a', borderRadius: 0, fontSize: 10, fontFamily: 'monospace', color: '#e4e4e7' }}
                    formatter={(v) => [`${v}%`, lang === 'es' ? 'Aprendizaje' : 'Learning']}
                  />
                  <Bar dataKey="score" radius={0} isAnimationActive={false}>
                    {learningData.map((entry) => (
                      <Cell
                        key={entry.name}
                        fill={entry.score >= 80 ? '#00ff9c' : entry.score >= 60 ? '#3da9fc' : entry.score >= 40 ? '#ffd24a' : '#ff4757'}
                        fillOpacity={0.8}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Section>
        )}

        {/* Milestones */}
        <Section title={lang === 'es' ? 'Hitos de Génesis' : 'Genesis milestones'}>
          {milestones.length === 0 ? (
            <div className="px-4 py-6 font-mono text-[12px] text-zinc-600">
              {lang === 'es' ? 'Aún no hay hitos registrados.' : 'No milestones recorded yet.'}
            </div>
          ) : (
            <ul className="divide-y divide-trim">
              {milestones.map((e) => {
                const dotColor =
                  e.kind === 'trade.profit' || e.kind === 'module.unlocked' || e.kind === 'agent.promoted' || e.kind === 'agent.hired' || e.kind === 'office.upgrade.completed' ? '#00ff9c'
                  : e.kind === 'agent.auto_fired' || e.kind === 'agent.fired' || e.kind === 'trade.loss' ? '#ff4757'
                  : '#3da9fc';
                const ts = new Date(e.at);
                const timeLabel = ts.toLocaleString(lang === 'es' ? 'es-ES' : 'en-US', {
                  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                });
                return (
                  <li key={e.id} className="px-4 py-2.5 flex items-start gap-2.5 font-mono text-[11px]">
                    <span className="inline-block w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ background: dotColor }} />
                    <div className="flex-1 text-zinc-300 leading-snug">{e.message[lang]}</div>
                    <span className="text-zinc-600 text-[9px] shrink-0 whitespace-nowrap">{timeLabel}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      </div>
    </main>
  );
}
