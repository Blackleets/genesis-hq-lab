// officeAgents — the five live agents of Genesis HQ (Phase 2).
//
// Phase 2 is purely visual: agents move between zones and show work
// states, but display no trading data. `warning` (Risk) and `executing`
// (Execution) are allowed states wired in the renderer, yet never
// self-triggered here — they wait for real system events in Phase 3.

import { OFFICE_ZONES } from './officeZones';
import type { AgentDefinition, LiveOfficeAgent } from './officeTypes';

export const AGENT_DEFINITIONS: AgentDefinition[] = [
  {
    id: 'scout',
    name: 'Scout',
    role: 'market_scanner',
    accent: '#38bdf8',
    spriteIndex: 2,
    homeZone: 'researchDesk',
    allowedStates: ['idle', 'walking', 'scanning', 'thinking'],
    workStates: ['scanning', 'scanning', 'thinking', 'idle'],
  },
  {
    id: 'risk',
    name: 'Risk',
    role: 'risk_manager',
    accent: '#f87171',
    spriteIndex: 5,
    homeZone: 'riskDesk',
    allowedStates: ['idle', 'walking', 'warning', 'thinking'],
    workStates: ['thinking', 'thinking', 'idle'],
  },
  {
    id: 'execution',
    name: 'Exec',
    role: 'execution_operator',
    accent: '#34d399',
    spriteIndex: 6,
    homeZone: 'executionDesk',
    allowedStates: ['idle', 'walking', 'executing', 'monitoring'],
    workStates: ['monitoring', 'monitoring', 'idle'],
  },
  {
    id: 'analyst',
    name: 'Analyst',
    role: 'analyst',
    accent: '#c084fc',
    spriteIndex: 4,
    homeZone: 'analyticsScreen',
    allowedStates: ['idle', 'walking', 'thinking', 'scanning'],
    workStates: ['scanning', 'thinking', 'thinking', 'idle'],
  },
  {
    id: 'portfolio',
    name: 'Portfolio',
    role: 'portfolio_monitor',
    accent: '#fbbf24',
    spriteIndex: 8,
    homeZone: 'portfolioDesk',
    allowedStates: ['idle', 'walking', 'monitoring', 'thinking'],
    workStates: ['monitoring', 'thinking', 'idle'],
  },
];

/** Spawns the five agents at their home desks with staggered timers. */
export function createLiveOfficeAgents(now: number): LiveOfficeAgent[] {
  return AGENT_DEFINITIONS.map((def, i) => {
    const home = OFFICE_ZONES[def.homeZone];
    return {
      def,
      x: home.anchor.x,
      y: home.anchor.y,
      state: def.workStates[0],
      facing: 1,
      path: [],
      pathIndex: 0,
      zone: def.homeZone,
      targetZone: null,
      stateUntil: now + 3000 + i * 2500 + Math.random() * 4000,
      bobPhase: i * 1.7,
    };
  });
}
