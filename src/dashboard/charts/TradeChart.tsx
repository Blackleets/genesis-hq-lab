import { useEffect, useState, useRef } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, CartesianGrid,
} from 'recharts';
import { agentClient, type TradeChartData } from '@services/agentClient';

interface Props {
  tradeId: string;
  compact?: boolean;
}

export default function TradeChart({ tradeId, compact = false }: Props) {
  const [data, setData] = useState<TradeChartData | null>(null);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const result = await agentClient.getTradeChart(tradeId);
      if (!cancelled) {
        setData(result);
        setLoading(false);
        // Poll every 30s if trade is still open
        if (result?.trade?.status === 'open') {
          timerRef.current = setTimeout(load, 30_000);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [tradeId]);

  if (loading) {
    return <div className="h-24 flex items-center justify-center text-xs text-zinc-600 font-mono">Loading chart…</div>;
  }

  if (!data?.ok || !data.snapshots?.length) {
    return (
      <div className="h-20 flex items-center justify-center text-xs text-zinc-600 font-mono border border-zinc-800 rounded">
        No price data yet — snapshots recorded every 2 min
      </div>
    );
  }

  const { trade, snapshots } = data;
  const isYes = trade.outcome === 'YES';
  const priceKey = isYes ? 'yes_price' : 'no_price';
  const entryPrice = trade.entry_price ?? 0;
  const tp = trade.take_profit_price ?? entryPrice * 1.28;
  const sl = trade.stop_loss_price ?? entryPrice * 0.80;

  const chartData = snapshots.map((s) => ({
    time: new Date(s.recorded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    price: Math.round(s[priceKey as keyof typeof s] as number * 1000) / 1000,
  }));

  const height = compact ? 80 : 140;

  return (
    <div className="w-full">
      {/* TP/SL legend */}
      <div className="flex gap-3 text-[10px] font-mono mb-1">
        <span className="text-emerald-400">TP {(tp * 100).toFixed(1)}%</span>
        <span className="text-rose-400">SL {(sl * 100).toFixed(1)}%</span>
        <span className="text-zinc-500">Entry {(entryPrice * 100).toFixed(1)}%</span>
        {trade.pnl !== undefined && (
          <span className={trade.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
            PnL ${trade.pnl >= 0 ? '+' : ''}{trade.pnl.toFixed(2)}
          </span>
        )}
      </div>

      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="2 4" stroke="#27272a" />
          <XAxis dataKey="time" hide={compact} tick={{ fontSize: 8, fill: '#71717a', fontFamily: 'monospace' }} />
          <YAxis domain={[0, 1]} hide={compact} tick={{ fontSize: 8, fill: '#71717a', fontFamily: 'monospace' }} tickFormatter={v => `${(v * 100).toFixed(0)}%`} />
          <Tooltip
            contentStyle={{ background: '#18181b', border: '1px solid #27272a', borderRadius: 4, fontSize: 9, fontFamily: 'monospace', color: '#e4e4e7' }}
            formatter={(v) => [`${((v as number) * 100).toFixed(1)}%`, isYes ? 'YES price' : 'NO price']}
          />
          {/* Entry line */}
          <ReferenceLine y={entryPrice} stroke="#3da9fc" strokeDasharray="3 3" label={compact ? undefined : { value: 'ENTRY', fill: '#3da9fc', fontSize: 8, fontFamily: 'monospace' }} />
          {/* TP line */}
          <ReferenceLine y={tp} stroke="#00ff9c" strokeDasharray="3 3" label={compact ? undefined : { value: 'TP', fill: '#00ff9c', fontSize: 8, fontFamily: 'monospace' }} />
          {/* SL line */}
          <ReferenceLine y={sl} stroke="#ff4757" strokeDasharray="3 3" label={compact ? undefined : { value: 'SL', fill: '#ff4757', fontSize: 8, fontFamily: 'monospace' }} />
          <Line type="monotone" dataKey="price" stroke="#3da9fc" strokeWidth={1.5} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
