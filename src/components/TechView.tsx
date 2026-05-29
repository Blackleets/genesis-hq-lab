import { useMemo } from 'react';
import { useLanguage } from '../i18n/languageStore';
import { useActiveAgents, useEvents, useTasks } from '../state/genesisStore';

const DIVISION_COLOR = '#3da9fc';

const TECH_TASK_TYPES = new Set([
  'sprint_planning', 'code_review', 'qa_testing', 'deployment', 'bug_fix', 'system_check',
]);

function StatusBadge({ status, lang }: { status: string; lang: string }) {
  const cfg: Record<string, { label: { es: string; en: string }; color: string }> = {
    working:   { label: { es: 'En progreso', en: 'In progress' }, color: '#00ff9c' },
    assigned:  { label: { es: 'Asignado',    en: 'Assigned'    }, color: '#3da9fc' },
    queued:    { label: { es: 'Backlog',      en: 'Backlog'     }, color: '#4a5568' },
    completed: { label: { es: 'Entregado',   en: 'Done'        }, color: '#22d3ee' },
    failed:    { label: { es: 'Bloqueado',   en: 'Blocked'     }, color: '#ff4757' },
  };
  const c = cfg[status] ?? cfg['queued'];
  return (
    <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 border shrink-0"
      style={{ color: c.color, borderColor: `${c.color}44` }}>
      {c.label[lang as 'es' | 'en']}
    </span>
  );
}

