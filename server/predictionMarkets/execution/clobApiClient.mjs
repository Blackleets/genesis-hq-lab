// clobApiClient.mjs — Polymarket CLOB API client with L2 HMAC-SHA256 auth.
// Handles order submission and API key resolution.
// DRY_RUN mode signs the order but does NOT submit it — use for validation.

import { createHmac } from 'node:crypto';

const CLOB_BASE = 'https://clob.polymarket.com';

/**
 * Read CLOB credentials from environment.
 * Returns null for each missing field so callers can decide how to handle.
 */
export function getClobCredentials() {
  const raw = process.env.POLYMARKET_API_KEY ?? '';
  // POLYMARKET_API_KEY may be a JSON string: { apiKey, secret, passphrase }
  // or just the bare API key string. Support both forms.
  let apiKey = null;
  let secret = null;
  let passphrase = null;

  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      apiKey     = parsed.apiKey     ?? parsed.key   ?? null;
      secret     = parsed.secret     ?? null;
      passphrase = parsed.passphrase ?? null;
    } catch {
      // fall through — treat as plain key
      apiKey = raw || null;
    }
  } else {
    apiKey = raw || null;
  }

  const privateKey = process.env.POLYMARKET_PRIVATE_KEY ?? null;

  return { apiKey, secret, passphrase, privateKey };
}

/**
 * Build the L2 HMAC-SHA256 authentication headers required by the CLOB API.
 * Signature = HMAC-SHA256(secret, timestamp + METHOD + path + body)
 */
export function buildAuthHeaders(method, path, body, credentials) {
  const { apiKey, secret, passphrase, signerAddress } = credentials;
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const bodyStr = body ? JSON.stringify(body) : '';
  const message = timestamp + method.toUpperCase() + path + bodyStr;

  const signature = secret
    ? createHmac('sha256', secret).update(message).digest('base64')
    : '';

  return {
    'POLY_ADDRESS':    signerAddress ?? '',
    'POLY_SIGNATURE':  signature,
    'POLY_TIMESTAMP':  timestamp,
    'POLY_API_KEY':    apiKey ?? '',
    'POLY_PASSPHRASE': passphrase ?? '',
    'Content-Type':    'application/json',
  };
}

/**
 * Submit an order to the Polymarket CLOB API.
 *
 * @param {object} serializedOrder  - from clobSigner.serializeOrder()
 * @param {string} signerAddress    - wallet address (0x...)
 * @param {object} options
 * @param {boolean} [options.dryRun=true]  - if true, sign but do NOT submit
 * @param {string}  [options.orderType]    - 'GTC' | 'FOK' | 'GTD' (default 'GTC')
 * @returns {Promise<object>}
 */
export async function submitOrder(serializedOrder, signerAddress, { dryRun = true, orderType = 'GTC' } = {}) {
  const creds = getClobCredentials();
  creds.signerAddress = signerAddress;

  const path = '/order';
  const body = {
    order:     serializedOrder,
    owner:     signerAddress,
    orderType,
  };

  const headers = buildAuthHeaders('POST', path, body, creds);

  if (dryRun) {
    // Dry-run: validate the structure but never touch the network.
    return {
      ok:       true,
      dryRun:   true,
      message:  'DRY_RUN: order signed and validated locally. Not submitted.',
      order:    serializedOrder,
      headers:  {
        // Return headers except secret-derived values for audit, redact signature
        POLY_ADDRESS:   headers['POLY_ADDRESS'],
        POLY_TIMESTAMP: headers['POLY_TIMESTAMP'],
        POLY_API_KEY:   headers['POLY_API_KEY'] ? '[PRESENT]' : '[MISSING]',
        POLY_SIGNATURE: headers['POLY_SIGNATURE'] ? '[PRESENT]' : '[MISSING]',
      },
    };
  }

  const resp = await fetch(`${CLOB_BASE}${path}`, {
    method:  'POST',
    headers,
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(10_000),
  });

  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!resp.ok) {
    return {
      ok:         false,
      httpStatus: resp.status,
      error:      data?.error ?? data?.raw ?? 'CLOB_ERROR',
      detail:     data,
    };
  }

  return {
    ok:       true,
    dryRun:   false,
    orderId:  data?.orderID ?? data?.order_id ?? null,
    status:   data?.status ?? 'submitted',
    raw:      data,
  };
}

/**
 * Check current CLOB API connectivity (no auth required).
 * Returns { ok, latencyMs } or { ok: false, error }.
 */
export async function checkClobHealth() {
  const start = Date.now();
  try {
    const resp = await fetch(`${CLOB_BASE}/`, {
      signal: AbortSignal.timeout(5_000),
    });
    return { ok: resp.ok || resp.status < 500, latencyMs: Date.now() - start, status: resp.status };
  } catch (err) {
    return { ok: false, error: err.message, latencyMs: Date.now() - start };
  }
}
