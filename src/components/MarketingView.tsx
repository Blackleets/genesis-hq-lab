import { useMemo } from 'react';
import { useLanguage } from '../i18n/languageStore';
import { useActiveAgents, useEvents, useTasks } from '../state/genesisStore';

const DIVISION_COLOR = '#f59e0b';

function KPICard({ label, value, sub, color = DIVISION_COLOR }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="border border-trim bg-carbon-200 px-4 py-3">
      <div className="font-mono text-[9px] uppercase tracking-widest text-zinc-500">{label}</div>
      <div className="font-mono text-2xl font-bold mt-1" style={{ color }}>{value}</div>
      {sub && <div className="font-mono text-[9px] text-zinc-600 mt-0.5">{sub}</div>}
    </div>
  );
}

function FunnelBar({ label, value, max, color = DIVISION_COLOR }: { label: string; value: number; max: number; color?: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div>
      <div className="flex justify-between font-mono text-[10px] mb-1">
        <span className="text-zinc-400 uppercase tracking-wider">{label}</span>
        <span className="text-zinc-200">{value.toLocaleString()}</span>
      </div>
      <div className="h-2 bg-carbon-300 border border-trim">
        <div style={{ width: `${pct}%`, background: color, height: '100%' }} />
      </div>
    </div>
  );
}

