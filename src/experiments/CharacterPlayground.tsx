// CharacterPlayground — visual comparison page.
// Renders 10 mock agents × 3 columns: Legacy SVG, Kenney sprite + tint,
// Kenney + tint + role overlay. Toggles drive status / pose / overlay /
// tint strength so the human can evaluate each variant under each state.
//
// MOCK DATA — agents come from src/fixtures/agents.json. Clearly labeled.

import { useMemo, useState, type JSX, type ReactNode } from 'react';
import { ShieldAlert, Sparkles } from 'lucide-react';

import { getMockAgents, MOCK_NOTE } from '@core/data/fixtures';
import type { Agent, AgentStatus } from '@core/types/genesis';

import { KenneyAtlasDefs } from '@animations/KenneyAtlas';
import CharacterLegacy from '../legacy/CharacterLegacy';
import KenneyCharacter from '@animations/KenneyCharacter';

const STATUS_OPTIONS: AgentStatus[] = [
  'idle', 'working', 'thinking', 'debating', 'learning', 'warning', 'promoted', 'fired',
];

const POSE_OPTIONS: Array<'seated' | 'standing'> = ['standing', 'seated'];

interface CellProps {
  children: ReactNode;
  label: string;
  /** total width/height of the cell in CSS px (scales the inner SVG) */
  size?: number;
}

function CharacterCell({ children, label, size = 192 }: CellProps): JSX.Element {
  // Inner viewBox big enough for: sprite at (0..16, 0..17), bubble above
  // (negative y to -18), shadow below (y up to ~18), arms hint (x -1, 17).
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative bg-carbon-300 rounded border border-trim overflow-hidden">
        <svg
          viewBox="-6 -20 28 40"
          width={size}
          height={size * (40 / 28)}
          style={{ imageRendering: 'pixelated' }}
          shapeRendering="crispEdges"
          aria-label={label}
        >
          {children}
        </svg>
      </div>
      <div className="text-[10px] uppercase tracking-wider font-mono text-zinc-500">{label}</div>
    </div>
  );
}

