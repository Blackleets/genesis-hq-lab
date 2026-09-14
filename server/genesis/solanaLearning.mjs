function keyOf(event) {
  const venues = Array.isArray(event?.venues) ? event.venues.join('>') : 'unknown';
  const tokens = Array.isArray(event?.tokens) ? event.tokens.join('>') : 'unknown';
  const hour = String(event?.timestamp ?? '').slice(11, 13) || 'unknown';
  const bucket = (value, size) => Number.isFinite(Number(value)) ? `${Math.floor(Number(value) / size) * size}+` : 'unknown';
  return {
    key: `${venues}|${event?.route || 'unknown'}|${tokens}|${hour}|${bucket(event?.latencyMs, 50)}|${bucket(event?.priorityFeeUsd, 0.005)}|${bucket(event?.actualSlippageBps, 5)}|${bucket(event?.inputAmountUsd, 25)}|${event?.marketRegime || 'unknown'}`,
    dimensions: {
      venues, route: event?.route || 'unknown', tokenPair: tokens, hour,
      latencyMs: bucket(event?.latencyMs, 50), priorityFeeUsd: bucket(event?.priorityFeeUsd, 0.005),
      slippageBps: bucket(event?.actualSlippageBps, 5), notionalUsd: bucket(event?.inputAmountUsd, 25),
      marketRegime: event?.marketRegime || 'unknown',
    },
  };
}

export function buildSolanaLearningSnapshot(events) {
  const groups = new Map();
  for (const event of Array.isArray(events) ? events : []) {
    if (event?.type !== 'CAPTURE_MEASURED') continue;
    const { key, dimensions } = keyOf(event);
    const row = groups.get(key) ?? { key, dimensions, samples: 0, expectedNetPnlUsd: 0, capturedNetPnlUsd: 0, failures: 0, captureRatios: [] };
    row.samples += 1;
    row.expectedNetPnlUsd += Number(event.expectedNetPnlUsd ?? 0);
    row.capturedNetPnlUsd += Number(event.capturedNetPnlUsd ?? 0);
    if (Number(event.capturedNetPnlUsd ?? 0) <= 0) row.failures += 1;
    if (Number.isFinite(Number(event.captureRatio))) row.captureRatios.push(Number(event.captureRatio));
    groups.set(key, row);
  }
  return [...groups.values()].map((row) => ({
    key: row.key,
    dimensions: row.dimensions,
    samples: row.samples,
    expectedNetPnlUsd: row.expectedNetPnlUsd,
    capturedNetPnlUsd: row.capturedNetPnlUsd,
    netExpectancyUsd: row.samples ? row.capturedNetPnlUsd / row.samples : null,
    captureRatio: row.captureRatios.length ? row.captureRatios.reduce((sum, value) => sum + value, 0) / row.captureRatios.length : null,
    failureRate: row.samples ? row.failures / row.samples : null,
    penalty: row.samples >= 5 && (row.failures / row.samples > 0.4 || row.capturedNetPnlUsd <= 0),
  }));
}
