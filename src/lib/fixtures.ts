// Loads the bundled mock fixture. Clearly labeled as mock — never present
// these values as if they came from the production backend.

import fixturesJson from '../fixtures/agents.json';
import type { Agent } from '../types/genesis';

interface FixtureFile {
  _note: string;
  agents: Agent[];
}

const data = fixturesJson as FixtureFile;

export const MOCK_NOTE = data._note;
export const MOCK_AGENTS: Agent[] = data.agents;

export function getMockAgents(): Agent[] {
  return MOCK_AGENTS;
}
