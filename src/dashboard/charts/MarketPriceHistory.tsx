import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

interface PricePoint {
  at: string;
  yes: number;
}

interface Props {
  prices: PricePoint[];
  question: string;
}

export default function MarketPriceHistory({ prices, question }: Props) {
  if (prices.length < 2) return null;

  const data = prices.map((p, i) => ({
    label: i === 0 ? 'start' : i === prices.length - 1 ? 'now' : '',
    yes: Math.round(p.yes * 1000) / 1000,
  }));

  return (
    <div className="mt-2">
      <div className="font-mono text-[9px] text-zinc-600 mb-1 truncate">{question}</div>
      <ResponsiveContainer width="100%" height={60}>
        <LineChart data={data} margin={{ top: 2, right: 4, bottom: 0, left: 0 }}>
          <XAxis dataKey="label" hide />
          <YAxis domain={[0, 1]} hide />
          <Tooltip
            contentStyle={{
              background: '#18181b',
              border: '1px solid #27272a',
              borderRadius: 0,
              fontSize: 9,
              fontFamily: 'monospace',
              color: '#e4e4e7',
            }}
            formatter={(v) => [`${((v as number) * 100).toFixed(1)}%`, 'YES']}
          />
          <ReferenceLine y={0.5} stroke="#27272a" strokeDasharray="2 2" />
          <Line
            type="monotone"
            dataKey="yes"
            stroke="#3da9fc"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
