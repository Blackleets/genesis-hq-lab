import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const TELEGRAM_API = 'https://api.telegram.org';
const DEFAULT_NOTIFICATIONS = Object.freeze({ important: true, opportunities: true, executions: true, dailySummary: true, debug: false });

function encryptionKey(secret) {
  if (typeof secret !== 'string' || secret.length < 24) throw new Error('telegram_encryption_key_not_configured');
  return createHash('sha256').update(secret).digest();
}

export function normalizeTelegramPreferences(value = {}) {
  return Object.freeze({
    important: value.important !== false,
    opportunities: value.opportunities !== false,
    executions: value.executions !== false,
    dailySummary: value.dailySummary !== false,
    debug: value.debug === true,
  });
}

export function validateTelegramInput({ botToken, chatId }) {
  const token = typeof botToken === 'string' ? botToken.trim() : '';
  const chat = typeof chatId === 'string' || typeof chatId === 'number' ? String(chatId).trim() : '';
  if (!/^\d{5,16}:[A-Za-z0-9_-]{20,}$/.test(token)) throw new Error('invalid_bot_token');
  if (!/^-?\d{5,20}$/.test(chat) && !/^@[A-Za-z][A-Za-z0-9_]{4,31}$/.test(chat)) throw new Error('invalid_chat_id');
  return { botToken: token, chatId: chat };
}

export function encryptTelegramConfig(value, secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { version: 1, algorithm: 'aes-256-gcm', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
}

export function decryptTelegramConfig(envelope, secret) {
  if (envelope?.version !== 1 || envelope?.algorithm !== 'aes-256-gcm') throw new Error('invalid_telegram_config');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(secret), Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString('utf8'));
}

function safeProviderError(status, body) {
  const description = typeof body?.description === 'string' ? body.description.replace(/\d{5,16}:[A-Za-z0-9_-]{20,}/g, '[REDACTED]') : '';
  return new Error(description ? `telegram_${status}:${description.slice(0, 160)}` : `telegram_${status}`);
}

export async function telegramRequest({ botToken, method, payload, fetchImpl = fetch }) {
  const response = await fetchImpl(`${TELEGRAM_API}/bot${botToken}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.ok !== true) throw safeProviderError(response.status, body);
  return body.result;
}

export async function testTelegramConnection({ botToken, chatId, fetchImpl = fetch }) {
  const valid = validateTelegramInput({ botToken, chatId });
  await telegramRequest({ botToken: valid.botToken, method: 'getMe', payload: {}, fetchImpl });
  const message = [
    '🔥 GENESIS HQ CONNECTED',
    '',
    'Telegram notifications are active.',
    '',
    'Solana Engine: ONLINE',
    'Futures Engine: ONLINE',
    '',
    'Genesis will report qualified opportunities and execution results here.',
  ].join('\n');
  const sent = await telegramRequest({ botToken: valid.botToken, method: 'sendMessage', payload: { chat_id: valid.chatId, text: message, disable_web_page_preview: true }, fetchImpl });
  return { connected: true, messageId: sent?.message_id ?? null };
}

function amount(value, digits = 4) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `${number >= 0 ? '+' : '-'}$${Math.abs(number).toFixed(digits)}`;
}

function bps(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number >= 0 ? '+' : ''}${number.toFixed(2)} bps` : '—';
}

export function notificationLevelForEvent(event) {
  if (event?.type === 'OPPORTUNITY_DETECTED') return 'opportunities';
  if (['PAPER_EXECUTED', 'CAPTURE_MEASURED'].includes(event?.type)) return 'executions';
  if (['FAILED', 'SIMULATION_FAILED'].includes(event?.type)) return 'important';
  return 'debug';
}

export function formatSolanaTelegramEvent(event) {
  const route = event?.route || 'USDC → SOL → USDC';
  const pair = Array.isArray(event?.tokens) && event.tokens.length ? event.tokens.join(' → ') : 'USDC → SOL → USDC';
  if (event?.type === 'OPPORTUNITY_DETECTED') {
    return [
      '🔥 GENESIS · SOLANA OPPORTUNITY', '',
      `Route:\n${route}`, '', `Pair:\n${pair}`, '',
      `Capital:\n$${Number(event.inputAmountUsd ?? 0).toFixed(2)}`, '',
      `Gross Edge:\n${bps(event.grossEdgeBps ?? event.quotedEdgeBps)}`, '',
      `Estimated Costs:\n${amount(-Math.abs(Number(event.estimatedCosts?.totalUsd ?? 0)))}`, '',
      `Net Edge:\n${bps(event.netEdgeBps)}`, '',
      `Expected Net:\n${amount(event.expectedNetPnlUsd)}`, '',
      `Simulation:\n${event.simulationResult?.success ? 'PASSED' : 'PENDING'}`, '',
      `Decision:\n${event.decision || 'PENDING'}`, '',
      event.timestamp || event.observedAt || new Date().toISOString(),
    ].join('\n');
  }
  if (event?.type === 'CAPTURE_MEASURED' || event?.type === 'PAPER_EXECUTED') {
    return [
      '⚡ GENESIS · PAPER CAPTURE', '', `Route:\n${route}`, '',
      `Expected:\n${amount(event.expectedNetPnlUsd)}`, '',
      `Captured:\n${amount(event.capturedNetPnlUsd)}`, '',
      `Slippage:\n${bps(event.actualSlippageBps)}`, '',
      `Fees:\n${amount(-Math.abs(Number(event.actualFeesUsd ?? 0)))}`, '',
      `Net PnL:\n${amount(event.capturedNetPnlUsd)}`, '',
      `Capture Ratio:\n${Number.isFinite(Number(event.captureRatio)) ? `${(Number(event.captureRatio) * 100).toFixed(1)}%` : '—'}`, '',
      event.timestamp || event.observedAt || new Date().toISOString(),
    ].join('\n');
  }
  return `GENESIS · SOLANA ${String(event?.type || 'EVENT').replaceAll('_', ' ')}\n${route}\n${event?.reason || ''}`.trim();
}

export async function sendSolanaTelegramEvent({ config, event, fetchImpl = fetch }) {
  const level = notificationLevelForEvent(event);
  const preferences = normalizeTelegramPreferences(config?.notifications ?? DEFAULT_NOTIFICATIONS);
  if (!preferences[level]) return { sent: false, reason: 'notification_disabled' };
  const valid = validateTelegramInput(config);
  const result = await telegramRequest({ botToken: valid.botToken, method: 'sendMessage', payload: { chat_id: valid.chatId, text: formatSolanaTelegramEvent(event), disable_web_page_preview: true }, fetchImpl });
  return { sent: true, messageId: result?.message_id ?? null };
}

export function constantTimeSecretMatch(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string' || !actual || !expected) return false;
  const a = Buffer.from(actual); const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