export default function CharacterPlayground(): JSX.Element {
  const baseAgents = getMockAgents();
  const [status, setStatus] = useState<AgentStatus>('working');
  const [pose, setPose] = useState<'seated' | 'standing'>('standing');
  const [showOverlay, setShowOverlay] = useState(true);
  const [tintStrength, setTintStrength] = useState(0.75);

  // Override each agent's status with the current toggle so we can inspect
  // every variant under every state. currentTask is preserved (REAL field).
  const displayAgents: Agent[] = useMemo(
    () => baseAgents.map((a) => ({ ...a, status })),
    [baseAgents, status]
  );

  return (
    <main className="min-h-screen p-6 lg:p-10">
      {/* Hidden shared <defs> so all per-cell <svg> instances can <use> these symbols. */}
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
        <defs>
          <KenneyAtlasDefs />
        </defs>
      </svg>

      <header className="max-w-6xl mx-auto mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-mono text-xl tracking-wide">GENESIS HQ LAB — Character Playground</h1>
          <p className="text-xs text-zinc-400 font-mono mt-1">
            Visual comparison: <span className="text-zinc-200">Legacy SVG</span> → <span className="text-zinc-200">Kenney + tint</span> → <span className="text-zinc-200">Kenney + tint + role overlay</span>
          </p>
        </div>
        <div className="flex items-center gap-2 text-amber-300 text-xs font-mono uppercase tracking-wider">
          <ShieldAlert className="w-4 h-4" />
          MOCK DATA
        </div>
      </header>

      {/* Controls */}
      <section className="max-w-6xl mx-auto mb-8 panel">
        <div className="flex items-center gap-2 mb-4 text-violet-300">
          <Sparkles className="w-4 h-4" />
          <span className="font-mono uppercase text-xs tracking-wider">Toggles</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono mb-2">Status</div>
            <div className="flex flex-wrap gap-1.5">
              {STATUS_OPTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  className={`text-[11px] px-2.5 py-1 rounded-full font-mono uppercase tracking-wider border transition ${
                    status === s
                      ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-200'
                      : 'bg-carbon-200 border-trim text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono mb-2">Pose</div>
            <div className="flex gap-1.5 mb-4">
              {POSE_OPTIONS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPose(p)}
                  className={`text-[11px] px-2.5 py-1 rounded-full font-mono uppercase tracking-wider border transition ${
                    pose === p
                      ? 'bg-violet-500/20 border-violet-400/50 text-violet-200'
                      : 'bg-carbon-200 border-trim text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-[11px] font-mono text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={showOverlay}
                onChange={(e) => setShowOverlay(e.target.checked)}
                className="accent-emerald-500"
              />
              Show role overlay on Kenney+ column
            </label>
            <label className="block mt-3">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono mb-1">
                Tint strength: <span className="text-zinc-200">{tintStrength.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={tintStrength}
                onChange={(e) => setTintStrength(parseFloat(e.target.value))}
                className="w-full accent-violet-400"
              />
            </label>
          </div>
        </div>
      </section>

      {/* Grid: agent label | legacy | kenney | kenney+overlay */}
      <section className="max-w-6xl mx-auto panel overflow-x-auto">
        <div className="grid grid-cols-[200px_1fr_1fr_1fr] gap-4 min-w-[820px]">
          {/* header row */}
          <div className="text-[10px] uppercase tracking-wider font-mono text-zinc-500">Agent</div>
          <div className="text-[10px] uppercase tracking-wider font-mono text-zinc-500 text-center">Legacy SVG</div>
          <div className="text-[10px] uppercase tracking-wider font-mono text-zinc-500 text-center">Kenney + tint</div>
          <div className="text-[10px] uppercase tracking-wider font-mono text-zinc-500 text-center">Kenney + tint + overlay</div>

          {displayAgents.map((agent) => (
            <div key={agent.id} className="contents">
              <div className="flex flex-col justify-center text-xs">
                <div className="font-display text-zinc-100">{agent.name}</div>
                <div className="text-[10px] text-zinc-500 font-mono mt-0.5">{typeof agent.role === 'string' ? agent.role : agent.role.en}</div>
                <div className="text-[10px] text-zinc-600 font-mono mt-1">
                  archetype: <span className="text-zinc-300">{agent.visualProfile.archetype}</span>
                </div>
                <div className="text-[10px] text-zinc-600 font-mono">
                  primary: <span style={{ color: agent.visualProfile.primary }}>{agent.visualProfile.primary}</span>
                </div>
                {agent.currentTask && (
                  <div className="text-[10px] text-zinc-500 font-mono mt-1 italic line-clamp-2">
                    "{typeof agent.currentTask === 'string' ? agent.currentTask : agent.currentTask.en}"
                  </div>
                )}
              </div>

              <CharacterCell label="legacy">
                <CharacterLegacy agent={agent} x={0} y={0} pose={pose} />
              </CharacterCell>

              <CharacterCell label="kenney">
                <KenneyCharacter
                  agent={agent}
                  x={0}
                  y={0}
                  pose={pose}
                  showRoleOverlay={false}
                  tintStrength={tintStrength}
                />
              </CharacterCell>

              <CharacterCell label="kenney + overlay">
                <KenneyCharacter
                  agent={agent}
                  x={0}
                  y={0}
                  pose={pose}
                  showRoleOverlay={showOverlay}
                  tintStrength={tintStrength}
                />
              </CharacterCell>
            </div>
          ))}
        </div>
      </section>

      <footer className="max-w-6xl mx-auto mt-6 text-[11px] font-mono text-zinc-500">
        <p>{MOCK_NOTE}</p>
        <p className="mt-1 text-zinc-600">
          Approve a column visually to graduate it to <code className="text-zinc-300">../genesis</code>.
        </p>
      </footer>
    </main>
  );
}
