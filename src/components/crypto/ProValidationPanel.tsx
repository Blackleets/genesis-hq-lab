import { useCallback, useEffect, useState } from 'react';
import { loadProValidation, type ProValidation, type ProValidationTf } from '@services/cryptoClient';

const POLL_MS = 20_000;
const PAIRS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'] as const;

const BIAS_COLOR: Record<string, string> = {
  LONG_BIAS: '#22c55e',
  SHORT_BIAS: '#ef4444',
  MIXED: '#f59e0b',
};

const ACTION_LABEL: Record<string, string> = {
  validate_longs_only: 'LONGS ONLY',
  validate_shorts_only: 'SHORTS ONLY',
  stand_aside: 'STAND ASIDE',
};

const VERDICT_COLOR: Record<string, string> = {
  confirm_long: '#22c55e',
  confirm_short: '#ef4444',
  mixed: '#f59e0b',
  insufficient: '#6b7280',
};

const TREND_COLOR: Record<string, string> = {
  bullish: '#22c55e',
  bearish: '#ef4444',
  neutral: '#f59e0b',
  unknown: '#6b7280',
};

function fmtMetric(n: number | null, digits = 2): string {
  return Number.isFinite(n) ? (n as number).toFixed(digits) : 'N/A';
}

function formatAgo(iso: string | null): string {
  if (!iso) return 'N/A';
  const delta = Math.max(0, Date.now() - new Date(iso).getTime());
  const secs = Math.round(delta / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  return `${hours}h ago`;
}

function LabelValue({ label, value, color = '#9ca3af' }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ color: '#4b5563', fontSize: 8, fontWeight: 600, letterSpacing: 0.7 }}>
        {label}
      </span>
      <span style={{ color, fontSize: 10, fontWeight: 700, fontFamily: 'monospace' }}>
        {value}
      </span>
    </div>
  );
}

function StatRow({ label, value, color = '#9ca3af' }: { label: string; value: string; color?: string }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 8,
      padding: '6px 12px',
      borderBottom: '1px solid #111827',
    }}>
      <span style={{ color: '#4b5563', fontSize: 10, fontWeight: 600, letterSpacing: 0.5 }}>
        {label}
      </span>
      <span style={{ color, fontSize: 10, fontWeight: 700, textAlign: 'right' }}>
        {value}
      </span>
    </div>
  );
}

function Chip({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      padding: '2px 5px',
      borderRadius: 999,
      border: `1px solid ${color}22`,
      background: `${color}12`,
      color,
      fontSize: 8,
      fontWeight: 700,
      letterSpacing: 0.4,
      textTransform: 'uppercase',
      fontFamily: 'monospace',
    }}>
      {label}
    </span>
  );
}

function TimeframeCard({ tf }: { tf: ProValidationTf }) {
  const verdictColor = VERDICT_COLOR[tf.verdict] ?? '#9ca3af';
  const trendColor = TREND_COLOR[tf.trend] ?? '#9ca3af';
  const priceDigits = tf.price !== null && tf.price >= 1000 ? 2 : 4;
  const ema9Digits = tf.ema9 !== null && tf.ema9 >= 1000 ? 2 : 4;
  const ema21Digits = tf.ema21 !== null && tf.ema21 >= 1000 ? 2 : 4;

  return (
    <div style={{
      border: '1px solid #1e2a3a',
      borderRadius: 8,
      background: '#0c1220',
      padding: '10px 12px',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: '#d1d5db', fontSize: 12, fontWeight: 800, letterSpacing: 0.8 }}>
            {tf.label}
          </span>
          <Chip label={tf.verdict.replace('_', ' ')} color={verdictColor} />
        </div>
        <span style={{ color: trendColor, fontSize: 9, fontWeight: 700, letterSpacing: 0.7, textTransform: 'uppercase' }}>
          {tf.trend}
        </span>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        gap: 10,
      }}>
        <LabelValue label="PRICE" value={fmtMetric(tf.price, priceDigits)} color="#d1d5db" />
        <LabelValue label="SCORE" value={String(tf.score)} color={tf.score > 0 ? '#22c55e' : tf.score < 0 ? '#ef4444' : '#9ca3af'} />
        <LabelValue label="RSI 14" value={fmtMetric(tf.rsi14)} color="#60a5fa" />
        <LabelValue label="DELTA" value={tf.changePct !== null ? `${tf.changePct > 0 ? '+' : ''}${fmtMetric(tf.changePct)}%` : 'N/A'} color={tf.changePct !== null && tf.changePct >= 0 ? '#22c55e' : '#ef4444'} />
        <LabelValue label="EMA 9" value={fmtMetric(tf.ema9, ema9Digits)} />
        <LabelValue label="EMA 21" value={fmtMetric(tf.ema21, ema21Digits)} />
        <LabelValue label="MACD HIST" value={fmtMetric(tf.macdHistogram, 4)} color={(tf.macdHistogram ?? 0) >= 0 ? '#22c55e' : '#ef4444'} />
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {tf.notes.map((note) => (
          <Chip key={`${tf.label}-${note}`} label={note} color="#94a3b8" />
        ))}
      </div>
    </div>
  );
}

