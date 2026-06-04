// CommandConsole — write a command, agents execute it immediately.
// Unlike AutoView, there is no "review plan" step: execute fires right away.

import { useState, useEffect, useRef } from 'react';
import { useLanguage } from '@core/i18n/languageStore';
import {
  actions,
  useActiveAgents,
  useCommandHistory,
  useTasks,
  type CommandHistoryEntry,
} from '@core/store/genesisStore';
import type { TaskType } from '@core/types/task';
import type { RoomId } from '@core/types/office';

type ConsoleTask = { title: { es: string; en: string }; type: TaskType; room: RoomId };

// Local fallback planner (same as AutoView's generatePlan)
function localPlan(goal: string): ConsoleTask[] {
  const g = goal.toLowerCase();
  if (g.includes('mercado') || g.includes('market')) return [
    { title: { es: 'Escanear señales de mercado', en: 'Scan market signals' }, type: 'market_scan', room: 'market-desk' },
    { title: { es: 'Revisar riesgo de exposición', en: 'Review exposure risk' }, type: 'risk_review', room: 'risk-bunker' },
    { title: { es: 'Archivar hallazgos', en: 'Archive findings' }, type: 'memory_archive', room: 'memory-archive' },
  ];
  if (g.includes('riesgo') || g.includes('risk')) return [
    { title: { es: 'Evaluación de riesgo', en: 'Risk assessment' }, type: 'risk_review', room: 'risk-bunker' },
    { title: { es: 'Consulta a la junta', en: 'Board consultation' }, type: 'decision_review', room: 'board-room' },
    { title: { es: 'Registro en memoria', en: 'Memory entry' }, type: 'memory_archive', room: 'memory-archive' },
  ];
  if (g.includes('marketing') || g.includes('campa') || g.includes('campaign')) return [
    { title: { es: 'Análisis de crecimiento', en: 'Growth analysis' }, type: 'growth_analysis', room: 'open-workspace' },
    { title: { es: 'Creación de contenido', en: 'Content creation' }, type: 'content_creation', room: 'open-workspace' },
    { title: { es: 'Revisar métricas de ads', en: 'Review ads metrics' }, type: 'ads_review', room: 'open-workspace' },
  ];
  if (g.includes('hr') || g.includes('contratar') || g.includes('hire') || g.includes('equipo')) return [
    { title: { es: 'Revisar candidatos', en: 'Review candidates' }, type: 'hr_review', room: 'hr-pod' },
    { title: { es: 'Evaluación de desempeño', en: 'Performance evaluation' }, type: 'performance_review', room: 'hr-pod' },
  ];
  if (g.includes('tech') || g.includes('deploy') || g.includes('codigo') || g.includes('code')) return [
    { title: { es: 'Revisión de código', en: 'Code review' }, type: 'code_review', room: 'open-workspace' },
    { title: { es: 'Pruebas de calidad', en: 'QA testing' }, type: 'qa_testing', room: 'open-workspace' },
    { title: { es: 'Despliegue', en: 'Deployment' }, type: 'deployment', room: 'execution-desk' },
  ];
  return [
    { title: { es: 'Diagnóstico del sistema', en: 'System diagnostics' }, type: 'system_check', room: 'open-workspace' },
    { title: { es: 'Revisión de equipo', en: 'Roster review' }, type: 'hr_review', room: 'hr-pod' },
    { title: { es: 'Coordinación general', en: 'General coordination' }, type: 'system_check', room: 'board-room' },
  ];
}

function taskStatusIcon(status: string) {
  if (status === 'completed') return '✓';
  if (status === 'failed' || status === 'blocked') return '✗';
  if (status === 'working') return '●';
  if (status === 'assigned' || status === 'moving') return '○';
  return '·';
}

function taskStatusColor(status: string) {
  if (status === 'completed') return '#00ff9c';
  if (status === 'failed' || status === 'blocked') return '#ff4757';
  if (status === 'working') return '#3da9fc';
  if (status === 'assigned' || status === 'moving') return '#ffd24a';
  return '#4a5568';
}

