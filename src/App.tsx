// Genesis HQ Lab — app shell wired to the Genesis Life Operating System.
// All state comes from src/state/genesisStore (persisted to localStorage).
// Every 5 seconds we call actions.tick() to advance movement, complete
// onboarding timers, start/complete tasks, etc.

import { useEffect, useState } from 'react';
import GenesisHeader from './components/GenesisHeader';
import GenesisSidebar from './components/GenesisSidebar';
import OfficeViewport from './components/OfficeViewport';
import GenesisOfficeWorld from './components/GenesisOfficeWorld';
import LiveActivityFeed from './components/LiveActivityFeed';
import AgentInspector from './components/AgentInspector';
import AgentTooltip from './components/AgentTooltip';
import ModulePlaceholder from './components/ModulePlaceholder';
import HiringQueue from './components/HiringQueue';
import OnboardingPanel from './components/OnboardingPanel';
import WorkScreen from './components/WorkScreen';
import GenesisDashboard from './components/GenesisDashboard';
import OfficeUpgradeEventList from './components/OfficeUpgradeEvent';
import MetricsPanel from './components/MetricsPanel';

import { setLanguage, useLanguage, useT } from './i18n/languageStore';
import {
  actions,
  useAgents,
  useDevMode,
  useSelectedAgent,
  useSelectedModule,
} from './state/genesisStore';
import { useLiveBubbles } from './lib/liveBubbles';
import { pickRole } from './lib/agentHelpers';
import type { Agent } from './types/genesis';
import type { ModuleId } from './data/moduleRegistry';
import type { RoomId } from './types/office';
import { OFFICE_ROOMS } from './data/officeRooms';

const TICK_MS = 5000;

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

  function handleViewportMouseMove(_wx: number, _wy: number, screenX: number, screenY: number) {
    setHoverPos({ x: screenX, y: screenY });
  }

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
        <div className="bg-carbon-200 border-b border-trim px-3 py-1.5 flex items-center gap-1.5 overflow-x-auto">
          <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500 shrink-0 mr-1">
            {t('work.title')}:
          </span>
          {(Object.keys(OFFICE_ROOMS) as RoomId[]).map((rid) => (
            <button
              key={rid}
              type="button"
              onClick={() => setRoomOpen(rid)}
              className="shrink-0 font-mono text-[10px] uppercase tracking-wider px-2 py-1 border border-trim text-zinc-300 hover:bg-white/5"
              style={{ borderColor: `${OFFICE_ROOMS[rid].color}55` }}
            >
              {OFFICE_ROOMS[rid].label[lang]}
            </button>
          ))}
        </div>
        <div className="flex-1 min-h-0 relative">
          <OfficeViewport
            onMouseMoveWorld={handleViewportMouseMove}
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
  const agents = useAgents();
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
                      "{a.currentTask}"
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

function ProgressView() {
  const t = useT();
  return (
    <main className="flex-1 min-w-0 min-h-0 overflow-y-auto px-8 py-8 bg-carbon-300">
      <div className="max-w-6xl mx-auto space-y-6">
        <header>
          <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-500 mb-1">
            {t('header.title')}
          </div>
          <h1 className="font-mono text-2xl text-zinc-100">{t('nav.progress')}</h1>
        </header>
        <MetricsPanel />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <OfficeUpgradeEventList />
          <OnboardingPanel />
        </div>
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
      </div>
    </main>
  );
}

function ModuleRenderer({ module, setModule }: { module: ModuleId; setModule: (m: ModuleId) => void }) {
  switch (module) {
    case 'hq':         return <HQView />;
    case 'dashboard':  return <GenesisDashboard onOpenHQ={() => setModule('hq')} />;
    case 'hr':         return <HRView />;
    case 'progress':   return <ProgressView />;
    case 'settings':   return <SettingsView />;
    case 'factory':
    case 'auto':
    case 'markets':
    case 'decisions':
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
      <GenesisHeader currentModule={currentModule} />
      <div className="flex-1 flex min-h-0">
        <GenesisSidebar currentModule={currentModule} onSelect={actions.setSelectedModule} />
        <ModuleRenderer module={currentModule} setModule={actions.setSelectedModule} />
      </div>
    </div>
  );
}
