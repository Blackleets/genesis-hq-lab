// Server-only catalog. Environment VARIABLE NAMES are public; values never are.
export const CONNECTOR_DEFINITIONS = Object.freeze([
  { id: 'owner_wallet', name: 'Owner wallet identity', category: 'identity', mode: 'read_only', permissions: ['identity.read'], requiredEnv: ['GENESIS_OWNER_ADDRESS'] },
  { id: 'okx', name: 'OKX', category: 'crypto_futures', mode: 'read_only', permissions: ['market.read'], requiredEnv: ['OKX_API_KEY', 'OKX_SECRET_KEY', 'OKX_PASSPHRASE'] },
  { id: 'binance', name: 'Binance / CCXT', category: 'crypto_futures', mode: 'read_only', permissions: ['market.read'], requiredEnv: ['BINANCE_API_KEY', 'BINANCE_API_SECRET'] },
  { id: 'forex', name: 'OANDA Forex', category: 'forex', mode: 'read_only', permissions: ['market.read'], requiredEnv: ['OANDA_API_TOKEN', 'OANDA_ACCOUNT_ID'] },
  { id: 'prediction_markets', name: 'Kalshi / Polymarket', category: 'prediction_markets', mode: 'read_only', permissions: ['market.read'], requiredEnv: [] },
  { id: 'lp_farming', name: 'LP / farming risk scout', category: 'defi_scanner', mode: 'read_only', permissions: ['market.read', 'risk.inspect'], requiredEnv: [] },
  { id: 'execution_broker', name: 'Execution gateway', category: 'execution', mode: 'live_locked', permissions: ['readiness.read'], requiredEnv: ['GENESIS_EXECUTION_VENUE', 'GENESIS_ACCOUNT_ID'] },
]);

export const VENUE_ENV = Object.freeze({
  okx: CONNECTOR_DEFINITIONS[1].requiredEnv,
  binance: CONNECTOR_DEFINITIONS[2].requiredEnv,
  oanda: CONNECTOR_DEFINITIONS[3].requiredEnv,
});

export const present = (env, key) => typeof env[key] === 'string' && env[key].trim().length > 0;
export const venueRequirements = env => Object.hasOwn(VENUE_ENV, env.GENESIS_EXECUTION_VENUE ?? '') ? VENUE_ENV[env.GENESIS_EXECUTION_VENUE] : [];

export function buildConnectorRegistry({ env, evidence, ownerVerified, now }) {
  return CONNECTOR_DEFINITIONS.map(def => {
    const requiredEnv = def.id === 'execution_broker'
      ? [...def.requiredEnv, ...venueRequirements(env)] : [...def.requiredEnv];
    const missing = requiredEnv.filter(key => !present(env, key));
    const check = evidence?.connectors?.[def.id];
    const checkedAt = Date.parse(check?.checkedAt);
    const fresh = Number.isFinite(checkedAt) && checkedAt <= now && now - checkedAt <= 60_000;
    const online = fresh && check?.status === 'online';
    let status = missing.length ? 'missing_credentials' : online ? 'online' : 'pending';
    let mode = def.mode;
    let blockers = missing.map(key => `Missing server configuration: ${key}`);
    if (!online) blockers.push('No fresh verified connector health evidence');
    if (def.id === 'owner_wallet') {
      status = ownerVerified ? 'online' : 'pending';
      blockers = ownerVerified ? [] : ['Owner identity requires verified off-chain wallet proof'];
    }
    if (def.id === 'lp_farming') {
      blockers.push('Scanner only: IL, fees, lockup, contract risk and exit liquidity are not approved');
    }
    if (def.id === 'execution_broker') {
      status = 'locked';
      blockers.push('Order submission is not exposed by Founder Control');
    } else if (def.id !== 'owner_wallet' && def.id !== 'lp_farming' && fresh && ['paper', 'testnet'].includes(check?.mode)) {
      mode = check.mode;
      if (online && mode === 'paper') status = 'paper_only';
    }
    return { ...def, mode, status, permissions: [...def.permissions], requiredEnv, blockers,
      health: online ? 'online' : 'unverified', lastCheck: fresh ? new Date(checkedAt).toISOString() : null };
  });
}
