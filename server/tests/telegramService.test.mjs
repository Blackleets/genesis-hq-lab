import test from 'node:test';
import assert from 'node:assert/strict';

import {
  decryptTelegramConfig,
  encryptTelegramConfig,
  formatSolanaTelegramEvent,
  normalizeTelegramPreferences,
  telegramRequest,
  testTelegramConnection,
  validateTelegramInput,
} from '../genesis/telegramService.mjs';

const botToken = '123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcd';
const chatId = '-1001234567890';
const secret = 'test-only-encryption-secret-at-least-32-characters';

test('Telegram config encrypts at rest and decrypts only server-side', () => {
  const valid = validateTelegramInput({ botToken, chatId });
  const encrypted = encryptTelegramConfig({ ...valid, notifications: normalizeTelegramPreferences() }, secret);
  assert.equal(JSON.stringify(encrypted).includes(botToken), false);
  assert.deepEqual(decryptTelegramConfig(encrypted, secret).botToken, botToken);
  assert.throws(() => decryptTelegramConfig(encrypted, 'different-secret-at-least-32-characters'));
});

test('Telegram test validates bot and sends the exact connection message without returning token', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 44 } }), { status: 200 });
  };
  const result = await testTelegramConnection({ botToken, chatId, fetchImpl });
  assert.deepEqual(result, { connected: true, messageId: 44 });
  assert.equal(calls.length, 2); assert.ok(calls[1].body.text.includes('GENESIS HQ CONNECTED'));
  assert.equal(JSON.stringify(result).includes(botToken), false);
});

test('opportunity and paper capture formatters distinguish expected from captured', () => {
  const opportunity = formatSolanaTelegramEvent({ type: 'OPPORTUNITY_DETECTED', route: 'Jupiter → Orca', tokens: ['USDC', 'SOL', 'USDC'], inputAmountUsd: 25, grossEdgeBps: 40, netEdgeBps: 12, expectedNetPnlUsd: 0.03, decision: 'PAPER_PENDING', timestamp: '2026-09-14T12:00:00Z' });
  assert.match(opportunity, /Expected Net/); assert.match(opportunity, /PAPER_PENDING/);
  const capture = formatSolanaTelegramEvent({ type: 'CAPTURE_MEASURED', route: 'Jupiter → Orca', expectedNetPnlUsd: 0.03, capturedNetPnlUsd: 0.02, captureRatio: 2 / 3, actualFeesUsd: 0.004, actualSlippageBps: 3.5, timestamp: '2026-09-14T12:00:01Z' });
  assert.match(capture, /Expected/); assert.match(capture, /Captured/); assert.match(capture, /Slippage/); assert.match(capture, /Fees/); assert.match(capture, /66\.7%/);
});

test('Telegram provider errors redact bot tokens', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ ok: false, description: `bad ${botToken}` }), { status: 401 });
  await assert.rejects(() => telegramRequest({ botToken, method: 'getMe', payload: {}, fetchImpl }), (error) => {
    assert.equal(error.message.includes(botToken), false); assert.match(error.message, /\[REDACTED\]/); return true;
  });
});

test('default notification level keeps debug off', () => {
  assert.deepEqual(normalizeTelegramPreferences({}), { important: true, opportunities: true, executions: true, dailySummary: true, debug: false });
});
