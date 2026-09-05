// api/genesis/founder.js — founder control/readiness manifest.
// This endpoint exposes only booleans and operating posture. It never returns secrets
// and never places orders. Live execution requires server-side credentials, limits,
// kill switch, and an external owner-controlled cutover.

import { sendJson, sendMethodNotAllowed } from '../_lib/http.js';

function envBool(name) {
  const v = String(process.env[name] || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function present(name) {
  return Boolean(String(process.env[name] || '').trim());
}

function gate(id, label, ok, detail) {
  return { id, label, ok: Boolean(ok), detail };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendMethodNotAllowed(res, 'GET');

  const realTradingRequested = envBool('REAL_TRADING') || envBool('LIVE_MODE');
  const ownerConfirm = String(process.env.REAL_TRADING_CONFIRM || '') === 'I_ACCEPT_REAL_MONEY_RISK';
  const killSwitchArmed = envBool('GENESIS_KILL_SWITCH_ARMED');
  const maxDailyLossSet = present('GENESIS_MAX_DAILY_LOSS_USDT');
  const maxOrderSet = present('GENESIS_MAX_ORDER_NOTIONAL_USDT');
  const exchangeKeys = present('BINANCE_API_KEY') || present('OKX_API_KEY');
  const exchangeSecret = present('BINANCE_API_SECRET') || present('OKX_API_SECRET');
  const forexKeys = present('OANDA_API_KEY') || present('ALPACA_API_KEY') || present('IBKR_ACCOUNT_ID');
  const walletConfigured = present('WALLET_PUBLIC_ADDRESS') || present('OWNER_WALLET_ADDRESS');

  const gates = [
    gate('owner-confirm', 'Founder confirmation phrase', ownerConfirm, 'REAL_TRADING_CONFIRM must equal I_ACCEPT_REAL_MONEY_RISK.'),
    gate('kill-switch', 'Kill switch armed', killSwitchArmed, 'GENESIS_KILL_SWITCH_ARMED must be true before any live adapter can be considered.'),
    gate('risk-limits', 'Loss and order caps', maxDailyLossSet && maxOrderSet, 'Set max daily loss and max order notional in server env.'),
    gate('exchange-keys', 'Exchange credentials', exchangeKeys && exchangeSecret, 'At least one CEX key+secret pair must exist server-side; never in browser.'),
    gate('wallet-owner', 'Owner wallet identity', walletConfigured, 'Owner wallet/address is used for founder identity, not as a hot signing wallet.'),
  ];

  const allGatesOk = gates.every((g) => g.ok);
  const liveStatus = realTradingRequested
    ? (allGatesOk ? 'READY_FOR_EXTERNAL_CUTOVER' : 'REQUESTED_BUT_BLOCKED')
    : 'OFF_BY_DEFAULT';

  return sendJson(res, 200, {
    ok: true,
    ts: new Date().toISOString(),
    founder: {
      role: 'CEO_FOUNDER_OWNER',
      authority: 'FULL_APP_CONTROL',
      note: 'Owner has full UI/config authority. Secrets and live execution must remain server-side and externally confirmed.',
    },
    live: {
      requested: realTradingRequested,
      status: liveStatus,
      canClientFlipLive: false,
      reason: allGatesOk
        ? 'All server readiness gates are green; live cutover still requires external owner-controlled deployment/ops confirmation.'
        : 'One or more server readiness gates are missing. Client buttons cannot flip real-money execution.',
      gates,
    },
    strategyFocus: {
      primary: 'crypto_futures_scalping_and_funding',
      secondary: 'forex_sessions_london_new_york',
      scout: 'lp_farming_and_prediction_markets',
      avoidUntilProven: 'thin_memecoins_and_unhedged_yield',
      decision: 'Build one real institutional pipeline first: crypto futures + forex sessions, with LP/farming only as scanner until risk is modeled.',
    },
    connectors: [
      { id: 'okx', name: 'OKX', market: 'crypto_futures', mode: exchangeKeys && exchangeSecret ? 'credentials_present' : 'market_data_only', permissions: ['market_data', 'funding', 'orders_server_side_when_gated'] },
      { id: 'binance', name: 'Binance / CCXT', market: 'crypto_futures', mode: exchangeKeys && exchangeSecret ? 'credentials_present' : 'market_data_only', permissions: ['market_data', 'futures', 'orders_server_side_when_gated'] },
      { id: 'forex', name: 'Forex Broker', market: 'fx', mode: forexKeys ? 'credentials_present' : 'connector_required', permissions: ['sessions', 'quotes', 'orders_server_side_when_gated'] },
      { id: 'wallet', name: 'Owner Wallet', market: 'identity_treasury', mode: walletConfigured ? 'identity_present' : 'connect_owner_wallet', permissions: ['identity', 'treasury_view', 'no_hot_signing_in_browser'] },
      { id: 'lp', name: 'LP / Farming Scout', market: 'defi', mode: 'scanner_only', permissions: ['apy_scan', 'il_model', 'risk_score', 'no_auto_deposit'] },
    ],
    agents: [
      { id: 'hermes', name: 'HERMES', desk: 'Connectors', job: 'Route exchange, wallet, broker, and data feeds with permission tiers.', state: 'ready_to_wire' },
      { id: 'atlas', name: 'ATLAS', desk: 'Quant Research', job: 'Find edges across crypto futures, forex sessions, funding, and basis.', state: 'research_live_data' },
      { id: 'sentinel', name: 'SENTINEL', desk: 'Risk', job: 'Enforce loss caps, max notional, kill switch, and no-overfit gates.', state: 'must_stay_authoritative' },
      { id: 'execution', name: 'EXECUTION', desk: 'Order Ops', job: 'Prepare server-side adapters; no browser secrets and no ungated orders.', state: 'blocked_until_gates' },
      { id: 'oracle', name: 'ORACLE', desk: 'Market Regime', job: 'Classify Asia/London/NY sessions, volatility, spreads, and macro windows.', state: 'needs_forex_feed' },
      { id: 'forge', name: 'FORGE', desk: 'Strategy Factory', job: 'Generate challenger bots and promote only after out-of-sample proof.', state: 'ready_for_astra' },
    ],
  });
}
