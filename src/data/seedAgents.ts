// Compatibility re-export. The real source of truth is initialAgents.ts
// which feeds the Genesis store. Anything still importing SEED_AGENTS
// gets the same 5-agent roster (idempotent).

export { INITIAL_AGENTS as SEED_AGENTS, INITIAL_AGENTS } from './initialAgents';
