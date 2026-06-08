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

async function getJsonSafe(path) {
  try {
    return { ok: true, data: await getJson(path) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function toPercent(value) {
  if (value == null || Number.isNaN(Number(value))) return 'n/a';
  return `${round2(Number(value) * 100)}%`;
}

function deriveDecision(overview, diagnostics, regimeBacktestResult) {
  const regimeBacktest = regimeBacktestResult?.ok ? regimeBacktestResult.data : null;
  const closedTrades = overview?.pnl?.closed?.total ?? 0;
  const expectancy = Number(overview?.pnl?.closed?.avgPnl ?? 0);
  const profitFactor = Number(diagnostics?.autopsy?.edgeSummary?.profitFactor ?? 0);
  const recommendation = diagnostics?.autopsy?.recommendation?.action ?? 'unknown';
  const backtestAvailable = Boolean(regimeBacktest);
  const consistent =
    closedTrades === (diagnostics?.autopsy?.totalSamples ?? -1) &&
    (!backtestAvailable || closedTrades === (regimeBacktest?.before?.trades ?? -2));

  let verdict = 'FREEZE_PENDING';
  let nextStep = 'Continue the short observation window.';
  let nextTrack = 'observe_current_strategy';

  if (!backtestAvailable) {
    verdict = 'BACKTEST_UNAVAILABLE';
    nextStep = 'Use overview + diagnostics for the decision, and repair /api/crypto/regime-backtest separately.';
    nextTrack = 'repair_backtest_endpoint';
  } else if (!consistent) {
    verdict = 'TRUTH_BROKEN';
    nextStep = 'Fix endpoint consistency before making any edge decision.';
    nextTrack = 'repair_truth';
  } else if (expectancy < 0 && profitFactor < 1) {
    verdict = 'PAUSE_OR_REDESIGN';
    nextStep = 'Stop treating scalp_v2 as a valid primary strategy and move to redesign.';
    nextTrack = 'single_pair_specialization';
  } else if (expectancy >= 0 && profitFactor >= 1) {
    verdict = 'FREEZE_AND_CONFIRM';
    nextStep = 'Keep filters, do not expand, and demand more confirming trades.';
    nextTrack = 'confirm_recovery';
  }

  return {
    backtestAvailable,
    consistent,
    closedTrades,
    expectancy: round2(expectancy),
    profitFactor: round2(profitFactor),
    recommendation,
    verdict,
    nextStep,
    nextTrack,
  };
}

async function main() {
  const [health, overview, diagnostics, regimeBacktest] = await Promise.all([
    getJson('/api/db/health'),
    getJson('/api/crypto/overview'),
    getJson('/api/crypto/diagnostics'),
    getJsonSafe('/api/crypto/regime-backtest'),
  ]);

  const summary = deriveDecision(overview, diagnostics, regimeBacktest);
  const llm = diagnostics?.llm ?? null;
  const candidateActions = diagnostics?.autopsy?.candidateActions ?? [];
  const regimeBacktestData = regimeBacktest.ok ? regimeBacktest.data : null;
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
      regimeBacktestAfterTrades: regimeBacktestData?.after?.trades ?? null,
      regimeBacktestAfterExpectancy: regimeBacktestData?.after?.expectancy != null ? round2(regimeBacktestData.after.expectancy) : null,
      regimeBacktestAfterProfitFactor: regimeBacktestData?.after?.profitFactor != null ? round2(regimeBacktestData.after.profitFactor) : null,
      overviewClosedTrades: overview?.pnl?.closed?.total ?? 0,
      autopsyTotalSamples: diagnostics?.autopsy?.totalSamples ?? 0,
      backtestBeforeTrades: regimeBacktestData?.before?.trades ?? null,
    },
    criteria: {
      truthConsistent: summary.consistent,
      backtestAvailable: summary.backtestAvailable,
      expectancyPositive: summary.expectancy > 0,
      profitFactorAboveOne: summary.profitFactor > 1,
      liveScalpDeterministic: llm?.usedByLiveScalp === false,
      claudeVerifiedForLegacyLoop: llm?.verification === 'verified',
    },
    backtest: regimeBacktest.ok
      ? {
          ok: true,
          before: regimeBacktestData?.before ?? null,
          after: regimeBacktestData?.after ?? null,
          rejected: regimeBacktestData?.rejected ?? null,
        }
      : {
          ok: false,
          error: regimeBacktest.error,
        },
    filters: {
      active: diagnostics?.autopsy?.manualFiltersActive ?? 0,
      setups: diagnostics?.autopsy?.manualFilters?.setups ?? [],
      hours: diagnostics?.autopsy?.manualFilters?.hours ?? [],
      confidenceBands: diagnostics?.autopsy?.manualFilters?.confidenceBands ?? [],
      pairs: diagnostics?.autopsy?.manualFilters?.pairs ?? [],
    },
    llm: llm ? {
      provider: llm.provider,
      usedByLiveScalp: llm.usedByLiveScalp,
      usedByLegacyCryptoLoop: llm.usedByLegacyCryptoLoop,
      configured: llm.configured,
      verification: llm.verification,
      available: llm.available,
      fallbackActive: llm.fallbackActive,
      lastProviderError: llm.lastProviderError,
      note: llm.note,
    } : null,
    recommendation: {
      action: diagnostics?.autopsy?.recommendation?.action ?? 'unknown',
      severity: diagnostics?.autopsy?.recommendation?.severity ?? 'unknown',
      reason: diagnostics?.autopsy?.recommendation?.reason ?? '',
    },
    candidateActions,
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
