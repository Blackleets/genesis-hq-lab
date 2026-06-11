import { useEffect, useState } from 'react';
import { apiUrl } from '@services/apiBase';

interface MarketSnapshot {
  source: 'polymarket' | 'kalshi';
  marketId: string;
  slug: string;
  title: string;
  outcome: string;
  yesPrice: number | null;
  noPrice: number | null;
  spread: number | null;
  volume24h: number | null;
  liquidity: number | null;
  endDate: string | null;
  status: string;
  category: string;
  updatedAt: string;
  _stale?: boolean;
}

function pct(n: number | null) {
  if (n == null) return '—';
  return `${(n * 100).toFixed(1)}%`;
}

function usd(n: number | null) {
  if (n == null) return '—';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n.toFixed(0)}`;
}

function SourceBadge({ source }: { source: string }) {
  const color = source === 'polymarket' ? '#9333ea' : '#0ea5e9';
  const bg = source === 'polymarket' ? 'rgba(147,51,234,0.12)' : 'rgba(14,165,233,0.12)';
  return (
    <span className="inline-flex px-1.5 py-0.5 rounded text-[9px] font-mono font-bold"
      style={{ color, background: bg, border: `1px solid ${color}33` }}>
      {source.toUpperCase()}
    </span>
  );
}

export function MarketTable() {
  const [markets, setMarkets] = useState<MarketSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<'all' | 'polymarket' | 'kalshi'>('all');

  useEffect(() => {
    setLoading(true);
    const params = source !== 'all' ? `?source=${source}` : '';
    fetch(apiUrl(`/api/prediction-markets/markets${params}`))
      .then((r) => r.json())
      .then((d) => {
        setMarkets(d.markets ?? []);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [source]);

  return (
    <div className="rounded-lg border border-zinc-800 bg-[#0d1117] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-400">Active Markets</h3>
        <div className="flex gap-1">
          {(['all', 'polymarket', 'kalshi'] as const).map((s) => (
            <button key={s} onClick={() => setSource(s)}
              className="px-2 py-1 rounded text-[10px] font-mono transition-colors"
              style={{
                background: source === s ? 'rgba(0,255,156,0.15)' : 'transparent',
                color: source === s ? '#00ff9c' : '#6b7280',
                border: `1px solid ${source === s ? '#00ff9c44' : '#374151'}`,
              }}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {loading && <div className="p-8 text-center text-xs text-zinc-600 animate-pulse">Loading markets…</div>}
      {error && <div className="p-4 text-xs text-red-400 font-mono">{error}</div>}
      {!loading && !error && markets.length === 0 && (
        <div className="p-8 text-center text-xs text-zinc-600">
          No markets cached yet. Trigger a refresh to load real data.
        </div>
      )}

      {markets.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500">
                <th className="text-left px-4 py-2 font-medium">Market</th>
                <th className="text-right px-3 py-2 font-medium">YES</th>
                <th className="text-right px-3 py-2 font-medium">NO</th>
                <th className="text-right px-3 py-2 font-medium">Spread</th>
                <th className="text-right px-3 py-2 font-medium">Vol 24h</th>
                <th className="text-right px-3 py-2 font-medium">Liquidity</th>
                <th className="px-3 py-2 font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {markets.map((m) => (
                <tr key={`${m.source}:${m.marketId}`}
                  className="border-b border-zinc-900 hover:bg-white/[0.02] transition-colors">
                  <td className="px-4 py-2.5 max-w-[280px]">
                    <p className="truncate text-zinc-200 font-medium" title={m.title}>{m.title}</p>
                    <p className="text-zinc-600 text-[9px] font-mono mt-0.5">{m.category}</p>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono"
                    style={{ color: m.yesPrice != null && m.yesPrice > 0.5 ? '#00ff9c' : '#f4f4f5' }}>
                    {pct(m.yesPrice)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-zinc-400">{pct(m.noPrice)}</td>
                  <td className="px-3 py-2.5 text-right font-mono"
                    style={{ color: m.spread != null && m.spread > 0.06 ? '#f59e0b' : '#6b7280' }}>
                    {pct(m.spread)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-zinc-400">{usd(m.volume24h)}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-zinc-400">{usd(m.liquidity)}</td>
                  <td className="px-3 py-2.5"><SourceBadge source={m.source} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
