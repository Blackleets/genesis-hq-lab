import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dir, '..', '..', 'data', 'crypto');
const STATUS_FILE = join(DATA_DIR, 'llm_status.json');

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

export function getCryptoLlmStatus() {
  try {
    const parsed = JSON.parse(readFileSync(STATUS_FILE, 'utf8'));
    return {
      provider: 'claude',
      usedByLiveScalp: false,
      usedByLegacyCryptoLoop: true,
      configured: Boolean(parsed.configured),
      available: typeof parsed.available === 'boolean' ? parsed.available : null,
      fallbackActive: typeof parsed.fallbackActive === 'boolean' ? parsed.fallbackActive : null,
      verification: typeof parsed.verification === 'string'
        ? parsed.verification
        : typeof parsed.available === 'boolean'
          ? 'verified'
          : 'unverified',
      lastProviderError: parsed.lastProviderError ?? null,
      checkedAt: parsed.checkedAt ?? null,
      lastModel: parsed.lastModel ?? null,
      note: parsed.note
        ?? 'Scheduler scalp path is deterministic. Claude status applies only to the legacy crypto debate loop.',
    };
  } catch {
    const configured = Boolean(process.env.ANTHROPIC_API_KEY);
    return {
      provider: 'claude',
      usedByLiveScalp: false,
      usedByLegacyCryptoLoop: true,
      configured,
      available: null,
      fallbackActive: configured ? null : true,
      verification: configured ? 'unverified' : 'verified',
      lastProviderError: configured ? null : 'ANTHROPIC_API_KEY not configured',
      checkedAt: null,
      lastModel: null,
      note: configured
        ? 'Claude key exists, but no verified crypto debate call has been recorded since boot. Live scalp remains deterministic.'
        : 'ANTHROPIC_API_KEY not configured. Live scalp remains deterministic and any legacy crypto debate falls back to rules.',
    };
  }
}

export function buildCryptoLlmStatus({
  configured,
  available,
  fallbackActive,
  lastProviderError = null,
  lastModel = null,
  checkedAt = new Date().toISOString(),
  verification = typeof available === 'boolean' ? 'verified' : 'unverified',
  note = 'Scheduler scalp path is deterministic. Claude status applies only to the legacy crypto debate loop.',
}) {
  return {
    provider: 'claude',
    usedByLiveScalp: false,
    usedByLegacyCryptoLoop: true,
    configured,
    available,
    fallbackActive,
    verification,
    lastProviderError,
    checkedAt,
    lastModel,
    note,
  };
}

export function saveCryptoLlmStatus(status) {
  try {
    ensureDir();
    writeFileSync(STATUS_FILE, JSON.stringify(buildCryptoLlmStatus(status)), 'utf8');
  } catch { /* best-effort observability */ }
}
