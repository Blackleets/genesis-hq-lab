// Genesis HQ Lab — app shell wired to the Genesis Life Operating System.
// All state comes from src/state/genesisStore (persisted to localStorage).
// Every 5 seconds we call actions.tick() to advance movement, complete
// onboarding timers, start/complete tasks, etc.

import { useEffect, useState } from 'react';
import GenesisHeader from './components/GenesisHeader';
import GenesisSidebar from './components/GenesisSidebar';
import OfficeViewport from './components/OfficeViewport';
import GenesisOfficeWorld from './components/GenesisOfficeWorld';
import PixelOfficeCanvas from './components/PixelOfficeCanvas';
import PixelOfficeViewport from './components/PixelOfficeViewport';
import LiveActivityFeed from './components/LiveActivityFeed';
import AgentInspector from './components/AgentInspector';
import AgentTooltip from './components/AgentTooltip';
import ModulePlaceholder from './components/ModulePlaceholder';
import HiringQueue from './components/HiringQueue';
import OnboardingPanel from './components/OnboardingPanel';
import WorkScreen from './components/WorkScreen';
import GenesisDashboard from './components/GenesisDashboard';
import MarketsView from './components/MarketsView';
import TopBar from './components/TopBar';
import WalletView from './components/WalletView';
import ProgressView from './components/ProgressView';
import MarketingView from './components/MarketingView';
import TechView from './components/TechView';
import CommandConsole from './components/CommandConsole';
import ConnectorsPanel from './components/ConnectorsPanel';
import IntegrationsView from './components/IntegrationsView';
import ToastContainer from './components/ToastContainer';
import type { DebateResult } from './lib/miroFishClient';
import { runQuickDebate, checkMiroFishHealth } from './lib/miroFishClient';

import { setLanguage, useLanguage, useT } from './i18n/languageStore';
import {
  actions,
  useActiveAgents,
  useAgents,
  useDecisions,
  useDevMode,
  useSelectedAgent,
  useSelectedModule,
} from './state/genesisStore';
import type { DecisionRecord } from './state/genesisStore';
import { useLiveBubbles } from './lib/liveBubbles';
import { pickRole } from './lib/agentHelpers';
import type { Agent } from './types/genesis';
import type { ModuleId } from './data/moduleRegistry';
import type { RoomId } from './types/office';
import { OFFICE_ROOMS } from './data/officeRooms';
import { PIXEL_CANVAS_HEIGHT, PIXEL_CANVAS_WIDTH } from './data/pixelOfficeMap';

const TICK_MS = 5000;
const HQ_RENDERER = 'canvas' as const;

function HQView() {
  const t = useT();
  const lang = useLanguage();
  const agents = useAgents();
  const bubbles = useLiveBubbles();
  const selectedAgent = useSelectedAgent();
  const [hoveredAgent, setHoveredAgent] = useState<Agent | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [roomOpen, setRoomOpen] = useState<RoomId | null>(null);

  const firstSpeaker = Object.values(bubbles)[0];
  const speakingAgentId = firstSpeaker?.agentId ?? null;
  const speakingText = firstSpeaker?.text[lang] ?? null;

  if (roomOpen) {
    return (
      <>
        <WorkScreen room={roomOpen} onClose={() => setRoomOpen(null)} />
        <LiveActivityFeed />
      </>
    );
  }

  return (
    <>
      <main className="flex-1 min-w-0 min-h-0 relative flex flex-col">
        <div className="bg-carbon-200 border-b border-trim px-3 py-1.5 flex flex-wrap items-center gap-1.5 overflow-hidden">
          <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500 shrink-0 mr-1">
            {t('work.title')}:
          </span>
          {(Object.keys(OFFICE_ROOMS) as RoomId[]).map((rid) => (
            <button
              key={rid}
              type="button"
              onClick={() => setRoomOpen(rid)}
              className="shrink-0 font-mono text-[9px] uppercase tracking-[0.12em] px-2 py-1 border border-trim text-zinc-300 hover:bg-white/5"
              style={{ borderColor: `${OFFICE_ROOMS[rid].color}55` }}
            >
              {OFFICE_ROOMS[rid].label[lang]}
            </button>
          ))}
        </div>
        <div className="flex-1 min-h-0 relative bg-carbon-300">
          {HQ_RENDERER === 'canvas' ? (
            <PixelOfficeViewport internalWidth={PIXEL_CANVAS_WIDTH} internalHeight={PIXEL_CANVAS_HEIGHT}>
              {(scale) => (
                <PixelOfficeCanvas
                  scale={scale}
                  onAgentHover={(agent, screenX, screenY) => {
                    setHoveredAgent(agent);
                    setHoverPos({ x: screenX, y: screenY });
                  }}
                  onRoomClick={(room) => setRoomOpen(room)}
                />
              )}
            </PixelOfficeViewport>
          ) : (
            <OfficeViewport
              onMouseMoveWorld={(_wx, _wy, screenX, screenY) => setHoverPos({ x: screenX, y: screenY })}
              onMouseLeave={() => setHoveredAgent(null)}
            >
              <GenesisOfficeWorld
                agents={agents}
                speakingAgentId={speakingAgentId}
                speakingText={speakingText}
                highlightedAgentId={hoveredAgent?.id ?? selectedAgent?.id ?? null}
                onAgentClick={(a) => actions.setSelectedAgent(selectedAgent?.id === a.id ? null : a.id)}
                onAgentHover={(agent) => setHoveredAgent(agent)}
              />
            </OfficeViewport>
          )}
          {hoveredAgent && !selectedAgent && (
            <AgentTooltip agent={hoveredAgent} x={hoverPos.x} y={hoverPos.y} />
          )}
          <AgentInspector
            agent={selectedAgent}
            onClose={() => actions.setSelectedAgent(null)}
            onAction={() => { /* visual-only */ }}
          />
        </div>
      </main>
      <LiveActivityFeed />
    </>
  );
}

