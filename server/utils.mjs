// utils.mjs — shared utilities for the Genesis HQ backend

import { randomBytes } from 'node:crypto';

/** Generate a short random ID (8 chars) */
export function nanoid() {
  return randomBytes(4).toString('hex');
}

/** Format currency */
export function formatPnl(n) {
  const sign = n >= 0 ? '+' : '';
  return `${sign}$${n.toFixed(2)}`;
}

/** Simple in-process cache with TTL */
export class TTLCache {
  #store = new Map();
  get(key) {
    const item = this.#store.get(key);
    if (!item) return undefined;
    if (Date.now() > item.expiresAt) { this.#store.delete(key); return undefined; }
    return item.value;
  }
  set(key, value, ttlMs = 5 * 60 * 1000) {
    this.#store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }
}
