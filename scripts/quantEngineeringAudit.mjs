import fs from 'node:fs';
import path from 'node:path';
import { buildEconomicEdgeAudit } from '../server/quant/economicEdgeAudit.mjs';

const SUPABASE_URL = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

function argValue(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

const strict = process.argv.includes('--strict');
const outputPath = argValue('out');

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('[quant:audit] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/SUPABASE_ANON_KEY are required.');
  process.exit(1);
}

const headers = {
  apikey: SUPABASE_KEY,
  authorization: `Bearer ${SUPABASE_KEY}`,
  'content-type': 'application/json',
};

async function rest(resource) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${resource}`, {
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`supabase_${response.status}:${await response.text()}`);
  return response.json();
}

async function loadClosedFuturesTrades() {
  const select = [
    'id', 'trade_type', 'instrument_type', 'asset_pair', 'outcome', 'status', 'mode',
    'confidence', 'entry_price', 'exit_price', 'shares', 'capital_used', 'leverage',
    'notional_usd', 'entry_volume24h', 'funding_rate', 'funding_paid', 'pnl',
    'opened_at', 'closed_at', 'evidence', 'strategy_version_id', 'entry_regime',
    'entry_session', 'runner_version', 'validation_status',
  ].join(',');
  return rest(`trades?status=eq.closed&trade_type=like.crypto_futures_%25&select=${encodeURIComponent(select)}&order=closed_at.asc&limit=5000`);
}

async function loadResearchEvidence() {
  const select = 'strategy_version_id,evaluated_at,walk_forward,oos_evidence,verdict,policy_version,runner_version';
  const rows = await rest(`strategy_validation_snapshots?select=${encodeURIComponent(select)}&order=evaluated_at.desc&limit=500`);
  const latest = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row?.strategy_version_id && !latest[row.strategy_version_id]) latest[row.strategy_version_id] = row;
  }
  return latest;
}

try {
  const [trades, researchEvidence] = await Promise.all([
    loadClosedFuturesTrades(),
    loadResearchEvidence(),
  ]);
  const audit = buildEconomicEdgeAudit(trades, { researchEvidence });
  const serialized = `${JSON.stringify(audit, null, 2)}\n`;

  if (outputPath) {
    const target = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, serialized, 'utf8');
    console.error(`[quant:audit] wrote ${target}`);
  }

  process.stdout.write(serialized);

  if (strict && audit.verdict === 'KILL_PRESENT') process.exitCode = 2;
} catch (error) {
  console.error(`[quant:audit] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
