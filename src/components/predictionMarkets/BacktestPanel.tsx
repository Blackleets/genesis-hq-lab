import { useState } from 'react';
import { apiUrl } from '@services/apiBase';

interface BacktestResult {
  ok: boolean;
  dataMode: string;
  disclaimer?: string;
  strategy?: string;
  summary?: {
    totalTrades?: number;
    winRate?: number;
    EV?: number;
    maxDrawdown?: number;
    profitFactor?: number;
    fees?: number;
    slippageEstimate?: number;
    totalPnL?: number;
    error?: string;
  };
  totalTradesSimulated?: number;
  totalMarketsBacktested?: number;
  error?: string;
  message?: string;
}

const STRATEGIES = ['simple_yes_low', 'fade_consensus', 'momentum', 'spread_hunter'];

function DataModeBadge({ mode }: { mode: string }) {
  const color = mode === 'FIXTURE_DATA' ? '#a78bfa' : mode === 'REAL_DATA' ? '#00ff9c' : '#f59e0b';
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-[9px] font-mono font-bold"
      style={{ color, background: `${color}18`, border: `1px solid ${color}33` }}>
      {mode}
    </span>
  );
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-[#111827] rounded border border-zinc-800 p-3">
      <p className="text-[9px] text-zinc-500 uppercase tracking-wider font-medium">{label}</p>
      <p className="text-base font-bold font-mono text-zinc-100 mt-1">{value}</p>
      {sub && <p className="text-[9px] text-zinc-600 font-mono mt-0.5">{sub}</p>}
    </div>
  );
}

export function BacktestPanel() {
  const [strategy, setStrategy] = useState('simple_yes_low');
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [loading, setLoading] = useState(false);

  const runBacktest = async () => {
    setLoading(true);
    try {
      const res = await fetch(apiUrl('/api/prediction-markets/backtest'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategy, source: 'fixture' }),
      });
      setResult(await res.json());
    } catch (e) {
      setResult({ ok: false, dataMode: 'INSUFFICIENT_DATA', error: (e as Error).message });
    } finally {
      setLoading(false);
    }
  };

  const pct = (n?: number | null) => n != null ? `${(n * 100).toFixed(1)}%` : '—';
  const usd = (n?: number | null) => n != null ? `$${n.toFixed(2)}` : '—';

  return (
    <div className="rounded-lg border border-zinc-800 bg-[#0d1117] overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800">
        <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-400">Backtesting Lab</h3>
        <p className="text-[9px] text-zinc-600 mt-0.5">Fixture data only · Results are not real performance</p>
      </div>

      <div className="p-4 space-y-4">
        {/* Controls */}
        <div className="flex items-center gap-3">
          <select
            value={strategy}
            onChange={(e) => setStrategy(e.target.value)}
            className="flex-1 bg-[#111827] border border-zinc-700 rounded px-3 py-1.5 text-[11px] text-zinc-200 font-mono focus:outline-none focus:border-zinc-500"
          >
            {STRATEGIES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <button
            onClick={runBacktest}
            disabled={loading}
            className="px-4 py-1.5 rounded text-[11px] font-semibold transition-all disabled:opacity-50"
            style={{ background: 'rgba(0,255,156,0.15)', color: '#00ff9c', border: '1px solid rgba(0,255,156,0.3)' }}
          >
            {loading ? 'Running…' : 'Run Backtest'}
          </button>
        </div>

        {/* Results */}
        {result && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <DataModeBadge mode={result.dataMode ?? 'FIXTURE_DATA'} />
              {!result.ok && (
                <span className="text-[10px] text-red-400 font-mono">{result.error ?? result.message}</span>
              )}
            </div>

            {result.disclaimer && (
              <p className="text-[9px] text-amber-500/80 bg-amber-950/20 rounded px-3 py-2 border border-amber-900/30 font-mono leading-relaxed">
                ⚠ {result.disclaimer}
              </p>
            )}

            {result.ok && result.summary && !result.summary.error && (
              <div className="grid grid-cols-4 gap-2">
                <MetricCard label="Win Rate" value={pct(result.summary.winRate)} />
                <MetricCard label="EV / Trade" value={usd(result.summary.EV)} />
                <MetricCard label="Max Drawdown" value={pct(result.summary.maxDrawdown)} />
                <MetricCard label="Profit Factor" value={result.summary.profitFactor?.toFixed(2) ?? '—'} />
                <MetricCard label="Total Trades" value={String(result.totalTradesSimulated ?? 0)} sub={`${result.totalMarketsBacktested} markets`} />
                <MetricCard label="Total PnL" value={usd(result.summary.totalPnL)} />
                <MetricCard label="Fees Paid" value={usd(result.summary.fees)} />
                <MetricCard label="Slippage Est." value={usd(result.summary.slippageEstimate)} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
