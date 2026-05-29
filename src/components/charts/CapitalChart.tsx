import { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { useCapitalHistory } from '../../state/genesisStore';

const INITIAL_CAPITAL = 10_000;

function formatRelative(at: string): string {
  const ms = Date.now() - Date.parse(at);
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

export default function CapitalChart() {
  const history = useCapitalHistory();

  const data = useMemo(
    () =>
      history.map((h) => ({
        label: formatRelative(h.at),
        value: Math.round(h.value * 100) / 100,
      })),
    [history]
  );

  if (data.length < 2) {
    return (
      <div className="px-4 py-6 font-mono text-[11px] text-zinc-600">
        Waiting for data…
      </div>
    );
  }

  const currentValue = data[data.length - 1]?.value ?? INITIAL_CAPITAL;
  const isProfit = currentValue >= INITIAL_CAPITAL;
  const lineColor = isProfit ? '#00ff9c' : '#ff4757';

  return (
    <div className="px-4 pt-2 pb-3">
      <ResponsiveContainer width="100%" height={100}>
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="capitalGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={lineColor} stopOpacity={0.15} />
              <stop offset="95%" stopColor={lineColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="label"
            tick={{ fill: '#4a5568', fontSize: 9, fontFamily: 'monospace' }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis hide domain={['auto', 'auto']} />
          <Tooltip
            contentStyle={{
              background: '#18181b',
              border: '1px solid #27272a',
              borderRadius: 0,
              fontSize: 10,
              fontFamily: 'monospace',
              color: '#e4e4e7',
            }}
            formatter={(v) => [`$${(v as number).toFixed(2)}`, 'Capital']}
            labelStyle={{ color: '#71717a' }}
          />
          <ReferenceLine y={INITIAL_CAPITAL} stroke="#27272a" strokeDasharray="3 3" />
          <Area
            type="monotone"
            dataKey="value"
            stroke={lineColor}
            strokeWidth={1.5}
            fill="url(#capitalGrad)"
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
