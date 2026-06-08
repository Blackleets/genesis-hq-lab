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
      configured: Boolean(parsed.configured),
      available: typeof parsed.available === 'boolean' ? parsed.available : null,
      fallbackActive: typeof parsed.fallbackActive === 'boolean' ? parsed.fallbackActive : true,
      lastProviderError: parsed.lastProviderError ?? null,
      checkedAt: parsed.checkedAt ?? null,
      lastModel: parsed.lastModel ?? null,
    };
  } catch {
    return {
      provider: 'claude',
      configured: Boolean(process.env.ANTHROPIC_API_KEY),
      available: null,
      fallbackActive: !process.env.ANTHROPIC_API_KEY,
      lastProviderError: process.env.ANTHROPIC_API_KEY ? null : 'ANTHROPIC_API_KEY not configured',
      checkedAt: null,
      lastModel: null,
    };
  }
}

export function buildCryptoLlmStatus({ configured, available, fallbackActive, lastProviderError = null, lastModel = null, checkedAt = new Date().toISOString() }) {
  return {
    provider: 'claude',
    configured,
    available,
    fallbackActive,
    lastProviderError,
    checkedAt,
    lastModel,
  };
}

export function saveCryptoLlmStatus(status) {
  try {
    ensureDir();
    writeFileSync(STATUS_FILE, JSON.stringify(buildCryptoLlmStatus(status)), 'utf8');
  } catch { /* best-effort observability */ }
}