export function ProValidationPanel() {
  const [pair, setPair] = useState<string>('BTCUSDT');
  const [data, setData] = useState<ProValidation | null>(null);
  const [error, setError] = useState(false);

  const poll = useCallback(async () => {
    const next = await loadProValidation(pair);
    if (next) {
      setData(next);
      setError(false);
      return;
    }
    setError(true);
  }, [pair]);

  useEffect(() => {
    setData(null);
    setError(false);
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [poll]);

  const bias = data?.bias ?? 'MIXED';
  const action = data?.action ?? 'stand_aside';

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: '#0a0e1a',
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '8px 12px',
        borderBottom: '1px solid #1e2a3a',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        flexShrink: 0,
        background: '#060810',
      }}>
        <span style={{ color: '#3da9fc', fontSize: 10, fontWeight: 700 }}>PRO VALIDATION</span>
        <span style={{ color: '#374151', fontSize: 9, marginRight: 'auto' }}>Binance-derived</span>
        {PAIRS.map((option) => (
          <button
            key={option}
            onClick={() => setPair(option)}
            style={{
              fontSize: 7,
              fontWeight: 700,
              letterSpacing: 0.5,
              padding: '2px 4px',
              border: 'none',
              cursor: 'pointer',
              background: pair === option ? 'rgba(61,169,252,0.16)' : 'transparent',
              color: pair === option ? '#3da9fc' : '#374151',
              borderRadius: 3,
              fontFamily: 'monospace',
            }}
          >
            {option.replace('USDT', '')}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {!data ? (
          <div style={{ color: '#374151', fontSize: 10, padding: '20px 12px', textAlign: 'center' }}>
            {error ? 'Validation unavailable' : 'Fetching validation...'}
          </div>
        ) : (
          <>
            <div style={{
              margin: '10px 12px',
              borderRadius: 8,
              border: `1px solid ${BIAS_COLOR[bias] ?? '#6b7280'}22`,
              background: `${BIAS_COLOR[bias] ?? '#6b7280'}12`,
              padding: '12px',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}>
              <span style={{ color: '#4b5563', fontSize: 9, fontWeight: 600, letterSpacing: 1 }}>
                HTF BIAS
              </span>
              <span style={{ color: BIAS_COLOR[bias] ?? '#9ca3af', fontSize: 22, fontWeight: 800, letterSpacing: 1.6, lineHeight: 1 }}>
                {bias.replace('_', ' ')}
              </span>
              <span style={{ color: '#94a3b8', fontSize: 10 }}>
                {data.note}
              </span>
            </div>

            <StatRow label="PAIR" value={data.pair} color="#d1d5db" />
            <StatRow label="ACTION" value={ACTION_LABEL[action] ?? action} color={BIAS_COLOR[bias] ?? '#9ca3af'} />
            <StatRow label="TOTAL SCORE" value={String(data.score)} color={data.score > 0 ? '#22c55e' : data.score < 0 ? '#ef4444' : '#9ca3af'} />
            <StatRow label="UPDATED" value={formatAgo(data.fetchedAt)} color="#60a5fa" />

            <div style={{ padding: '10px 12px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {data.timeframes.map((tf) => <TimeframeCard key={tf.label} tf={tf} />)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
