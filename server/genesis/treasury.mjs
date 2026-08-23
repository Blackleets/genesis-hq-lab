// server/genesis/treasury.mjs
// GENESIS TREASURY — deposit / withdraw / capital-allocation orchestration.
//
// DESIGN (safety first):
//  - This module NEVER moves real money by itself. Every real operation is a
//    two-step flow: REQUEST -> HUMAN APPROVE (token) -> EXECUTE.
//  - Real operations additionally require:
//      REAL_TRADING=true in .env, exchange API keys in .env, and
//      withdrawal addresses pre-registered in data/genesis_treasury_whitelist.json
//      (created by the human, never by the agent).
//  - Paper mode works with zero keys for testing the whole flow end-to-end.
//
// Usage:
//   node treasury.mjs status                       # balances + allocation plan
//   node treasury.mjs deposit <amountUSDT>         # record paper deposit intent
//   node treasury.mjs withdraw <amountUSDT> <addressLabel>   # request withdrawal
//   node treasury.mjs approve <requestId> <token>  # human approves pending op
//   node treasury.mjs allocate                     # show how capital is split
//
// Env: GENESIS_API_KEY/SECRET (real mode), REAL_TRADING=true, GENESIS_TREASURY_CAP (max USDT the desk may hold).

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { getExchange } from './ccxtFeed.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const STATE_FILE = path.join(DATA_DIR, 'genesis_treasury_state.json');
const WHITELIST_FILE = path.join(DATA_DIR, 'genesis_treasury_whitelist.json');
const LEDGER_FILE = path.join(DATA_DIR, 'genesis_treasury_ledger.jsonl');

const MAX_DESK_CAP_USD = parseFloat(process.env.GENESIS_TREASURY_CAP || '500');

function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function saveJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}
function appendLedger(entry) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.appendFileSync(LEDGER_FILE, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
}

function isRealMode() {
  return ['1', 'true', 'yes'].includes((process.env.REAL_TRADING ?? '').toLowerCase());
}

function loadState() {
  const s = loadJson(STATE_FILE, {
    paperBalanceUSDT: 0,
    allocatedToTrading: 0,
    reservedForWithdrawal: 0,
    totalDeposited: 0,
    totalWithdrawn: 0,
    pending: [],
    approvedWhitelistSetup: false,
  });
  return s;
}

// ---- Allocation policy: never trade more than 20% of desk balance; keep
// 50% dry powder; cap total desk exposure. ----
export function allocationPlan(state) {
  const balance = state.paperBalanceUSDT;
  const tradingAlloc = Math.min(balance * 0.2, MAX_DESK_CAP_USD * 0.2);
  const reserve = balance - tradingAlloc;
  return { balance, tradingAlloc: +tradingAlloc.toFixed(2), reserve: +reserve.toFixed(2), cap: MAX_DESK_CAP_USD };
}

async function fetchRealBalances() {
  if (!isRealMode()) return null;
  const ex = getExchange({ real: true });
  const bal = await ex.fetchBalance();
  return { USDT: bal.total?.USDT ?? 0, free: bal.free?.USDT ?? 0 };
}

// ---- Commands ----

async function cmdStatus() {
  const state = loadState();
  let real = null;
  try { real = await fetchRealBalances(); } catch (e) { real = { error: e.message }; }
  const plan = allocationPlan(state);
  console.log('=== GENESIS TREASURY STATUS ===');
  console.log(`mode: ${isRealMode() ? 'REAL (keys present)' : 'PAPER'}`);
  console.log(`paper balance: $${state.paperBalanceUSDT} | allocated to trading: $${state.allocatedToTrading}`);
  console.log(`lifetime deposits: $${state.totalDeposited} | lifetime withdrawals: $${state.totalWithdrawn}`);
  console.log(`allocation plan: trade $${plan.tradingAlloc} | reserve $${plan.reserve} (cap $${plan.cap})`);
  console.log(`pending ops: ${state.pending.length}`);
  if (real) console.log('real exchange balance:', JSON.stringify(real));
  return state;
}

