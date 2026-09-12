import fs from 'node:fs';
import path from 'node:path';
import { buildEconomicEdgeAudit } from '../server/quant/economicEdgeAudit.mjs';
import { buildProfitRatchetExitAudit } from '../server/quant/profitRatchetExitAudit.mjs';

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
const inputPath = argValue('input');

if (!inputPath && (!SUPABASE_URL || !SUPABASE_KEY)) {
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

// Continue on every nonempty page, including pages capped by the server.
async function loadAll(resource) {
  const rows = [];
  for (;;) {
    const page = await rest(`${resource}&limit=500&offset=${rows.length}`);
    if (!Array.isArray(page)) throw new Error('invalid_rest_page');
    if (!page.length) return rows;
    rows.push(...page);
  }
}

async function loadClosedFuturesTrades() {
  const select = [
    'id', 'trade_type', 'instrument_type', 'asset_pair', 'outcome', 'status', 'mode',
    'confidence', 'entry_price', 'exit_price', 'shares', 'capital_used', 'leverage',
    'notional_usd', 'entry_volume24h', 'funding_rate', 'funding_paid', 'pnl',
    'opened_at', 'closed_at', 'evidence', 'strategy_version_id', 'entry_regime',
    'entry_session', 'runner_version', 'validation_status',
  ].join(',');
  return loadAll(`trades?status=eq.closed&trade_type=like.crypto_futures_%25&select=${encodeURIComponent(select)}&order=closed_at.asc,id.asc`);
}

async function loadRatchetTelemetry() {
  const select = [
    'trade_id', 'strategy_version_id', 'runner_version', 'exit_policy_version', 'asset_pair', 'side',
    'entry_regime', 'entry_session', 'leverage', 'notional_usd', 'initial_stop_price', 'last_ratchet_stop_price',
    'mfe_net_usd', 'mae_observed_net_usd', 'max_protected_profit_usd', 'current_net_pnl_usd', 'realized_net_pnl_usd',
    'max_giveback_usd', 'capture_efficiency', 'giveback_pct_mfe', 'protected_profit_efficiency', 'ratchet_activated',
    'ratchet_raise_count', 'ratchet_save_exit', 'winner_lost', 'counterfactual_without_ratchet_proven', 'counterfactual_note',
    'activation_at', 'activation_strength', 'activation_regime', 'activation_momentum20', 'activation_order_book_imbalance', 'activation_atr_pct',
    'last_context_at', 'last_strength', 'last_regime', 'last_momentum20', 'last_order_book_imbalance', 'last_atr_pct',
    'close_context_at', 'close_strength', 'close_regime', 'close_momentum20', 'close_order_book_imbalance', 'close_atr_pct',
    'close_context_source', 'exit_reason', 'opened_at', 'closed_at', 'observation_count', 'telemetry_scope',
  ].join(',');
  return rest(`futures_ratchet_telemetry?strategy_version_id=like.%25%3Av9&select=${encodeURIComponent(select)}&order=opened_at.asc&limit=5000`);
}

async function loadResearchEvidence() {
  const select = 'strategy_version_id,evaluated_at,walk_forward,oos_evidence,verdict,policy_version,runner_version';
  const rows = await loadAll(`strategy_validation_snapshots?select=${encodeURIComponent(select)}&order=evaluated_at.desc,id.desc`);
  const latest = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row?.strategy_version_id && !latest[row.strategy_version_id]) latest[row.strategy_version_id] = row;
  }
  return latest;
}

try {
  const input = inputPath ? JSON.parse(fs.readFileSync(path.resolve(inputPath), 'utf8')) : null;
  if (inputPath && (!input || !Array.isArray(input.trades) || !input.researchEvidence || typeof input.researchEvidence !== 'object')) throw new Error('invalid_audit_snapshot');
  const [trades, researchEvidence, ratchetTelemetry] = input
    ? [input.trades, input.researchEvidence, Array.isArray(input.ratchetTelemetry) ? input.ratchetTelemetry : []]
    : await Promise.all([
      loadClosedFuturesTrades(),
      loadResearchEvidence(),
      loadRatchetTelemetry(),
    ]);
  const economicAudit = buildEconomicEdgeAudit(trades, {
    researchEvidence,
    ...(input?.capturedAt ? { generatedAt: input.capturedAt } : {}),
  });
  const ratchetAudit = buildProfitRatchetExitAudit(ratchetTelemetry);
  const audit = {
    ...economicAudit,
    profitRatchet: ratchetAudit,
  };
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