function HRView() {
  const t = useT();
  const lang = useLanguage();
  const agents = useActiveAgents();
  return (
    <main className="flex-1 min-w-0 min-h-0 overflow-y-auto px-8 py-8 bg-carbon-300">
      <div className="max-w-6xl mx-auto space-y-6">
        <header>
          <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-500 mb-1">
            {t('header.title')}
          </div>
          <h1 className="font-mono text-2xl text-zinc-100">{t('hr.title')}</h1>
          <p className="font-mono text-[12px] text-zinc-500 mt-1 max-w-2xl">{t('hr.intro')}</p>
        </header>
        <OnboardingPanel />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <section className="border border-trim bg-carbon-200">
            <header className="px-4 py-2.5 border-b border-trim flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-300">
                {t('hr.active.title')}
              </span>
              <span className="font-mono text-[10px] text-zinc-500">{agents.length}</span>
            </header>
            <ul className="divide-y divide-trim">
              {agents.map((a) => (
                <li key={a.id} className="px-4 py-3">
                  <div className="font-mono text-sm text-zinc-100">{a.name}</div>
                  <div className="font-mono text-[11px] text-zinc-400">{pickRole(a.role, lang)}</div>
                  <div className="font-mono text-[10px] text-zinc-600 mt-1">
                    {a.department} · {a.rank} · {a.status}
                  </div>
                  {a.currentTask && (
                    <div className="font-mono text-[11px] text-zinc-300 mt-1 italic line-clamp-2">
                      "{a.currentTask[lang]}"
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
          <HiringQueue />
        </div>
        <section className="border border-trim bg-carbon-200 px-4 py-3">
          <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500 mb-1">
            {t('hr.recommendation.title')}
          </div>
          <div className="text-zinc-200 text-[13px] leading-snug">
            {lang === 'es'
              ? '«Génesis nació con 5 agentes. Recomiendo contratar al Agente de Debate cuando haya 5 decisiones registradas.»'
              : '"Genesis was born with 5 agents. I recommend hiring the Debate Agent once 5 decisions are recorded."'}
          </div>
        </section>
      </div>
    </main>
  );
}


function SettingsView() {
  const t = useT();
  const lang = useLanguage();
  const devMode = useDevMode();
  return (
    <main className="flex-1 min-w-0 min-h-0 overflow-y-auto px-8 py-8 bg-carbon-300">
      <div className="max-w-3xl mx-auto space-y-6">
        <header>
          <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-500 mb-1">
            {t('header.title')}
          </div>
          <h1 className="font-mono text-2xl text-zinc-100">{t('settings.title')}</h1>
          <p className="font-mono text-[12px] text-zinc-500 mt-1">{t('settings.intro')}</p>
        </header>
        <section className="border border-trim bg-carbon-200 p-4">
          <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500 mb-2">
            {t('settings.language')}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setLanguage('es')}
              className={`font-mono text-[11px] uppercase tracking-wider px-3 py-1.5 border ${lang === 'es' ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-200' : 'border-trim text-zinc-300 hover:bg-white/5'}`}>
              {t('settings.language.es')}
            </button>
            <button type="button" onClick={() => setLanguage('en')}
              className={`font-mono text-[11px] uppercase tracking-wider px-3 py-1.5 border ${lang === 'en' ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-200' : 'border-trim text-zinc-300 hover:bg-white/5'}`}>
              {t('settings.language.en')}
            </button>
          </div>
        </section>
        <section className="border border-trim bg-carbon-200 p-4">
          <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500 mb-2">
            {t('settings.devMode')}
          </div>
          <p className="font-mono text-[11px] text-zinc-500 mb-3">{t('settings.devMode.desc')}</p>
          <button type="button" onClick={() => actions.setDevMode(!devMode)}
            className={`font-mono text-[11px] uppercase tracking-wider px-3 py-1.5 border ${devMode ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-200' : 'border-trim text-zinc-300 hover:bg-white/5'}`}>
            {devMode ? 'on' : 'off'}
          </button>
        </section>
        <section className="border border-red-400/40 bg-red-500/5 p-4">
          <div className="font-mono text-[10px] uppercase tracking-wider text-red-300 mb-2">
            {t('settings.reset')}
          </div>
          <p className="font-mono text-[11px] text-red-200/80 mb-3">{t('settings.reset.confirm')}</p>
          <button type="button" onClick={() => { if (window.confirm(t('settings.reset.confirm'))) actions.reset(); }}
            className="font-mono text-[11px] uppercase tracking-wider px-3 py-1.5 border border-red-400/60 text-red-300 hover:bg-red-400/10">
            {t('settings.reset')}
          </button>
        </section>
        <section className="border border-trim bg-carbon-200 p-4">
          <p className="font-mono text-[11px] text-zinc-500 leading-snug">
            {t('settings.lockedSection')}
          </p>
        </section>

        {/* MCP Connectors */}
        <div>
          <div className="font-mono text-[11px] uppercase tracking-wider text-zinc-300 mb-3">
            {lang === 'es' ? 'Conectores MCP' : 'MCP Connectors'}
          </div>
          <ConnectorsPanel />
        </div>
      </div>
    </main>
  );
}

// ─── FACTORY ────────────────────────────────────────────────────────────────

const DEPT_OPTIONS: Array<import('./types/genesis').Department> = [
  'Market Room', 'Risk Office', 'Strategy Lab', 'Memory Archive',
  'Debate Room', 'Board Room', 'Genesis HR', 'Execution Desk',
];
const ARCHETYPE_OPTIONS: Array<import('./types/genesis').Archetype> = [
  'analyst', 'commander', 'sentinel', 'scientist', 'guardian',
  'archivist', 'mediator', 'listener', 'engineer', 'intern',
];
const COLOR_PRESETS = [
  { color: '#3da9fc', label: 'Azul' },
  { color: '#00ff9c', label: 'Verde' },
  { color: '#ffd24a', label: 'Oro' },
  { color: '#7c5cff', label: 'Violeta' },
  { color: '#ff4757', label: 'Rojo' },
];

function FactoryView() {
  const t = useT();
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [dept, setDept] = useState<import('./types/genesis').Department>('Market Room');
  const [archetype, setArchetype] = useState<import('./types/genesis').Archetype>('analyst');
  const [color, setColor] = useState('#3da9fc');
  const [created, setCreated] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !role.trim()) return;
    actions.createAgentFromFactory({ name: name.trim(), role: role.trim(), department: dept, archetype, primaryColor: color });
    setCreated(name.trim());
    setName('');
    setRole('');
  }

  return (
    <main className="flex-1 min-w-0 min-h-0 overflow-y-auto px-8 py-8 bg-carbon-300">
      <div className="max-w-2xl mx-auto space-y-6">
        <header>
          <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-500 mb-1">{t('header.title')}</div>
          <h1 className="font-mono text-2xl text-zinc-100">{t('factory.title')}</h1>
          <p className="font-mono text-[12px] text-zinc-500 mt-1">{t('factory.intro')}</p>
        </header>

        {created && (
          <div className="border border-emerald-400/50 bg-emerald-500/10 px-4 py-3 font-mono text-[12px] text-emerald-200">
            ✓ {t('factory.success')} — {created}
          </div>
        )}

        <form onSubmit={handleSubmit} className="border border-trim bg-carbon-200 p-5 space-y-4">
          <div>
            <label className="block font-mono text-[10px] uppercase tracking-wider text-zinc-500 mb-1">
              {t('factory.form.name')}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setCreated(null); }}
              maxLength={32}
              required
              className="w-full bg-carbon-300 border border-trim font-mono text-[13px] text-zinc-100 px-3 py-2 focus:outline-none focus:border-zinc-400"
              placeholder="e.g. Market Hawk"
            />
          </div>

          <div>
            <label className="block font-mono text-[10px] uppercase tracking-wider text-zinc-500 mb-1">
              {t('factory.form.role')}
            </label>
            <input
              type="text"
              value={role}
              onChange={(e) => { setRole(e.target.value); setCreated(null); }}
              maxLength={48}
              required
              className="w-full bg-carbon-300 border border-trim font-mono text-[13px] text-zinc-100 px-3 py-2 focus:outline-none focus:border-zinc-400"
              placeholder="e.g. Senior Risk Analyst"
            />
          </div>

          <div>
            <label htmlFor="factory-dept" className="block font-mono text-[10px] uppercase tracking-wider text-zinc-500 mb-1">
              {t('factory.form.dept')}
            </label>
            <select
              id="factory-dept"
              value={dept}
              onChange={(e) => setDept(e.target.value as typeof dept)}
              className="w-full bg-carbon-300 border border-trim font-mono text-[13px] text-zinc-100 px-3 py-2 focus:outline-none focus:border-zinc-400"
            >
              {DEPT_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>

          <div>
            <label htmlFor="factory-archetype" className="block font-mono text-[10px] uppercase tracking-wider text-zinc-500 mb-1">
              {t('factory.form.archetype')}
            </label>
            <select
              id="factory-archetype"
              value={archetype}
              onChange={(e) => setArchetype(e.target.value as typeof archetype)}
              className="w-full bg-carbon-300 border border-trim font-mono text-[13px] text-zinc-100 px-3 py-2 focus:outline-none focus:border-zinc-400"
            >
              {ARCHETYPE_OPTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>

          <div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500 mb-2">
              {t('factory.form.color')}
            </div>
            <div className="flex gap-2">
              {COLOR_PRESETS.map((p) => (
                <button
                  key={p.color}
                  type="button"
                  onClick={() => setColor(p.color)}
                  className={`w-8 h-8 border-2 transition-all ${color === p.color ? 'scale-110 border-white' : 'border-transparent'}`}
                  style={{ backgroundColor: p.color }}
                  title={p.label}
                />
              ))}
            </div>
          </div>

          <button
            type="submit"
            disabled={!name.trim() || !role.trim()}
            className="font-mono text-[11px] uppercase tracking-wider px-4 py-2 border border-emerald-400/60 text-emerald-300 bg-carbon-300 hover:bg-emerald-400/10 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t('factory.submit')}
          </button>
        </form>
      </div>
    </main>
  );
}

// ─── DECISIONS ──────────────────────────────────────────────────────────────

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
    <div className="border border-trim bg-carbon-200 p-4 space-y-2">
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
        <div className="border border-trim bg-carbon-300 px-2 py-1.5">
          <div className="text-zinc-500 text-[9px] uppercase tracking-wider mb-0.5">{t('decisions.form.optionA')}</div>
          <div className="text-zinc-200">{d.optionA}</div>
        </div>
        <div className="border border-trim bg-carbon-300 px-2 py-1.5">
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
            className="flex-1 bg-carbon-300 border border-trim font-mono text-[12px] text-zinc-100 px-2 py-1 focus:outline-none"
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

function DecisionsView() {
  const t = useT();
  const decisions = useDecisions();
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [context, setContext] = useState('');
  const [optionA, setOptionA] = useState('');
  const [optionB, setOptionB] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !optionA.trim() || !optionB.trim()) return;
    actions.addDecision({ title: title.trim(), context: context.trim(), optionA: optionA.trim(), optionB: optionB.trim() });
    setTitle(''); setContext(''); setOptionA(''); setOptionB('');
    setShowForm(false);
  }

  return (
    <main className="flex-1 min-w-0 min-h-0 overflow-y-auto px-8 py-8 bg-carbon-300">
      <div className="max-w-3xl mx-auto space-y-6">
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
              className="w-full bg-carbon-300 border border-trim font-mono text-[13px] text-zinc-100 px-3 py-2 focus:outline-none focus:border-zinc-400" />
            <textarea value={context} onChange={(e) => setContext(e.target.value)} rows={2} maxLength={300}
              placeholder={t('decisions.form.context')}
              className="w-full bg-carbon-300 border border-trim font-mono text-[12px] text-zinc-100 px-3 py-2 focus:outline-none focus:border-zinc-400 resize-none" />
            <div className="grid grid-cols-2 gap-3">
              <input type="text" value={optionA} onChange={(e) => setOptionA(e.target.value)} required maxLength={60}
                placeholder={t('decisions.form.optionA')}
                className="bg-carbon-300 border border-trim font-mono text-[12px] text-zinc-100 px-3 py-2 focus:outline-none focus:border-zinc-400" />
              <input type="text" value={optionB} onChange={(e) => setOptionB(e.target.value)} required maxLength={60}
                placeholder={t('decisions.form.optionB')}
                className="bg-carbon-300 border border-trim font-mono text-[12px] text-zinc-100 px-3 py-2 focus:outline-none focus:border-zinc-400" />
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

// ─── AUTO ────────────────────────────────────────────────────────────────────

type AutoTask = { title: { es: string; en: string }; type: import('./types/task').TaskType; room: import('./types/office').RoomId };

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

function AutoView() {
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

  async function handlePropose(e: React.FormEvent) {
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
        sourceModule: 'auto',
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

        <form onSubmit={handlePropose} className="border border-trim bg-carbon-200 p-5 space-y-4">
          <div>
            <label className="block font-mono text-[10px] uppercase tracking-wider text-zinc-500 mb-1">
              {t('auto.form.goal')}
            </label>
            <textarea
              value={goal}
              onChange={(e) => { setGoal(e.target.value); setPlan(null); setExecuted(false); }}
              rows={3}
              maxLength={300}
              required
              className="w-full bg-carbon-300 border border-trim font-mono text-[13px] text-zinc-100 px-3 py-2 focus:outline-none focus:border-zinc-400 resize-none"
              placeholder={lang === 'es' ? 'ej. Analizar el mercado de criptomonedas esta semana' : 'e.g. Analyze the crypto market this week'}
            />
          </div>

          {agents.length > 0 && (
            <div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500 mb-2">
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
          <section className="border border-trim bg-carbon-200 p-5 space-y-3">
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

function ModuleRenderer({ module, setModule }: { module: ModuleId; setModule: (m: ModuleId) => void }) {
  switch (module) {
    case 'hq':         return <HQView />;
    case 'dashboard':  return <GenesisDashboard onOpenHQ={() => setModule('hq')} />;
    case 'hr':         return <HRView />;
    case 'markets':    return <MarketsView />;
    case 'progress':   return <ProgressView />;
    case 'settings':   return <SettingsView />;
    case 'factory':    return <FactoryView />;
    case 'decisions':  return <DecisionsView />;
    case 'auto':       return <AutoView />;
    case 'wallet':     return <WalletView />;
    case 'marketing':  return <MarketingView />;
    case 'tech':       return <TechView />;
    case 'console':       return <CommandConsole />;
    case 'integrations':  return <IntegrationsView />;
    default:
      return <ModulePlaceholder module={module} onBack={() => setModule('hq')} />;
  }
}

export default function App() {
  const currentModule = useSelectedModule();

  useEffect(() => {
    actions.tick();
    const id = setInterval(() => actions.tick(), TICK_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-carbon-300">
      <GenesisHeader currentModule={currentModule} onNavigate={actions.setSelectedModule} />
      {currentModule !== 'hq' && <TopBar />}
      <div className="flex-1 flex min-h-0">
        <GenesisSidebar currentModule={currentModule} onSelect={actions.setSelectedModule} />
        <ModuleRenderer module={currentModule} setModule={actions.setSelectedModule} />
      </div>
      <ToastContainer />
    </div>
  );
}
