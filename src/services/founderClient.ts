import { apiUrl } from './apiBase';

export type FounderMode = 'read_only' | 'paper' | 'testnet' | 'live_locked' | 'ready_for_external_cutover';
export interface FounderConnector {
  id: string; name: string; category: string; mode: FounderMode;
  status: 'online' | 'pending' | 'missing_credentials' | 'paper_only' | 'locked';
  health: 'online' | 'unverified'; permissions: string[]; requiredEnv: string[]; blockers: string[]; lastCheck: string | null;
}
export interface FounderAgent {
  id: string; name: string; role: string; desk: string; mission: string; mode: FounderMode;
  status: string; permissions: string[]; connectedTo: string[]; currentTask: string | null; blockers: string[];
  metrics: { source: string; evaluatedGates: number | null; blockedGates: number | null; netPnl: number | null; completedTasks: number | null; lastHeartbeat: string | null };
  memory: { policy: string; entries: number };
}
export interface FounderSnapshot {
  ok: boolean; owner: { status: string; wallet: { status: string; custody: boolean } };
  mode: FounderMode; readiness: 'BLOCKED' | 'READY_FOR_EXTERNAL_CUTOVER';
  connectors: FounderConnector[]; agents: FounderAgent[];
  risk: { currency: string; maxDailyLoss: number | null; maxOrderNotional: number | null; killSwitchArmed: boolean; killSwitchTested: boolean; founderPaused: boolean; strategyApproved: boolean };
  cutover: { status: string; canExecute: false; requiresExternalOwnerConfirmation: true; evidenceExpiresAt: string | null;
    checks: { id: string; label: string; passed: boolean; blocker: string | null }[] };
  blockers: string[]; updatedAt: string;
}

export async function fetchFounderSnapshot(signal?: AbortSignal, sameOrigin = false): Promise<FounderSnapshot> {
  // Founder evidence never carries bearer/exchange secrets. The trading desk
  // explicitly uses the deployed same-origin function so it cannot drift to a
  // different backend account through VITE_API_BASE.
  const endpoint = sameOrigin ? '/api/genesis/founder' : apiUrl('/api/genesis/founder');
  const res = await fetch(endpoint, { cache: 'no-store', credentials: 'omit', signal });
  if (!res.ok) throw new Error('Founder readiness unavailable');
  const data = await res.json() as FounderSnapshot;
  if (data?.ok !== true || !['BLOCKED', 'READY_FOR_EXTERNAL_CUTOVER'].includes(data.readiness)
    || data.cutover?.canExecute !== false || data.cutover.requiresExternalOwnerConfirmation !== true
    || !Array.isArray(data.cutover.checks) || data.cutover.checks.length < 12
    || !Array.isArray(data.connectors) || !Array.isArray(data.agents) || !Array.isArray(data.blockers)
    || !data.owner?.wallet || !data.risk || !Number.isFinite(Date.parse(data.updatedAt))) {
    throw new Error('Invalid founder readiness response');
  }
  return data;
}

export function canReviewCutover(snapshot: FounderSnapshot | null, now: number): boolean {
  if (!snapshot || snapshot.readiness !== 'READY_FOR_EXTERNAL_CUTOVER' || snapshot.blockers.length !== 0) return false;
  const age = now - Date.parse(snapshot.updatedAt);
  return age >= 0 && age < 60_000 && Date.parse(snapshot.cutover.evidenceExpiresAt ?? '') > now
    && snapshot.cutover.checks.every(check => check.passed === true);
}