function HistoryItem({
  entry, isActive, onClick, lang,
}: { entry: CommandHistoryEntry; isActive: boolean; onClick: () => void; lang: string }) {
  const ts = new Date(entry.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 border-b border-trim font-mono text-[11px] hover:bg-white/5 ${isActive ? 'bg-white/5 border-l-2' : ''}`}
      style={isActive ? { borderLeftColor: '#3da9fc' } : undefined}
    >
      <div className="flex items-center justify-between gap-2 mb-0.5">
        <span className="text-zinc-400 text-[9px]">{ts}</span>
        <span
          className="text-[9px] uppercase tracking-wider"
          style={{
            color: entry.status === 'done' ? '#00ff9c'
              : entry.status === 'running' ? '#3da9fc'
                : '#ffd24a',
          }}
        >
          {entry.status === 'done' ? (lang === 'es' ? 'listo' : 'done')
            : entry.status === 'running' ? (lang === 'es' ? 'corriendo' : 'running')
              : (lang === 'es' ? 'parcial' : 'partial')}
        </span>
      </div>
      <div className="text-zinc-200 leading-snug truncate">{entry.command}</div>
      <div className="text-zinc-600 text-[9px] mt-0.5">
        {entry.taskIds.length} {lang === 'es' ? 'tarea(s)' : 'task(s)'}
      </div>
    </button>
  );
}

export default function CommandConsole() {
  const lang = useLanguage();
  const agents = useActiveAgents();
  const allTasks = useTasks();
  const history = useCommandHistory();

  const [command, setCommand] = useState('');
  const [executing, setExecuting] = useState(false);
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Tasks for the selected history entry
  const activeTasks = activeHistoryId
    ? Object.values(allTasks).filter((t) =>
      history.find((h) => h.id === activeHistoryId)?.taskIds.includes(t.id)
    )
    : [];

  // Auto-update history status when tasks complete
  useEffect(() => {
    for (const entry of history) {
      if (entry.status !== 'running') continue;
      const entryTasks = Object.values(allTasks).filter((t) => entry.taskIds.includes(t.id));
      if (entryTasks.length === 0) continue;
      const allDone = entryTasks.every((t) => t.status === 'completed' || t.status === 'failed' || t.status === 'archived');
      if (allDone) {
        const anyFailed = entryTasks.some((t) => t.status === 'failed');
        actions.updateCommandStatus(entry.id, anyFailed ? 'partial' : 'done');
      }
    }
  }, [allTasks, history]);

  async function handleExecute() {
    const trimmed = command.trim();
    if (!trimmed || executing) return;
    setExecuting(true);

    let plan: ConsoleTask[];
    try {
      const res = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal: trimmed }),
      });
      if (res.ok) {
        const data = await res.json() as { ok: boolean; tasks: ConsoleTask[] };
        plan = data.ok && data.tasks?.length > 0 ? data.tasks : localPlan(trimmed);
      } else {
        plan = localPlan(trimmed);
      }
    } catch {
      plan = localPlan(trimmed);
    } finally {
      setExecuting(false);
    }

    // Find agents to assign automatically by capabilities
    const capableAgentIds = agents
      .filter((a) => a.status === 'idle' || a.status === 'working')
      .slice(0, 3)
      .map((a) => a.id);

    const taskIds: string[] = [];
    for (const task of plan) {
      const id = actions.createTask({
        title: task.title,
        description: { es: trimmed, en: trimmed },
        type: task.type,
        room: task.room,
        priority: 'high',
        sourceModule: 'console',
        assignedAgentIds: capableAgentIds,
        estimatedMs: 3 * 60 * 1000,
        isReal: true,
        isVisualSeed: false,
      });
      taskIds.push(id);
    }

    const entry: CommandHistoryEntry = {
      id: `cmd-hist-${Date.now()}`,
      at: new Date().toISOString(),
      command: trimmed,
      taskIds,
      status: 'running',
    };
    actions.addCommandHistory(entry);
    setActiveHistoryId(entry.id);
    setCommand('');
  }

  return (
    <main className="flex-1 min-w-0 min-h-0 overflow-hidden flex flex-col bg-carbon-300">
      {/* Header */}
      <div className="shrink-0 px-6 py-4 border-b border-trim bg-carbon-200">
        <div className="flex items-center gap-2 mb-1">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="gx-overline">
            Genesis HQ · {lang === 'es' ? 'Consola de Delegación' : 'Delegation Console'}
          </span>
        </div>
        <h1 className="font-mono text-2xl font-bold text-zinc-100">
          {lang === 'es' ? 'Consola de Comandos' : 'Command Console'}
        </h1>
        <p className="font-mono text-[12px] text-zinc-500 mt-0.5">
          {lang === 'es'
            ? 'Escribe qué quieres lograr. Los agentes lo ejecutan de inmediato.'
            : 'Write what you want to achieve. Agents execute it immediately.'}
        </p>
      </div>

      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Left: history + input */}
        <div className="w-[340px] shrink-0 border-r border-trim flex flex-col">
          {/* History list */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {history.length === 0 ? (
              <div className="px-4 py-6 font-mono text-[11px] text-zinc-600">
                {lang === 'es' ? 'Sin comandos aún. Escribe el primero.' : 'No commands yet. Write the first one.'}
              </div>
            ) : (
              history.map((entry) => (
                <HistoryItem
                  key={entry.id}
                  entry={entry}
                  isActive={activeHistoryId === entry.id}
                  onClick={() => setActiveHistoryId(entry.id)}
                  lang={lang}
                />
              ))
            )}
          </div>

          {/* Command input */}
          <div className="shrink-0 border-t border-trim p-3 bg-carbon-200">
            <textarea
              ref={textareaRef}
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void handleExecute();
                }
              }}
              rows={3}
              maxLength={400}
              placeholder={lang === 'es'
                ? 'ej. Analizar el mercado de criptomonedas y evaluar riesgos…'
                : 'e.g. Analyze the crypto market and evaluate risks…'}
              className="w-full gx-tile font-mono text-[12px] text-zinc-100 px-3 py-2 focus:outline-none focus:border-zinc-400 resize-none"
            />
            <div className="flex items-center justify-between mt-2">
              <span className="font-mono text-[9px] text-zinc-600">
                {lang === 'es' ? '⌘↵ para ejecutar' : '⌘↵ to execute'}
              </span>
              <button
                type="button"
                disabled={!command.trim() || executing}
                onClick={() => void handleExecute()}
                className="font-mono text-[11px] uppercase tracking-wider px-4 py-1.5 border border-emerald-400/60 text-emerald-300 hover:bg-emerald-400/10 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {executing && (
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                )}
                {executing
                  ? (lang === 'es' ? 'Planificando…' : 'Planning…')
                  : (lang === 'es' ? 'Ejecutar →' : 'Execute →')}
              </button>
            </div>
          </div>
        </div>

        {/* Right: live execution panel */}
        <div className="flex-1 min-w-0 overflow-y-auto">
          {!activeHistoryId ? (
            <div className="flex items-center justify-center h-full font-mono text-[12px] text-zinc-600 px-8 text-center">
              {lang === 'es'
                ? 'Escribe un comando y presiona Ejecutar para ver el trabajo en tiempo real.'
                : 'Write a command and press Execute to see work happen in real time.'}
            </div>
          ) : activeTasks.length === 0 ? (
            <div className="px-6 py-6 font-mono text-[11px] text-zinc-600">
              {lang === 'es' ? 'Cargando tareas…' : 'Loading tasks…'}
            </div>
          ) : (
            <div className="px-6 py-5 space-y-3">
              <div className="gx-overline mb-4">
                {lang === 'es' ? 'Ejecución en vivo' : 'Live execution'}
                {' · '}
                {activeTasks.filter((t) => t.status === 'completed').length}/{activeTasks.length}
                {' '}{lang === 'es' ? 'completadas' : 'completed'}
              </div>

              {activeTasks.map((task) => {
                const assignedAgent = agents.find((a) => task.assignedAgentIds.includes(a.id));
                const progress = task.status === 'working' && task.startedAt && task.estimatedMs
                  ? Math.max(0, Math.min(1, (now - new Date(task.startedAt).getTime()) / task.estimatedMs))
                  : task.status === 'completed' ? 1
                    : 0;

                return (
                  <div key={task.id} className="gx-card p-4">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div>
                        <div className="font-mono text-[12px] text-zinc-100 leading-snug">{task.title[lang]}</div>
                        <div className="font-mono text-[9px] text-zinc-600 mt-0.5">
                          {task.type.replace(/_/g, ' ')} · {task.room}
                        </div>
                      </div>
                      <span
                        className="font-mono text-[18px] shrink-0 leading-none mt-0.5"
                        style={{ color: taskStatusColor(task.status) }}
                      >
                        {taskStatusIcon(task.status)}
                      </span>
                    </div>

                    {/* Progress bar */}
                    {(task.status === 'working' || task.status === 'completed') && (
                      <div className="h-1 bg-carbon-300 mb-2">
                        <div
                          style={{
                            width: `${Math.round(progress * 100)}%`,
                            background: task.status === 'completed' ? '#00ff9c' : '#3da9fc',
                            height: '100%',
                            transition: 'width 0.5s',
                          }}
                        />
                      </div>
                    )}

                    {/* Agent */}
                    {assignedAgent && (
                      <div className="flex items-center gap-2 font-mono text-[10px]">
                        <span
                          className="inline-block w-1.5 h-1.5 rounded-full"
                          style={{ background: taskStatusColor(task.status) }}
                        />
                        <span className="text-zinc-400">{assignedAgent.name}</span>
                        <span className="text-zinc-600">
                          {task.status === 'completed'
                            ? (lang === 'es' ? '— completado' : '— completed')
                            : task.status === 'working'
                              ? (lang === 'es' ? `— ${Math.round(progress * 100)}%` : `— ${Math.round(progress * 100)}%`)
                              : `— ${task.status}`}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
