import { useEffect, useState } from 'react';
import { apiUrl } from '@services/apiBase';

interface RiskData {
  risk?: {
    dailyLoss: number;
    dailyLossCap: number;
    dailyLossRemaining: number;
    maxPositionSize: number;
    capReached: boolean;
  };
  mode?: string;
}

function GaugeBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
      <div className="h-full rounded-full transition-all duration-500"
        style={{ width: `${pct}%`, background: pct > 80 ? '#ef4444' : pct > 50 ? '#f59e0b' : color }} />
    </div>
  );
}

export function RiskPanel() {
  const [data, setData] = useState<RiskData | null>(null);

  useEffect(() => {
    const load = () =>
      fetch(apiUrl('/api/prediction-markets/execution/status'))
        .then((r) => r.json())
        .then(setData)
        .catch(() => {});
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, []);

  const risk = data?.risk;

  return (
    <div className="rounded-lg border border-zinc-800 bg-[#0d1117] p-4 space-y-3">
      <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-400">Risk Guard</h3>

      {!risk ? (
        <div className="animate-pulse h-16 rounded bg-zinc-900" />
      ) : (
        <div className="space-y-3">
          {risk.capReached && (
            <div className="rounded border border-red-900/50 bg-red-950/30 px-3 py-2 text-[10px] font-mono text-red-400">
              ⛔ DAILY_LOSS_CAP_HIT — All new orders blocked
            </div>
          )}

          <div className="space-y-1">
            <div className="flex justify-between text-[10px]">
              <span className="text-zinc-500 font-medium">Daily Loss</span>
              <span className="font-mono text-zinc-300">${risk.dailyLoss.toFixed(2)} / ${risk.dailyLossCap}</span>
            </div>
            <GaugeBar value={risk.dailyLoss} max={risk.dailyLossCap} color="#00ff9c" />
            <p className="text-[9px] text-zinc-600 font-mono">${risk.dailyLossRemaining.toFixed(2)} remaining</p>
          </div>

          <div className="border-t border-zinc-800 pt-2 grid grid-cols-2 gap-3 text-[10px]">
            <div>
              <p className="text-zinc-500 font-medium">Max Position</p>
              <p className="font-mono text-zinc-300 mt-0.5">${risk.maxPositionSize}</p>
            </div>
            <div>
              <p className="text-zinc-500 font-medium">Mode</p>
              <p className="font-mono text-zinc-300 mt-0.5">{data?.mode ?? '—'}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