async function cmdDeposit(amount) {
  const state = loadState();
  if (!(amount > 0)) throw new Error('amount must be > 0');
  const newBalance = state.paperBalanceUSDT + amount;
  if (newBalance > MAX_DESK_CAP_USD && !isRealMode()) throw new Error(`paper deposit would exceed desk cap $${MAX_DESK_CAP_USD} — adjust GENESIS_TREASURY_CAP`);
  state.paperBalanceUSDT = newBalance;
  state.totalDeposited += amount;
  appendLedger({ op: 'deposit', amount, mode: isRealMode() ? 'real' : 'paper', balanceAfter: newBalance });
  saveJson(STATE_FILE, state);
  console.log(`DEPOSIT OK: $${amount} -> balance $${newBalance} (${isRealMode() ? 'real' : 'paper'})`);
}

async function cmdWithdraw(amount, addressLabel) {
  const state = loadState();
  if (!(amount > 0)) throw new Error('amount must be > 0');
  if (amount > state.paperBalanceUSDT - state.reservedForWithdrawal) throw new Error('insufficient free balance');
  const whitelist = loadJson(WHITELIST_FILE, null);
  if (!whitelist || !Array.isArray(whitelist.addresses) || !whitelist.addresses.includes(addressLabel)) {
    throw new Error(`address "${addressLabel}" not in whitelist. The whitelist file must be created BY THE HUMAN at ${WHITELIST_FILE}`);
  }
  // Two-step: create request, human approves with token.
  const id = `wd_${Date.now()}`;
  const token = Math.random().toString(36).slice(2, 10).toUpperCase();
  state.pending.push({ id, type: 'withdraw', amount, addressLabel, token, createdAt: new Date().toISOString() });
  saveJson(STATE_FILE, state);
  appendLedger({ op: 'withdraw_request', id, amount, addressLabel });
  console.log(`WITHDRAWAL REQUESTED: ${id} — approve with: node treasury.mjs approve ${id} ${token}`);
}

async function cmdApprove(id, token) {
  const state = loadState();
  const req = state.pending.find(p => p.id === id && p.token === token);
  if (!req) throw new Error('no matching pending request (id+token)');
  if (!isRealMode()) {
    state.paperBalanceUSDT -= req.amount;
    state.totalWithdrawn += req.amount;
    state.pending = state.pending.filter(p => p.id !== id);
    appendLedger({ op: 'withdraw_executed', ...req, mode: 'paper' });
    saveJson(STATE_FILE, state);
    console.log(`PAPER WITHDRAWAL EXECUTED: -$${req.amount} -> balance $${state.paperBalanceUSDT}`);
    return;
  }
  // REAL mode: verify on-exchange balance then execute via ccxt.
  const ex = getExchange({ real: true });
  const bal = await ex.fetchBalance();
  const freeUSDT = bal.free?.USDT ?? 0;
  if (freeUSDT < req.amount) throw new Error(`real balance $${freeUSDT} < requested $${req.amount}`);
  const whitelist = loadJson(WHITELIST_FILE, null);
  if (!whitelist?.addresses?.includes(req.addressLabel)) throw new Error('address not whitelisted');
  const addr = whitelist.entries?.[req.addressLabel];
  if (!addr) throw new Error(`no address mapped for label "${req.addressLabel}"`);
  const wd = await ex.withdraw('USDT', req.amount, addr.address, undefined, { network: addr.network });
  state.pending = state.pending.filter(p => p.id !== id);
  state.paperBalanceUSDT -= req.amount;
  state.totalWithdrawn += req.amount;
  appendLedger({ op: 'withdraw_executed_real', ...req, exchangeResult: { id: wd.id, status: wd.status }, mode: 'real' });
  saveJson(STATE_FILE, state);
  console.log(`REAL WITHDRAWAL SUBMITTED: ccxt id=${wd.id} status=${wd.status} — VERIFY IN EXCHANGE UI`);
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case 'status': await cmdStatus(); break;
    case 'deposit': await cmdDeposit(parseFloat(args[0])); break;
    case 'withdraw': await cmdWithdraw(parseFloat(args[0]), args[1]); break;
    case 'approve': await cmdApprove(args[0], args[1]); break;
    case 'allocate': {
      const plan = allocationPlan(loadState());
      console.log(JSON.stringify(plan, null, 2));
      break;
    }
    default:
      console.log('commands: status | deposit <usdt> | withdraw <usdt> <label> | approve <id> <token> | allocate');
  }
}

main().then(() => process.exit(0)).catch(e => { console.error('ERROR:', e.message); process.exit(1); });
