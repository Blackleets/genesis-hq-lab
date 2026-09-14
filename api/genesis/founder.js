import { sendJson, sendMethodNotAllowed } from '../_lib/http.js';
import { requireSession, ownerHashFor } from '../_lib/sessionAuth.js';
import { getStore, DEGRADED_MESSAGE } from '../_lib/store.js';
import { callTelegramGateway } from '../_lib/telegramRemote.js';
import { founderResponse } from '../../server/genesis/founderHttp.mjs';
import {
  constantTimeSecretMatch,
  decryptTelegramConfig,
  encryptTelegramConfig,
  normalizeTelegramPreferences,
  sendSolanaTelegramEvent,
  testTelegramConnection,
  validateTelegramInput,
} from '../../server/genesis/telegramService.mjs';

const CONFIG_PREFIX = 'genesis:telegram:config:';
const DELIVERY_PREFIX = 'genesis:telegram:delivery:';
const MAX_BODY_BYTES = 8_192;

function encryptionSecret() {
  return process.env.TELEGRAM_CONFIG_ENCRYPTION_KEY || process.env.GENESIS_SECRET_ENCRYPTION_KEY || null;
}

function readBody(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) reject(new Error('request_too_large'));
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('invalid_json')); }
    });
    req.on('error', reject);
  });
}

function publicStatus(stored) {
  return {
    configured: Boolean(stored),
    connected: Boolean(stored?.verifiedAt),
    verifiedAt: stored?.verifiedAt ?? null,
    chatIdMasked: stored?.chatIdMasked ?? null,
    notifications: normalizeTelegramPreferences(stored?.notifications),
  };
}

async function tryRemoteTelegram({ method, ownerHash, body, sessionToken }) {
  const action = method === 'GET' ? 'status' : method === 'DELETE' ? 'delete' : method === 'POST' ? 'save' : null;
  if (!action) return { available: false, status: 0, body: null };
  try {
    return await callTelegramGateway({ action, ownerHash, ...(body || {}) }, sessionToken);
  } catch {
    return { available: false, status: 0, body: null };
  }
}

async function handleTelegramUserRequest(req, res) {
  const session = await requireSession(req, res);
  if (!session) return;
  const ownerHash = ownerHashFor(session.address);

  let body = null;
  if (req.method === 'POST') {
    try { body = await readBody(req); }
    catch (error) {
      const code = error instanceof Error ? error.message : 'invalid_json';
      const status = code === 'invalid_json' || code === 'request_too_large' ? 400 : 500;
      return sendJson(res, status, { ok: false, error: code });
    }
  }

  // Production primary path: the authenticated owner session is forwarded to
  // Supabase Edge, which derives the owner identity and persists config in Vault.
  const remote = await tryRemoteTelegram({
    method: req.method,
    ownerHash,
    body,
    sessionToken: req.sessionToken,
  });
  if (remote.available) return sendJson(res, remote.status, remote.body);

  // Local/legacy fallback retained for development or an explicitly configured durable store.
  const store = await getStore();
  const key = `${CONFIG_PREFIX}${ownerHash}`;

  if (req.method === 'GET') return sendJson(res, 200, { ok: true, telegram: publicStatus(await store.get(key)) });
  if (req.method === 'DELETE') {
    await store.del(key);
    return sendJson(res, 200, { ok: true, telegram: publicStatus(null) });
  }
  if (req.method !== 'POST') return sendMethodNotAllowed(res, 'GET, POST, DELETE, PUT');
  if (!store.isDurable()) return sendJson(res, 503, { ok: false, error: 'durable_store_not_configured', message: DEGRADED_MESSAGE });
  const secret = encryptionSecret();
  if (!secret) return sendJson(res, 503, { ok: false, error: 'secret_store_not_configured', message: 'Configura TELEGRAM_CONFIG_ENCRYPTION_KEY en el entorno del backend.' });

  try {
    const valid = validateTelegramInput({ botToken: body?.botToken, chatId: body?.chatId });
    const notifications = normalizeTelegramPreferences(body?.notifications);
    await testTelegramConnection({ ...valid });
    const encrypted = encryptTelegramConfig({ ...valid, notifications }, secret);
    const verifiedAt = new Date().toISOString();
    const chatIdMasked = valid.chatId.length > 5 ? `${valid.chatId.slice(0, 2)}•••${valid.chatId.slice(-3)}` : '•••••';
    await store.set(key, { encrypted, verifiedAt, chatIdMasked, notifications });
    return sendJson(res, 200, { ok: true, telegram: publicStatus({ verifiedAt, chatIdMasked, notifications }) });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'telegram_test_failed';
    const status = code === 'invalid_bot_token' || code === 'invalid_chat_id' ? 400 : 502;
    return sendJson(res, status, { ok: false, error: code.split(':')[0], message: code.startsWith('telegram_') ? 'Telegram rechazó la conexión. Revisa el token y el Chat ID.' : code.replaceAll('_', ' ') });
  }
}

