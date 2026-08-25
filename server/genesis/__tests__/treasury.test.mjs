// server/genesis/__tests__/treasury.test.mjs
// Live-trading reservation math + reserve/release round-trip against a
// sandboxed state file (original data/genesis_treasury_state.json and ledger
// are backed up and restored byte-for-byte).

import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

// Keep ccxt out of the test process: treasury only needs getExchange for real mode.
vi.mock('../ccxtFeed.mjs', () => ({ getExchange: () => { throw new Error('no exchange in unit tests'); } }));

const { availableForTrading, reserve, release, listReservations, InsufficientBalanceError } = await import('../treasury.mjs');

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_DATA_DIR = path.resolve(__dirname, '../../../data');
const STATE_FILE = path.join(REPO_DATA_DIR, 'genesis_treasury_state.json');
const LEDGER_FILE = path.join(REPO_DATA_DIR, 'genesis_treasury_ledger.jsonl');

let origState = null;
let origLedger = null;

function writeState(obj) {
  fs.mkdirSync(REPO_DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify({
    paperBalanceUSDT: 0,
    allocatedToTrading: 0,
    reservedForWithdrawal: 0,
    totalDeposited: 0,
    totalWithdrawn: 0,
    pending: [],
    approvedWhitelistSetup: false,
    reservations: [],
    ...obj,
  }, null, 2));
}

beforeAll(() => {
  try { origState = fs.readFileSync(STATE_FILE, 'utf8'); } catch { origState = null; }
  try { origLedger = fs.readFileSync(LEDGER_FILE, 'utf8'); } catch { origLedger = null; }
});

afterEach(() => {
  writeState({ paperBalanceUSDT: 200, reservations: [] });
});

afterAll(() => {
  if (origState !== null) fs.writeFileSync(STATE_FILE, origState);
  else if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
  if (origLedger !== null) fs.writeFileSync(LEDGER_FILE, origLedger);
  else if (fs.existsSync(LEDGER_FILE) && fs.statSync(LEDGER_FILE).size === 0) fs.unlinkSync(LEDGER_FILE);
});

describe('treasury live-trading reservations', () => {
  it('availableForTrading: balance 200 with 40 reserved -> 160 free', () => {
    // Pure form first (no disk involved).
    expect(availableForTrading({ paperBalanceUSDT: 200, reservations: [{ amount: 40 }] })).toBe(160);
    // And through the persisted state.
    writeState({ paperBalanceUSDT: 200, reservations: [{ id: 'rs_x', amount: 40, reason: 'test' }] });
    expect(+availableForTrading().toFixed(9)).toBe(160);
  });

  it('reserve beyond the free balance throws InsufficientBalanceError and reserves nothing', () => {
    writeState({ paperBalanceUSDT: 200, reservations: [{ id: 'rs_y', amount: 40, reason: 'test' }] });
    let err = null;
    try {
      reserve(500, 'should not fit');
    } catch (e) { err = e; }
    expect(err).toBeInstanceOf(InsufficientBalanceError);
    expect(err.code).toBe('INSUFFICIENT_BALANCE');
    // Nothing extra was booked.
    expect(listReservations().length).toBe(1);
    expect(+availableForTrading().toFixed(9)).toBe(160);
  });

  it('reserve blocks capital and release frees it again', () => {
    writeState({ paperBalanceUSDT: 200, reservations: [] });
    expect(+availableForTrading().toFixed(9)).toBe(200);

    const { reservationId } = reserve(40, 'unit-test position');
    expect(reservationId).toBeTruthy();
    expect(listReservations()).toHaveLength(1);
    expect(listReservations()[0].amount).toBe(40);
    expect(+availableForTrading().toFixed(9)).toBe(160);

    const { released } = release(reservationId);
    expect(released).toBe(40);
    expect(listReservations()).toHaveLength(0);
    expect(+availableForTrading().toFixed(9)).toBe(200);
  });
});
