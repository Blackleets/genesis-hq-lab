import { useEffect, useState } from 'react';
import { apiUrl } from '@services/apiBase';

interface Opportunity {
  marketId: string;
  title: string;
  source: string;
  yesPrice: number | null;
  noPrice: number | null;
  spread: number | null;
  volume24h: number | null;
  liquidity: number | null;
  _ev: number;
  _spreadScore: number;
  _opportunityScore: number;
  category: string;
}

function pct(n: number | null) {
  if (n == null) return '—';
  return `${(n * 100).toFixed(1)}%`;
}

export function OpportunityPanel() {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () => {
      setLoading(true);
      fetch(apiUrl('/api/prediction-markets/opportunities'))
        .then((r) => r.json())
        .then((d) => {
          setOpportunities(d.opportunities ?? []);
          setError(null);
        })
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    };
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="rounded-lg border border-zinc-800 bg-[#0d1117] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-400">Opportunities</h3>
          <p className="text-[9px] text-zinc-600 mt-0.5">Analytical only — not trading signals</p>
        </div>
        <span className="text-[10px] font-mono text-zinc-600">{opportunities.length} found</span>
      </div>

      {loading && <div className="p-6 text-center text-xs text-zinc-600 animate-pulse">Scanning…</div>}
      {error && <div className="p-4 text-xs text-red-400 font-mono">{error}</div>}
      {!loading && !error && opportunities.length === 0 && (
        <div className="p-6 text-center text-xs text-zinc-600">No opportunities scored yet — load markets first.</div>
      )}

      <div className="divide-y divide-zinc-900">
        {opportunities.map((op) => (
          <div key={`${op.source}:${op.marketId}`} className="px-4 py-3 hover:bg-white/[0.02] transition-colors">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-zinc-200 font-medium truncate" title={op.title}>{op.title}</p>
                <p className="text-[9px] text-zinc-600 mt-0.5 font-mono">{op.source} · {op.category}</p>
              </div>
              <div className="shrink-0 text-right space-y-0.5">
                <div className="text-[10px] font-mono" style={{ color: '#00ff9c' }}>
                  Score {op._opportunityScore.toFixed(1)}
                </div>
                <div className="text-[9px] font-mono text-zinc-500">
                  Spread {pct(op.spread)}
                </div>
              </div>
            </div>
            <div className="flex gap-4 mt-2 text-[9px] font-mono text-zinc-600">
              <span>YES {pct(op.yesPrice)}</span>
              <span>NO {pct(op.noPrice)}</span>
              <span>EV {op._ev.toFixed(3)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
