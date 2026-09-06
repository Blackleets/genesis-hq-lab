// Local persistence for Genesis state. Uses localStorage. The store
// always writes a versioned envelope so we can migrate later without
// throwing the previous lab session away.

const STORAGE_KEY = 'genesis.hq.lab.state.v2';
const SCHEMA_VERSION = 2;

interface Envelope<T> {
  schemaVersion: number;
  savedAt: string;
  data: T;
}

export function load<T>(): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Envelope<T>;
    if (parsed.schemaVersion !== SCHEMA_VERSION) return null;
    // Migrate retired browser connector credentials before components hydrate.
    const data = parsed.data as T & { connectors?: { config?: unknown; status?: string }[] };
    if (Array.isArray(data?.connectors)) {
      data.connectors = data.connectors.map(c => ({ ...c, config: {}, status: 'disconnected' }));
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...parsed, data }));
    }
    return data;
  } catch {
    return null;
  }
}

export function save<T>(data: T): void {
  if (typeof window === 'undefined') return;
  try {
    const envelope: Envelope<T> = {
      schemaVersion: SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      data,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
  } catch {
    /* quota error, ignore */
  }
}

export function clearPersisted(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
}
