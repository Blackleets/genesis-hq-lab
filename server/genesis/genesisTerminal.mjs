// server/genesis/genesisTerminal.mjs
// The Genesis Terminal — interactive CLI that runs real-data backtests and the
// evolution loop, then reports the 6-gate verdict. PAPER ONLY. No execution.
//
// Usage:
//   node server/genesis/genesisTerminal.mjs              (interactive REPL)
//   node server/genesis/genesisTerminal.mjs --evolve     (run evolution, print report)
//   node server/genesis/genesisTerminal.mjs --backtest BT COTIUSDT 1h 60  (quick OOS check)

import { fetchKlines } from '../crypto/backtest/historicalData.mjs';
import { fullReport } from './backtestCore.mjs';
import { makeStrategy } from './strategyLib.mjs';
import { runEvolution } from './evolutionLoops.mjs';

const DEFAULT_PAIRS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'COTIUSDT', 'XLMUSDT'];

function fmtGates(gates) {
  return gates.gates.map(g => `   [${g.pass ? 'PASS' : 'FAIL'}] ${g.name} (${g.value})`).join('\n');
}

function printReport(title, metrics, gates) {
  console.log(`\n=== ${title} ===`);
  console.log(`Trades: ${metrics.trades} | WR: ${(metrics.winRate * 100).toFixed(1)}% | PF: ${isFinite(metrics.profitFactor) ? metrics.profitFactor.toFixed(2) : 'inf'} | EV%/trade: ${metrics.expectancyPctPerTrade.toFixed(3)}% | t-stat: ${metrics.tstat.toFixed(2)} | MaxDD: ${(metrics.maxDrawdown * 100).toFixed(1)}%`);
  console.log(`Return: ${(metrics.returnPct * 100).toFixed(1)}% | Final: $${metrics.finalCapital.toFixed(0)}`);
  console.log(`GATES ${gates.passed}/${gates.total}`);
  console.log(fmtGates(gates));
  console.log(gates.go ? '>> GO: strategy passes all 6 gates on REAL data\n' : '>> NO-GO: not ready for capital\n');
}

async function backtestCmd(args) {
  const pair = args[0] || 'BTCUSDT';
  const interval = args[1] || '1h';
  const days = Number(args[2] || 90);
  console.log(`Fetching REAL ${pair} ${interval} data (${days}d)...`);
  const candles = await fetchKlines(pair, { days, interval });
  console.log(`Got ${candles.length} candles.`);
  const kind = args[3] || 'meanReversion';
  const params = JSON.parse(args[4] || '{}');
  const fn = makeStrategy(kind, params);
  const { metrics, gates } = fullReport(candles, fn);
  printReport(`${pair} ${kind}`, metrics, gates);
}

async function evolveCmd(args) {
  const pair = args[0] || 'BTCUSDT';
  const interval = args[1] || '1h';
  const days = Number(args[2] || 180);
  const gens = Number(args[3] || 8);
  console.log(`Fetching REAL ${pair} ${interval} data (${days}d) for evolution...`);
  const candles = await fetchKlines(pair, { days, interval });
  console.log(`Got ${candles.length} candles. Evolving ${gens} generations...\n`);
  const { mission, history, bestEver, top } = await runEvolution({
    candles, generations: gens, populationSize: 18, eliteCount: 6, topN: 5,
    onGeneration: (h) => console.log(`Gen ${h.gen}: bestFitness=${h.bestFitness} gates=${h.passedGates} GO=${h.bestGo} PF=${h.bestMetrics.pf} WR=${h.bestMetrics.wr}% t=${h.bestMetrics.tstat} DD=${h.bestMetrics.dd}%`),
  });
  console.log('\n=== EVOLUTION HISTORY ===');
  history.forEach(h => console.log(`Gen ${h.gen}: gates=${h.passedGates} GO=${h.bestGo} fitness=${h.bestFitness}`));
  console.log('\n=== TOP CANDIDATES (real data, PAPER) ===');
  top.forEach((c, i) => {
    console.log(`\n#${i + 1} ${c.kind}  fitness=${c.fitness}  GO=${c.go} gates=${c.passedGates}`);
    console.log(`   params: ${JSON.stringify(c.params)}`);
    console.log(`   metrics: trades=${c.metrics.trades} WR=${c.metrics.winRate}% PF=${c.metrics.profitFactor} EV%/t=${c.metrics.expectancyPct}% t=${c.metrics.tstat} DD=${c.metrics.maxDrawdownPct}% ret=${c.metrics.returnPct}%`);
  });
  return { pair, interval, days, top, bestEver };
}

async function multiEvolve(args) {
  // args may be [PAIR PAIR ...] OR [PAIR PAIR ... interval days gens]
  // Detect trailing numeric tokens as interval/days/gens.
  const trailing = [];
  const pairs = [];
  for (const a of args) {
    if (/^\d/.test(a) && args.indexOf(a) >= args.length - 3) trailing.push(a);
    else pairs.push(a);
  }
  const interval = trailing[0] || '1h';
  const days = Number(trailing[1] || 180);
  const gens = Number(trailing[2] || 8);
  const all = [];
  for (const pair of pairs) {
    const r = await evolveCmd([pair, interval, String(days), String(gens)]);
    all.push(...r.top.map(t => ({ pair, ...t })));
  }
  all.sort((a, b) => b.fitness - a.fitness);
  console.log('\n=== CROSS-PAIR LEADERBOARD (top 10) ===');
  all.slice(0, 10).forEach((c, i) => console.log(`#${i + 1} ${c.pair}/${c.kind} FIT=${c.fitness} GO=${c.go} PF=${c.metrics.profitFactor} WR=${c.metrics.winRate}% DD=${c.metrics.maxDrawdownPct}%`));
}

function repl() {
  const readline = require('node:readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log('\n🧬 GENESIS TERMINAL — real-data quant lab (PAPER ONLY)');
  console.log('Commands:');
  console.log('  bt <PAIR> <interval> <days> [kind] [paramsJson]   e.g. bt COTIUSDT 1h 90');
  console.log('  evolve <PAIR> <interval> <days> [gens]            e.g. evolve BTCUSDT 1h 180 8');
  console.log('  multi [PAIR PAIR ...]                             evolve across pairs');
  console.log('  help | exit');
  rl.setPrompt('genesis> ');
  rl.prompt();
  rl.on('line', async (line) => {
    const parts = line.trim().split(/\s+/);
    const cmd = parts[0];
    try {
      if (cmd === 'bt') await backtestCmd(parts.slice(1));
      else if (cmd === 'evolve') await evolveCmd(parts.slice(1));
      else if (cmd === 'multi') await multiEvolve(parts.slice(1));
      else if (cmd === 'help') console.log('see commands above');
      else if (cmd === 'exit') { rl.close(); process.exit(0); }
      else if (cmd) console.log('unknown command. type help.');
    } catch (e) {
      console.log('ERR:', e.message);
    }
    rl.prompt();
  });
}

const arg = process.argv[2];
(async () => {
  if (arg === '--evolve') { await evolveCmd(process.argv.slice(3)); process.exit(0); }
  if (arg === '--multi') { await multiEvolve(process.argv.slice(3)); process.exit(0); }
  if (arg === '--backtest') { await backtestCmd(process.argv.slice(3)); process.exit(0); }
  if (!process.stdin.isTTY) { console.log('No TTY detected. Use --backtest / --evolve / --multi.'); process.exit(1); }
  repl();
})();
