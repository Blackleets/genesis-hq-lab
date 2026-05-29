import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts';
import { useAgents } from '../../state/genesisStore';

export default function AgentPerformanceChart() {
  const agents = useAgents();

  const data = useMemo(
    () =>
      agents
        .filter((a) => (a.tradeCount ?? 0) > 0)
        .map((a) => ({
          name: a.name.split(' ')[0],
          pnl: Math.round((a.totalPnL ?? 0) * 100) / 100,
          winRate: Math.round((a.winRate ?? 0) * 100),
          trades: a.tradeCount ?? 0,
        }))
        .sort((a, b) => b.pnl - a.pnl),
    [agents]
  );

  if (data.length === 0) {
    return (
      <div className="px-4 py-4 font-mono text-[11px] text-zinc-600">
        No trades yet
      </div>
    );
  }

  return (
    <div className="px-2 pt-2 pb-1">
      <ResponsiveContainer width="100%" height={Math.max(60, data.length * 28)}>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 0 }}>
          <XAxis
            type="number"
            tick={{ fill: '#4a5568', fontSize: 9, fontFamily: 'monospace' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `$${v}`}
          />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fill: '#9ca3af', fontSize: 9, fontFamily: 'monospace' }}
            axisLine={false}
            tickLine={false}
            width={52}
          />
          <Tooltip
            contentStyle={{
              background: '#18181b',
              border: '1px solid #27272a',
              borderRadius: 0,
              fontSize: 10,
              fontFamily: 'monospace',
              color: '#e4e4e7',
            }}
            formatter={(v, _name, props) => [
              `$${(v as number).toFixed(2)} · ${(props.payload as { winRate: number }).winRate}% win · ${(props.payload as { trades: number }).trades} trades`,
              'P&L',
            ]}
          />
          <ReferenceLine x={0} stroke="#27272a" />
          <Bar dataKey="pnl" radius={0} isAnimationActive={false}>
            {data.map((entry) => (
              <Cell
                key={entry.name}
                fill={entry.pnl >= 0 ? '#00ff9c' : '#ff4757'}
                fillOpacity={0.8}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
