// LiquidityMatrix.tsx — Genesis Liquidity Matrix depth panel.
// Polls /api/crypto/depth every 4s. Renders asks above mid, bids below.
// Horizontal bars show relative order size. WALL badge for outlier orders.

import { useEffect, useCallback, useReducer, useState } from 'react';
import { loadDepth, type DepthData, type DepthLevel, type DepthSignals } from '@services/cryptoClient';

const POLL_MS = 4_000;
const PAIRS   = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'] as const;

// ── Reducer ───────────────────────────────────────────────────────────────────

type State  = { data: DepthData | null; error: boolean };
type Action = { type: 'set'; data: DepthData } | { type: 'err' };

function reducer(state: State, action: Action): State {
  if (action.type === 'set') return { data: action.data, error: false };
  if (action.type === 'err') return { ...state, error: true };
  return state;
}

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtPrice(n: number): string {
  return n >= 1000
    ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : n.toFixed(4);
}

function fmtSize(n: number): string {
  return n >= 10 ? n.toFixed(2) : n >= 1 ? n.toFixed(3) : n.toFixed(4);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ImbalanceBar({ imbalance }: { imbalance: number }) {
  const pct   = Math.min(1, Math.max(-1, imbalance));
  const isPos = pct >= 0;
  const fill  = Math.abs(pct) * 50;   // max 50% from center
  const color = isPos ? '#22c55e' : '#ef4444';
  return (
    <div style={{ padding: '6px 10px', borderBottom: '1px solid #0d1117', flexShrink: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ color: '#4b5563', fontSize: 8, letterSpacing: 0.8 }}>IMBALANCE</span>
        <span style={{ color, fontSize: 8, fontWeight: 700 }}>
          {pct >= 0 ? '+' : ''}{(pct * 100).toFixed(1)}%
        </span>
      </div>
      <div style={{ height: 4, background: '#1e2a3a', borderRadius: 2, position: 'relative', overflow: 'hidden' }}>
        <div style={{
          position: 'absolute', top: 0, bottom: 0, borderRadius: 2, background: color,
          [isPos ? 'left' : 'right']: '50%', width: `${fill}%`,
        }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
        <span style={{ fontSize: 7, color: '#ef4444' }}>SELL</span>
        <span style={{ fontSize: 7, color: '#22c55e' }}>BUY</span>
      </div>
    </div>
  );
}

function DepthRow({ level, side }: { level: DepthLevel; side: 'bid' | 'ask' }) {
  const barColor   = side === 'bid' ? '#22c55e' : '#ef4444';
  const priceColor = level.isWall
    ? (side === 'bid' ? '#86efac' : '#fca5a5')
    : level.pct > 0.6 ? '#9ca3af' : '#6b7280';
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '62px 1fr 30px',
      alignItems: 'center', padding: '2px 10px', gap: 4,
      position: 'relative', minHeight: 18,
      fontSize: 9, fontFamily: 'monospace',
    }}>
      <div style={{
        position: 'absolute', top: 0, bottom: 0, right: 0,
        width: `${level.pct * 100}%`, background: barColor,
        opacity: level.isWall ? 0.25 : 0.10, pointerEvents: 'none',
      }} />
      <span style={{ color: priceColor, fontWeight: level.isWall ? 700 : 400, zIndex: 1 }}>
        {fmtPrice(level.price)}
      </span>
      <span style={{ color: '#6b7280', textAlign: 'right', paddingRight: 4, zIndex: 1 }}>
        {fmtSize(level.size)}
      </span>
      <span style={{ color: '#f97316', fontSize: 7, fontWeight: 700, zIndex: 1, textAlign: 'right' }}>
        {level.isWall ? 'WALL' : ''}
      </span>
    </div>
  );
}

function Chip({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      fontSize: 7, fontWeight: 700, letterSpacing: 0.5,
      padding: '2px 5px', borderRadius: 3,
      background: `${color}1a`, color,
      fontFamily: 'monospace', textTransform: 'uppercase',
    }}>
      {label}
    </span>
  );
}

function SignalChips({ signals }: { signals: DepthSignals }) {
  const active = [
    signals.buyPressure      && ['BUY PRESSURE',  '#22c55e'],
    signals.sellPressure     && ['SELL PRESSURE', '#ef4444'],
    signals.sellWall         && ['SELL WALL',     '#f97316'],
    signals.bidWall          && ['BID WALL',      '#f97316'],
    signals.thinLiquidity    && ['THIN LIQ',      '#6b7280'],
    signals.absorptionZone   && ['ABSORPTION',    '#3b82f6'],
    signals.momentumBuilding && ['MOMENTUM',      '#a855f7'],
  ].filter(Boolean) as [string, string][];

  if (active.length === 0) return null;
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 3,
      padding: '6px 10px', borderTop: '1px solid #1e2a3a', flexShrink: 0,
    }}>
      {active.map(([label, color]) => <Chip key={label} label={label} color={color} />)}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  pair?:      string;
  className?: string;
  noBorder?:  boolean;
}