async function handleTelegramDispatch(req, res) {
  const auth = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '');
  if (!constantTimeSecretMatch(auth, process.env.GENESIS_NOTIFICATION_DISPATCH_SECRET)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
  const secret = encryptionSecret();
  if (!secret) return sendJson(res, 503, { ok: false, error: 'secret_store_not_configured' });
  const store = await getStore();
  if (!store.isDurable()) return sendJson(res, 503, { ok: false, error: 'durable_store_not_configured' });
  try {
    const body = await readBody(req);
    const events = Array.isArray(body?.events) ? body.events : [];
    const safeEvents = events.filter((event) => event?.chain === 'SOLANA' && event?.executionAuthority === false && event?.liveLocked === true && ['OPPORTUNITY_DETECTED', 'CAPTURE_MEASURED', 'SIMULATION_FAILED', 'FAILED'].includes(event?.type));
    const configKeys = await store.keys(CONFIG_PREFIX);
    let sent = 0; let skipped = 0; let failed = 0;
    for (const configKey of configKeys) {
      const stored = await store.get(configKey);
      const ownerHash = configKey.slice(CONFIG_PREFIX.length);
      let config;
      try { config = decryptTelegramConfig(stored?.encrypted, secret); }
      catch { failed += 1; continue; }
      for (const event of safeEvents) {
        const eventId = event.eventId ?? event.id;
        if (!eventId) { skipped += 1; continue; }
        const deliveryKey = `${DELIVERY_PREFIX}${ownerHash}:${eventId}`;
        if (await store.get(deliveryKey)) { skipped += 1; continue; }
        try {
          const result = await sendSolanaTelegramEvent({ config, event });
          if (result.sent) { await store.set(deliveryKey, { sentAt: new Date().toISOString() }, 60 * 60 * 24 * 30); sent += 1; }
          else skipped += 1;
        } catch { failed += 1; }
      }
    }
    return sendJson(res, 200, { ok: true, configs: configKeys.length, events: safeEvents.length, sent, skipped, failed });
  } catch {
    return sendJson(res, 500, { ok: false, error: 'telegram_dispatch_failed' });
  }
}

// One Vercel Function serves two isolated surfaces:
// - default GET: public allowlisted founder/readiness projection
// - ?view=telegram: authenticated Telegram config; legacy PUT dispatch remains fail-closed
// Production Telegram persistence uses Supabase Vault; automatic dispatch uses GitHub OIDC.
export default async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.searchParams.get('view') === 'telegram') {
    if (req.method === 'PUT') return handleTelegramDispatch(req, res);
    return handleTelegramUserRequest(req, res);
  }

  if (req.method !== 'GET') return sendMethodNotAllowed(res);
  const result = founderResponse(req.method);
  return sendJson(res, result.status, result.body);
}
