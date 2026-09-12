// Legacy browser-side external writes are retired. Connector credentials and
// dispatch must be implemented in a separately authorized server-side gateway.
import type { ConnectorConfig } from '@core/store/genesisStore';
import type { Task } from '@core/types/task';
import type { Agent } from '@core/types/genesis';

export async function triggerConnectors(_task: Task, _agent: Agent, _connectors: ConnectorConfig[], _lang: 'es' | 'en' = 'en'): Promise<void> {
  void _task; void _agent; void _connectors; void _lang;
  throw new Error('Browser connector dispatch disabled; use a server-side connector gateway');
}
export async function testConnector(_connector: ConnectorConfig): Promise<boolean> {
  void _connector;
  return false;
}
