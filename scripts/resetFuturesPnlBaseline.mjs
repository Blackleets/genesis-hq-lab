import db from '../server/db/database.mjs';

const BASELINE_KEY = 'futures_pnl_baseline';

function writeBaseline() {
  const baseline = {
    baselineAt: new Date().toISOString(),
    resetBy: 'operator',
    note: 'Futures PnL reporting baseline reset',
  };

  db.prepare(`
    INSERT OR REPLACE INTO org_state (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
  `).run(BASELINE_KEY, JSON.stringify(baseline));

  return baseline;
}

try {
  const baseline = writeBaseline();
  console.log(JSON.stringify({ ok: true, baseline }, null, 2));
} catch (error) {
  console.error('[resetFuturesPnlBaseline] failed:', error);
  process.exit(1);
}
