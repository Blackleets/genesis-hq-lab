// ExecutionFeed.tsx — Real-time genesis execution event feed.
// Polls /api/crypto/feed every 5s, buffers max 100 events, auto-scrolls.
// Color-coded by event type. Never shows fake data.

import { useEffect, useRef, useCallback, useReducer } from 'react';
import { loadCryptoFeed, type FeedEvent } from '@services/cryptoClient';

const POLL_MS = 5_000;
const MAX_EVENTS = 100;

type Action =
  | { type: 'merge'; events: FeedEvent[] }
  | { type: 'clear' };

function reducer(state: FeedEvent[], action: Action): FeedEvent[] {
  if (action.type === 'clear') return [];
  if (action.type === 'merge') {
    const existing = new Set(state.map(e => String(e.id)));
    const fresh = action.events.filter(e => !existing.has(String(e.id)));
    if (fresh.length === 0) return state;
    const merged = [...fresh, ...state].slice(0, MAX_EVENTS);
    return merged;
  }
  return state;
}

function eventColor(event: FeedEvent): string {
  const r = event.reason?.toUpperCase() ?? '';
  if (r.includes('TP HIT') || r.includes('WIN'))        return '#22c55e';  // green
  if (r.includes('SL HIT') || r.includes('LOSS'))       return '#ef4444';  // red
  if (r.includes('EARLY EXIT') || r.includes('TIMEOUT')) return '#f59e0b'; // amber
  if (r.includes('LONG OPENED') || r.includes('OPENED')) return '#3b82f6'; // blue
  if (r.includes('SHORT OPENED'))                        return '#a855f7'; // purple
  if (r.includes('BLOCKED') || r.includes('RISK CLOSE')) return '#ef4444';
  if (r.includes('SAFE MODE'))                           return '#f97316'; // orange
  if (event.severity === 'HIGH' || event.severity === 'ERROR') return '#ef4444';
  if (event.severity === 'WARNING')                      return '#f59e0b';
  if (event.category === 'SCAN')                         return '#6b7280'; // muted gray
  if (event.category === 'EXECUTION')                    return '#60a5fa'; // light blue
  return '#9ca3af'; // default gray
}

function labelIcon(event: FeedEvent): string {
  const r = event.reason?.toUpperCase() ?? '';
  if (r.includes('TP HIT'))     return '✓';
  if (r.includes('SL HIT'))     return '✗';
  if (r.includes('LONG OPENED') || r.includes('OPENED')) return '▲';
  if (r.includes('SHORT OPENED'))                         return '▼';
  if (r.includes('SCANNING') || r.includes('ANALYZING')) return '◉';
  if (r.includes('BLOCKED') || r.includes('SAFE MODE'))  return '⊘';
  if (r.includes('EARLY EXIT') || r.includes('TIMEOUT')) return '⤷';
  if (r.includes('REBALANCE'))  return '↻';
  return '·';
}

function formatTs(ts: string): string {
  try {
    const d = new Date(ts);
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    return `${h}:${m}:${s}`;
  } catch { return '--:--:--'; }
}

interface Props {
  className?: string;
}

export function ExecutionFeed({ className = '' }: Props) {
  const [events, dispatch] = useReducer(reducer, []);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottom = useRef(true);

  const poll = useCallback(async () => {
    const fetched = await loadCryptoFeed(60);
    if (fetched.length > 0) dispatch({ type: 'merge', events: fetched });
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [poll]);

  // Auto-scroll only if user is at the bottom
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !isAtBottom.current) return;
    el.scrollTop = 0; // events are newest-first
  }, [events]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    isAtBottom.current = el.scrollTop < 40;
  }

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: '#0a0e1a',
        border: '1px solid #1e2a3a',
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div style={{
        padding: '8px 12px',
        borderBottom: '1px solid #1e2a3a',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexShrink: 0,
      }}>
        <span style={{ color: '#22c55e', fontSize: 10, fontWeight: 700, letterSpacing: 1 }}>
          ● LIVE
        </span>
        <span style={{ color: '#4b5563', fontSize: 11, fontWeight: 600, letterSpacing: 1 }}>
          GENESIS EXECUTION FEED
        </span>
        <span style={{ marginLeft: 'auto', color: '#374151', fontSize: 10 }}>
          {events.length}/{MAX_EVENTS}
        </span>
      </div>

      {/* Feed */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '4px 0',
          fontFamily: 'monospace',
        }}
      >
        {events.length === 0 ? (
          <div style={{ color: '#374151', fontSize: 11, padding: '20px 12px', textAlign: 'center' }}>
            Waiting for genesis activity…
          </div>
        ) : (
          events.map(event => (
            <div
              key={String(event.id)}
              style={{
                display: 'grid',
                gridTemplateColumns: '56px 16px 1fr',
                gap: '0 6px',
                padding: '2px 12px',
                fontSize: 11,
                lineHeight: '18px',
                alignItems: 'start',
              }}
            >
              <span style={{ color: '#374151' }}>{formatTs(event.ts)}</span>
              <span style={{ color: eventColor(event), fontWeight: 700 }}>
                {labelIcon(event)}
              </span>
              <span style={{ color: eventColor(event), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {event.reason}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