export default function TechView() {
  const lang = useLanguage();
  const agents = useActiveAgents();
  const events = useEvents();
  const tasks = useTasks();

  const techAgents = useMemo(
    () => agents.filter((a) => ['Operations Room', 'Special Ops'].includes(a.department)),
    [agents],
  );

  const allTechTasks = useMemo(
    () => tasks.filter((t) => TECH_TASK_TYPES.has(t.type)),
    [tasks],
  );

  const backlog    = allTechTasks.filter((t) => t.status === 'queued');
  const inProgress = allTechTasks.filter((t) => t.status === 'working' || t.status === 'assigned' || t.status === 'moving');
  const done       = allTechTasks.filter((t) => t.status === 'completed').slice(-8).reverse();
  const blocked    = allTechTasks.filter((t) => t.status === 'failed' || t.status === 'blocked');

  const velocity = done.length;
  const successRate = allTechTasks.length > 0
    ? ((done.length / allTechTasks.length) * 100).toFixed(0)
    : null;

  // Recent tech events
  const techEvents = useMemo(() => {
    return [...events]
      .filter((e) => {
        const msg = e.message[lang as 'es' | 'en'].toLowerCase();
        return (
          msg.includes('deploy') || msg.includes('review') || msg.includes('test') ||
          msg.includes('bug') || msg.includes('sprint') || msg.includes('system')
        );
      })
      .reverse()
      .slice(0, 5);
  }, [events, lang]);

  const hasDivision = techAgents.length > 0;

  return (
    <main className="flex-1 min-w-0 min-h-0 overflow-y-auto px-8 py-8 bg-carbon-300">
      <div className="max-w-5xl mx-auto space-y-6">

        <header>
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: DIVISION_COLOR }} />
            <span className="font-mono text-[9px] uppercase tracking-widest text-zinc-500">
              Genesis HQ · {lang === 'es' ? 'División Tecnológica' : 'Tech Division'}
            </span>
          </div>
          <h1 className="font-mono text-3xl font-bold text-zinc-100">Tech Studio</h1>
          <p className="font-mono text-[12px] text-zinc-500 mt-1">
            {lang === 'es'
              ? 'Sprint board, code review, QA y deploys. Los agentes de ingeniería mantienen el sistema funcionando.'
              : 'Sprint board, code review, QA, and deployments. Engineering agents keep the system running.'}
          </p>
        </header>

        {!hasDivision && (
          <div className="border border-blue-400/40 bg-blue-500/5 px-5 py-4 font-mono">
            <div className="text-blue-300 text-[12px] font-bold mb-1">
              {lang === 'es' ? 'División sin personal' : 'Division unstaffed'}
            </div>
            <div className="text-blue-200/70 text-[11px] mb-3">
              {lang === 'es'
                ? 'Contrata a Sam CTO desde Fábrica de Agentes para activar operaciones tecnológicas.'
                : 'Hire Sam CTO from Agent Factory to activate tech operations.'}
            </div>
            <div className="flex gap-2 flex-wrap">
              {['Sam — CTO', 'Kai — Senior Dev', 'Nadia — QA'].map((name) => (
                <span key={name} className="font-mono text-[10px] border border-blue-400/30 text-blue-400 px-2 py-1">
                  + {name}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: lang === 'es' ? 'Backlog' : 'Backlog',               value: String(backlog.length),      color: '#9ca3af' },
            { label: lang === 'es' ? 'En Progreso' : 'In Progress',        value: String(inProgress.length),   color: DIVISION_COLOR },
            { label: lang === 'es' ? 'Entregados' : 'Delivered',            value: String(done.length),         color: '#00ff9c' },
            { label: lang === 'es' ? 'Bloqueados' : 'Blocked',              value: String(blocked.length),      color: '#ff4757' },
          ].map(({ label, value, color }) => (
            <div key={label} className="border border-trim bg-carbon-200 px-4 py-3">
              <div className="font-mono text-[9px] uppercase tracking-widest text-zinc-500">{label}</div>
              <div className="font-mono text-2xl font-bold mt-1" style={{ color }}>{value}</div>
            </div>
          ))}
        </div>

        {/* Sprint board */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Backlog */}
          <section className="border border-trim bg-carbon-200">
            <header className="px-3 py-2 border-b border-trim flex items-center gap-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-zinc-600" />
              <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-400">Backlog</span>
              <span className="font-mono text-[9px] text-zinc-600 ml-auto">{backlog.length}</span>
            </header>
            {backlog.length === 0 ? (
              <div className="px-3 py-4 font-mono text-[10px] text-zinc-600">—</div>
            ) : (
              <ul className="divide-y divide-trim">
                {backlog.slice(0, 6).map((t) => (
                  <li key={t.id} className="px-3 py-2">
                    <div className="font-mono text-[11px] text-zinc-300 leading-snug">{t.title[lang]}</div>
                    <div className="font-mono text-[8px] text-zinc-600 mt-0.5">{t.type.replace(/_/g, ' ')}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* In Progress */}
          <section className="border bg-carbon-200" style={{ borderColor: `${DIVISION_COLOR}44` }}>
            <header className="px-3 py-2 border-b flex items-center gap-2" style={{ borderColor: `${DIVISION_COLOR}33` }}>
              <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: DIVISION_COLOR }} />
              <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: DIVISION_COLOR }}>
                {lang === 'es' ? 'En Progreso' : 'In Progress'}
              </span>
              <span className="font-mono text-[9px] text-zinc-600 ml-auto">{inProgress.length}</span>
            </header>
            {inProgress.length === 0 ? (
              <div className="px-3 py-4 font-mono text-[10px] text-zinc-600">—</div>
            ) : (
              <ul className="divide-y divide-trim">
                {inProgress.map((t) => {
                  const agent = agents.find((a) => t.assignedAgentIds.includes(a.id));
                  return (
                    <li key={t.id} className="px-3 py-2.5">
                      <div className="flex items-start justify-between gap-1 mb-1">
                        <div className="font-mono text-[11px] text-zinc-100 leading-snug">{t.title[lang]}</div>
                        <StatusBadge status={t.status} lang={lang} />
                      </div>
                      <div className="font-mono text-[8px] text-zinc-600">
                        {t.type.replace(/_/g, ' ')}
                        {agent && ` · ${agent.name.split(' ')[0]}`}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Done */}
          <section className="border border-trim bg-carbon-200">
            <header className="px-3 py-2 border-b border-trim flex items-center gap-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-400">
                {lang === 'es' ? 'Entregado' : 'Done'}
              </span>
              <span className="font-mono text-[9px] text-zinc-600 ml-auto">{done.length}</span>
            </header>
            {done.length === 0 ? (
              <div className="px-3 py-4 font-mono text-[10px] text-zinc-600">—</div>
            ) : (
              <ul className="divide-y divide-trim">
                {done.slice(0, 6).map((t) => (
                  <li key={t.id} className="px-3 py-2">
                    <div className="font-mono text-[11px] text-zinc-400 leading-snug line-through">{t.title[lang]}</div>
                    <div className="font-mono text-[8px] text-zinc-600 mt-0.5">{t.type.replace(/_/g, ' ')}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Velocity + team */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <section className="border border-trim bg-carbon-200">
            <header className="px-4 py-2.5 border-b border-trim font-mono text-[11px] uppercase tracking-wider text-zinc-300">
              {lang === 'es' ? 'Métricas de Velocidad' : 'Velocity Metrics'}
            </header>
            <div className="grid grid-cols-2 divide-x divide-trim border-b border-trim">
              <div className="px-4 py-3">
                <div className="font-mono text-[9px] uppercase tracking-widest text-zinc-500">Velocity</div>
                <div className="font-mono text-2xl font-bold mt-1" style={{ color: DIVISION_COLOR }}>{velocity}</div>
                <div className="font-mono text-[9px] text-zinc-600">{lang === 'es' ? 'tareas entregadas' : 'tasks delivered'}</div>
              </div>
              <div className="px-4 py-3">
                <div className="font-mono text-[9px] uppercase tracking-widest text-zinc-500">
                  {lang === 'es' ? 'Tasa de éxito' : 'Success rate'}
                </div>
                <div className="font-mono text-2xl font-bold mt-1" style={{ color: successRate ? '#00ff9c' : '#4a5568' }}>
                  {successRate ? `${successRate}%` : '—'}
                </div>
                <div className="font-mono text-[9px] text-zinc-600">{lang === 'es' ? 'sin bloqueos' : 'no blockers'}</div>
              </div>
            </div>
            {techEvents.length > 0 && (
              <ul className="divide-y divide-trim">
                {techEvents.map((e) => (
                  <li key={e.id} className="px-4 py-2 font-mono text-[10px] text-zinc-400 leading-snug">
                    {e.message[lang as 'es' | 'en']}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="border border-trim bg-carbon-200">
            <header className="px-4 py-2.5 border-b border-trim font-mono text-[11px] uppercase tracking-wider text-zinc-300">
              {lang === 'es' ? 'Equipo de Ingeniería' : 'Engineering Team'}
            </header>
            {techAgents.length === 0 ? (
              <div className="px-4 py-5 font-mono text-[11px] text-zinc-600">
                {lang === 'es' ? 'Sin ingenieros contratados.' : 'No engineers hired.'}
              </div>
            ) : (
              <ul className="divide-y divide-trim">
                {techAgents.map((a) => {
                  const agentTask = tasks.find((t) =>
                    t.assignedAgentIds.includes(a.id) &&
                    (t.status === 'working' || t.status === 'assigned'),
                  );
                  return (
                    <li key={a.id} className="px-4 py-3 flex items-center justify-between gap-4">
                      <div>
                        <div className="font-mono text-[12px] text-zinc-100">{a.name}</div>
                        <div className="font-mono text-[9px] text-zinc-500 mt-0.5">
                          {typeof a.role === 'object' ? a.role[lang] : a.role}
                        </div>
                        {agentTask && (
                          <div className="font-mono text-[9px] mt-0.5" style={{ color: DIVISION_COLOR }}>
                            → {agentTask.title[lang]}
                          </div>
                        )}
                      </div>
                      <StatusBadge status={a.status} lang={lang} />
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
