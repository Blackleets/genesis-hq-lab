import { runStrategyLab, writeStrategyLabReport } from '../server/crypto/backtest/strategyLab.mjs';

function pf(value) {
  return value == null ? '-' : value.toFixed(2);
}

function pct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

const report = await runStrategyLab();
const outputPath = writeStrategyLabReport(report);

console.log('[crypto-strategy-lab] ranked by out-of-sample expectancy');
for (const result of report.results) {
  console.log(
    [
      `${result.id}`,
      `passed=${result.passed ? 'yes' : 'no'}`,
      `testEV=${result.test.expectancy.toFixed(3)}`,
      `testPF=${pf(result.test.profitFactor)}`,
      `testTrades=${result.test.trades}`,
      `trainEV=${result.train.expectancy.toFixed(3)}`,
      `trainPF=${pf(result.train.profitFactor)}`,
      `hourShare=${pct(result.concentration.hour.share)}`,
      `sideShare=${pct(result.concentration.side.share)}`,
      result.rejectReason ? `reject=${result.rejectReason}` : 'reject=-',
    ].join(' | ')
  );
}

console.log(`[crypto-strategy-lab] winner=${report.winner?.id ?? 'none'}`);
console.log(`[crypto-strategy-lab] report=${outputPath}`);