export default function MarketingView() {
  const lang = useLanguage();
  const agents = useActiveAgents();
  const events = useEvents();
  const tasks = useTasks();

  const marketingAgents = useMemo(
    () => agents.filter((a) => ['Growth Room', 'Design Studio'].includes(a.department)),
    [agents],
  );

  const marketingTasks = useMemo(
    () => tasks.filter((t) =>
      ['campaign_launch', 'content_creation', 'growth_analysis', 'seo_audit', 'ads_review'].includes(t.type)
    ),
    [tasks],
  );

  const activeCampaignTasks = marketingTasks.filter((t) => t.status === 'working' || t.status === 'assigned');
  const completedCampaigns = marketingTasks.filter((t) => t.status === 'completed').length;

  // Simulate funnel metrics based on agent learning scores and completed tasks
  const baseLearning = marketingAgents.length > 0
    ? marketingAgents.reduce((s, a) => s + a.learningScore, 0) / marketingAgents.length
    : 0;
  const seed = completedCampaigns * 12_400 + Math.floor(baseLearning * 45_000);
  const impressions = seed + 8_200;
  const clicks     = Math.floor(impressions * (0.07 + baseLearning * 0.04));
  const leads      = Math.floor(clicks * (0.03 + baseLearning * 0.02));
  const conversions = Math.floor(leads * (0.15 + baseLearning * 0.1));
  const ctr = impressions > 0 ? ((clicks / impressions) * 100).toFixed(1) : '—';

  // Marketing-related events
  const marketingEvents = useMemo(() => {
    const kinds = new Set(['task.completed', 'task.started', 'agent.hired']);
    return [...events]
      .filter((e) => kinds.has(e.kind) && (
        e.message[lang].toLowerCase().includes('campaign') ||
        e.message[lang].toLowerCase().includes('campaña') ||
        e.message[lang].toLowerCase().includes('content') ||
        e.message[lang].toLowerCase().includes('contenido') ||
        e.message[lang].toLowerCase().includes('growth') ||
        e.message[lang].toLowerCase().includes('seo') ||
        e.message[lang].toLowerCase().includes('marketing')
      ))
      .reverse()
      .slice(0, 5);
  }, [events, lang]);

  const hasDivision = marketingAgents.length > 0;

  return (
    <main className="flex-1 min-w-0 min-h-0 overflow-y-auto px-8 py-8 bg-carbon-300">
      <div className="max-w-5xl mx-auto space-y-6">

        {/* Header */}
        <header>
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: DIVISION_COLOR }} />
            <span className="font-mono text-[9px] uppercase tracking-widest text-zinc-500">
              Genesis HQ · {lang === 'es' ? 'División de Negocio' : 'Business Division'}
            </span>
          </div>
          <h1 className="font-mono text-3xl font-bold text-zinc-100">
            {lang === 'es' ? 'Marketing & Growth' : 'Marketing & Growth'}
          </h1>
          <p className="font-mono text-[12px] text-zinc-500 mt-1">
            {lang === 'es'
              ? 'Campañas, contenido y crecimiento. Los agentes gestionan el embudo de conversión en tiempo real.'
              : 'Campaigns, content, and growth. Agents manage the conversion funnel in real time.'}
          </p>
        </header>

        {/* No agents CTA */}
        {!hasDivision && (
          <div className="border border-amber-400/40 bg-amber-500/5 px-5 py-4 font-mono">
            <div className="text-amber-300 text-[12px] font-bold mb-1">
              {lang === 'es' ? 'División sin personal' : 'Division unstaffed'}
            </div>
            <div className="text-amber-200/70 text-[11px] mb-3">
              {lang === 'es'
                ? 'Contrata a Alex CMO desde Génesis HR → Fábrica de Agentes para activar las operaciones de marketing.'
                : 'Hire Alex CMO from Genesis HR → Agent Factory to activate marketing operations.'}
            </div>
            <div className="flex gap-2 flex-wrap">
              {['Alex — CMO', 'Maya — Content', 'Omar — Ads'].map((name) => (
                <span key={name} className="font-mono text-[10px] border border-amber-400/30 text-amber-400 px-2 py-1">
                  + {name}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* KPI row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KPICard label={lang === 'es' ? 'Impresiones' : 'Impressions'} value={hasDivision ? impressions.toLocaleString() : '—'} sub={lang === 'es' ? 'estimadas' : 'estimated'} />
          <KPICard label="CTR" value={hasDivision ? `${ctr}%` : '—'} sub={lang === 'es' ? 'tasa de clics' : 'click-through rate'} color="#fbbf24" />
          <KPICard label="Leads" value={hasDivision ? leads.toLocaleString() : '—'} sub={lang === 'es' ? 'generados' : 'generated'} color="#fb923c" />
          <KPICard label={lang === 'es' ? 'Conversiones' : 'Conversions'} value={hasDivision ? conversions.toLocaleString() : '—'} sub={lang === 'es' ? 'clientes nuevos' : 'new customers'} color="#00ff9c" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Funnel */}
          <section className="border border-trim bg-carbon-200">
            <header className="px-4 py-2.5 border-b border-trim flex items-center gap-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: DIVISION_COLOR }} />
              <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-300">
                {lang === 'es' ? 'Embudo de Conversión' : 'Conversion Funnel'}
              </span>
            </header>
            <div className="px-4 py-4 space-y-4">
              {hasDivision ? (
                <>
                  <FunnelBar label={lang === 'es' ? 'Impresiones' : 'Impressions'} value={impressions} max={impressions} />
                  <FunnelBar label="Clics / Clicks" value={clicks} max={impressions} color="#fbbf24" />
                  <FunnelBar label="Leads" value={leads} max={impressions} color="#fb923c" />
                  <FunnelBar label={lang === 'es' ? 'Conversiones' : 'Conversions'} value={conversions} max={impressions} color="#00ff9c" />
                  <div className="border-t border-trim pt-3 font-mono text-[10px] text-zinc-500">
                    {lang === 'es' ? 'Tasa de conversión final' : 'Final conversion rate'}:{' '}
                    <span className="text-zinc-200">
                      {impressions > 0 ? ((conversions / impressions) * 100).toFixed(2) : '0.00'}%
                    </span>
                  </div>
                </>
              ) : (
                <div className="font-mono text-[11px] text-zinc-600 py-4">
                  {lang === 'es' ? 'Requiere CMO activo para generar datos.' : 'Requires active CMO to generate data.'}
                </div>
              )}
            </div>
          </section>

          {/* Active campaigns */}
          <section className="border border-trim bg-carbon-200">
            <header className="px-4 py-2.5 border-b border-trim flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: DIVISION_COLOR }} />
                <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-300">
                  {lang === 'es' ? 'Campañas Activas' : 'Active Campaigns'}
                </span>
              </div>
              <span className="font-mono text-[10px] text-zinc-500">{activeCampaignTasks.length}</span>
            </header>
            {activeCampaignTasks.length === 0 ? (
              <div className="px-4 py-5 font-mono text-[11px] text-zinc-600">
                {lang === 'es' ? 'Sin campañas activas.' : 'No active campaigns.'}
              </div>
            ) : (
              <ul className="divide-y divide-trim">
                {activeCampaignTasks.map((task) => (
                  <li key={task.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-mono text-[12px] text-zinc-100 leading-snug">{task.title[lang]}</div>
                      <span
                        className="font-mono text-[9px] uppercase tracking-wider shrink-0 px-1.5 py-0.5 border"
                        style={{
                          color: task.status === 'working' ? '#00ff9c' : '#3da9fc',
                          borderColor: task.status === 'working' ? '#00ff9c44' : '#3da9fc44',
                        }}
                      >
                        {task.status === 'working' ? (lang === 'es' ? 'activa' : 'active') : (lang === 'es' ? 'asignada' : 'assigned')}
                      </span>
                    </div>
                    <div className="font-mono text-[9px] text-zinc-600 mt-1">{task.type.replace(/_/g, ' ')}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Marketing agents */}
        <section className="border border-trim bg-carbon-200">
          <header className="px-4 py-2.5 border-b border-trim font-mono text-[11px] uppercase tracking-wider text-zinc-300">
            {lang === 'es' ? 'Equipo de Marketing' : 'Marketing Team'}
          </header>
          {marketingAgents.length === 0 ? (
            <div className="px-4 py-5 font-mono text-[11px] text-zinc-600">
              {lang === 'es' ? 'Sin agentes de marketing contratados.' : 'No marketing agents hired.'}
            </div>
          ) : (
            <ul className="divide-y divide-trim">
              {marketingAgents.map((a) => {
                const agentTask = tasks.find((t) =>
                  t.assignedAgentIds.includes(a.id) &&
                  (t.status === 'working' || t.status === 'assigned'),
                );
                return (
                  <li key={a.id} className="px-4 py-3 flex items-center justify-between gap-4">
                    <div>
                      <div className="font-mono text-[12px] text-zinc-100">{a.name}</div>
                      <div className="font-mono text-[9px] text-zinc-500 mt-0.5">
                        {typeof a.role === 'object' ? a.role[lang] : a.role} · {a.department}
                      </div>
                      {agentTask && (
                        <div className="font-mono text-[9px] mt-0.5" style={{ color: DIVISION_COLOR }}>
                          → {agentTask.title[lang]}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span
                        className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 border"
                        style={{
                          color: a.status === 'working' ? '#00ff9c' : a.status === 'idle' ? '#4a5568' : '#3da9fc',
                          borderColor: a.status === 'working' ? '#00ff9c44' : '#27272a',
                        }}
                      >
                        {a.status}
                      </span>
                      <div className="font-mono text-[8px] text-zinc-600">
                        {(a.learningScore * 100).toFixed(0)}% {lang === 'es' ? 'aprendizaje' : 'learning'}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Recent activity */}
        {marketingEvents.length > 0 && (
          <section className="border border-trim bg-carbon-200">
            <header className="px-4 py-2.5 border-b border-trim font-mono text-[11px] uppercase tracking-wider text-zinc-300">
              {lang === 'es' ? 'Actividad Reciente' : 'Recent Activity'}
            </header>
            <ul className="divide-y divide-trim">
              {marketingEvents.map((e) => (
                <li key={e.id} className="px-4 py-2.5 flex items-start gap-2">
                  <span className="inline-block w-1.5 h-1.5 rounded-full mt-1 shrink-0" style={{ background: DIVISION_COLOR }} />
                  <span className="font-mono text-[11px] text-zinc-300 leading-snug">{e.message[lang]}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
