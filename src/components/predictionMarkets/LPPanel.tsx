import { useEffect, useState } from 'react';
import { apiUrl } from '@services/apiBase';

interface LPOpportunity {
  marketId: string;
  title: string;
  source: string;
  spread: number | null;
  liquidity: number | null;
  volume24h: number | null;
  estimatedEdge: number | null;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'AVOID';
  recommendation: string;
  reason: string;
  hasRewardProgram?: boolean;
}

const RISK_STYLE: Record<string, { color: string; bg: string }> = {
  LOW:    { color: '#00ff9c', bg: 'rgba(0,255,156,0.10)' },
  MEDIUM: { color: '#f59e0b', bg: 'rgba(245,158,11,0.10)' },
  HIGH:   { color: '#f97316', bg: 'rgba(249,115,22,0.10)' },
  AVOID:  { color: '#ef4444', bg: 'rgba(239,68,68,0.10)' },
};

function RiskBadge({ level }: { level: string }) {
  const s = RISK_STYLE[level] ?? { color: '#6b7280', bg: 'rgba(107,114,128,0.10)' };
  return (
    <span className="inline-flex px-2 py-0.5 rounded text-[9px] font-mono font-bold"
      style={{ color: s.color, background: s.bg, border: `1px solid ${s.color}33` }}>
      {level}
    </span>
  );
}

function pct(n: number | null) {
  if (n == null) return '—';
  return `${(n * 100).toFixed(2)}%`;
}

function usd(n: number | null) {
  if (n == null) return '—';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n.toFixed(0)}`;
}

export function LPPanel() {
  const [data, setData] = useState<{ opportunities: LPOpportunity[]; disclaimer?: string; rewardProgramsMode?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () => {
      setLoading(true);
      fetch(apiUrl('/api/prediction-markets/liquidity/opportunities'))
        .then((r) => r.json())
        .then((d) => { setData(d); setError(null); })
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    };
    load();
    const id = setInterval(load, 90_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="rounded-lg border border-zinc-800 bg-[#0d1117] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-400">LP Opportunities</h3>
          <p className="text-[9px] text-zinc-600 mt-0.5">Recommendations only · No automatic LP positions</p>
        </div>
        {data && (
          <span className="text-[10px] font-mono text-zinc-600">{data.opportunities?.length ?? 0} markets</span>
        )}
      </div>

      {data?.disclaimer && (
        <div className="mx-4 mt-3 text-[9px] text-amber-500/80 bg-amber-950/20 rounded px-3 py-2 border border-amber-900/30 font-mono">
          ⚠ {data.disclaimer}
        </div>
      )}

      {loading && <div className="p-6 text-center text-xs text-zinc-600 animate-pulse">Scanning LP opportunities…</div>}
      {error && <div className="p-4 text-xs text-red-400 font-mono">{error}</div>}
      {!loading && !error && (data?.opportunities?.length ?? 0) === 0 && (
        <div className="p-6 text-center text-xs text-zinc-600">No markets available — load markets first.</div>
      )}

      <div className="divide-y divide-zinc-900 mt-2">
        {(data?.opportunities ?? []).map((op) => (
          <div key={`${op.source}:${op.marketId}`} className="px-4 py-3 hover:bg-white/[0.02] transition-colors">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <RiskBadge level={op.riskLevel} />
                  {op.hasRewardProgram && (
                    <span className="text-[9px] font-mono text-yellow-400 bg-yellow-950/30 px-1.5 py-0.5 rounded border border-yellow-900/30">
                      + REWARD
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-zinc-200 font-medium truncate" title={op.title}>{op.title}</p>
                <p className="text-[9px] text-zinc-600 mt-1 leading-relaxed">{op.reason}</p>
              </div>
              <div className="shrink-0 text-right space-y-1">
                <div className="text-[10px] font-mono" style={{ color: '#00ff9c' }}>
                  Edge {pct(op.estimatedEdge)}
                </div>
                <div className="text-[9px] font-mono text-zinc-500">Spread {pct(op.spread)}</div>
                <div className="text-[9px] font-mono text-zinc-600">{usd(op.liquidity)} liq</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
