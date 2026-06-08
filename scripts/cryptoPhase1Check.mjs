const BASE_URL = process.env.GENESIS_BACKEND_URL ?? 'https://genesis-hq-backend.onrender.com';

async function getJson(path) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`${path} failed: ${res.status}`);
  }
  return res.json();
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function toPercent(value) {
  if (value == null || Number.isNaN(Number(value))) return 'n/a';
  return `${round2(Number(value) * 100)}%`;
}

function deriveDecision(overview, diagnostics, regimeBacktest) {
  const closedTrades = overview?.pnl?.closed?.total ?? 0;
  const expectancy = Number(overview?.pnl?.closed?.avgPnl ?? 0);
  const profitFactor = Number(diagnostics?.autopsy?.edgeSummary?.profitFactor ?? 0);
  const recommendation = diagnostics?.autopsy?.recommendation?.action ?? 'unknown';
  const consistent =
    closedTrades === (diagnostics?.autopsy?.totalSamples ?? -1) &&
    closedTrades === (regimeBacktest?.before?.trades ?? -2);

  let verdict = 'FREEZE_PENDING';
  let nextStep = 'Continue the short observation window.';

  if (!consistent) {
    verdict = 'TRUTH_BROKEN';
    nextStep = 'Fix endpoint consistency before making any edge decision.';
  } else if (expectancy < 0 && profitFactor < 1) {
    verdict = 'PAUSE_OR_REDESIGN';
    nextStep = 'Stop treating scalp_v2 as a valid primary strategy and move to redesign.';
  } else if (expectancy >= 0 && profitFactor >= 1) {
    verdict = 'FREEZE_AND_CONFIRM';
    nextStep = 'Keep filters, do not expand, and demand more confirming trades.';
  }

  return {
    consistent,
    closedTrades,
    expectancy: round2(expectancy),
    profitFactor: round2(profitFactor),
    recommendation,
    verdict,
    nextStep,
  };
}

async function main() {
  const [health, overview, diagnostics, regimeBacktest] = await Promise.all([
    getJson('/api/db/health'),
    getJson('/api/crypto/overview'),
    getJson('/api/crypto/diagnostics'),
    getJson('/api/crypto/regime-backtest'),
  ]);

  const summary = deriveDecision(overview, diagnostics, regimeBacktest);
  const output = {
    checkedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    health: {
      connected: health?.postgres?.connected ?? false,
      mode: health?.mode ?? null,
    },
    metrics: {
      closedTrades: summary.closedTrades,
      wins: overview?.pnl?.closed?.wins ?? 0,
      winRate: toPercent(overview?.pnl?.closed?.winRate),
      totalPnl: round2(overview?.pnl?.closed?.totalPnl ?? 0),
      expectancy: summary.expectancy,
      profitFactor: summary.profitFactor,
      overviewClosedTrades: overview?.pnl?.closed?.total ?? 0,
      autopsyTotalSamples: diagnostics?.autopsy?.totalSamples ?? 0,
      backtestBeforeTrades: regimeBacktest?.before?.trades ?? 0,
    },
    filters: {
      active: diagnostics?.autopsy?.manualFiltersActive ?? 0,
      setups: diagnostics?.autopsy?.manualFilters?.setups ?? [],
      hours: diagnostics?.autopsy?.manualFilters?.hours ?? [],
      confidenceBands: diagnostics?.autopsy?.manualFilters?.confidenceBands ?? [],
      pairs: diagnostics?.autopsy?.manualFilters?.pairs ?? [],
    },
    recommendation: {
      action: diagnostics?.autopsy?.recommendation?.action ?? 'unknown',
      severity: diagnostics?.autopsy?.recommendation?.severity ?? 'unknown',
      reason: diagnostics?.autopsy?.recommendation?.reason ?? '',
    },
    decision: summary,
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    checkedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    error: error.message,
  }, null, 2));
  process.exitCode = 1;
});