export function LiquidityMatrix({ pair: propPair, className = '', noBorder = false }: Props) {
  const [selectedPair, setSelectedPair] = useState<string>(propPair ?? 'BTCUSDT');
  const [state, dispatch]               = useReducer(reducer, { data: null, error: false });

  const poll = useCallback(async () => {
    const data = await loadDepth(selectedPair, 20);
    if (data) dispatch({ type: 'set', data });
    else      dispatch({ type: 'err' });
  }, [selectedPair]);

  useEffect(() => {
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [poll]);

  const d = state.data;

  return (
    <div className={className} style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: '#0a0e1a',
      border:       noBorder ? 'none' : '1px solid #1e2a3a',
      borderRadius: noBorder ? 0 : 8,
      overflow: 'hidden',
    }}>
      {/* Header + pair selector */}
      <div style={{
        padding: '6px 10px', borderBottom: '1px solid #1e2a3a',
        display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
        background: '#060810',
      }}>
        <span style={{ color: '#a855f7', fontSize: 9, fontWeight: 700 }}>◈</span>
        <span style={{ color: '#4b5563', fontSize: 10, fontWeight: 600, letterSpacing: 1, marginRight: 'auto' }}>
          LIQUIDITY MATRIX
        </span>
        {PAIRS.map(p => (
          <button key={p} onClick={() => setSelectedPair(p)} style={{
            fontSize: 7, fontWeight: 700, letterSpacing: 0.5,
            padding: '2px 4px', border: 'none', cursor: 'pointer',
            background: selectedPair === p ? 'rgba(168,85,247,0.15)' : 'transparent',
            color: selectedPair === p ? '#a855f7' : '#374151',
            borderRadius: 3, fontFamily: 'monospace',
          }}>
            {p.replace('USDT', '')}
          </button>
        ))}
      </div>

      {/* Content */}
      {!d ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ color: '#374151', fontSize: 10, fontFamily: 'monospace' }}>
            {state.error ? 'Depth unavailable' : 'Fetching depth…'}
          </span>
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>

          {/* Genesis Reading hero */}
          <div style={{
            padding: '7px 10px', borderBottom: '1px solid #1e2a3a',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: d.readingBg, flexShrink: 0, gap: 6,
            transition: 'background 0.3s',
          }}>
            <span style={{ color: '#4b5563', fontSize: 8, letterSpacing: 0.8, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
              GENESIS READING
            </span>
            <span style={{ color: d.readingColor, fontSize: 10, fontWeight: 800, letterSpacing: 0.5, fontFamily: 'monospace', textAlign: 'right' }}>
              {d.reading}
            </span>
          </div>

          {/* Imbalance */}
          <ImbalanceBar imbalance={d.imbalance} />

          {/* ASKS section — reversed so best ask is closest to mid */}
          <div style={{ padding: '3px 10px', fontSize: 8, color: 'rgba(239,68,68,0.35)', letterSpacing: 0.8, background: '#060810', borderBottom: '1px solid #0d1117', flexShrink: 0 }}>
            ASKS
          </div>
          {[...d.asks].reverse().map((level, i) => (
            <DepthRow key={`ask-${i}`} level={level} side="ask" />
          ))}

          {/* Mid price line */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '5px 10px', flexShrink: 0,
            borderTop: '1px solid #1a3020', borderBottom: '1px solid #1a3020',
            background: '#0a0f0a',
          }}>
            <span style={{ color: '#22c55e', fontSize: 11, fontWeight: 700, fontFamily: 'monospace' }}>
              ${d.midPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </span>
            <span style={{ color: '#374151', fontSize: 8, fontFamily: 'monospace' }}>
              sp {(d.spreadPct * 100).toFixed(3)}%
            </span>
          </div>

          {/* BIDS section — best bid is index 0, closest to mid */}
          <div style={{ padding: '3px 10px', fontSize: 8, color: 'rgba(34,197,94,0.35)', letterSpacing: 0.8, background: '#060810', borderBottom: '1px solid #0d1117', flexShrink: 0 }}>
            BIDS
          </div>
          {d.bids.map((level, i) => (
            <DepthRow key={`bid-${i}`} level={level} side="bid" />
          ))}

          {/* Signal chips */}
          <SignalChips signals={d.signals} />

        </div>
      )}
    </div>
  );
}
