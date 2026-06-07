// CommentaryFeed.tsx — Genesis AI Commentary feed.
// Narrates Genesis's reasoning in a quant-desk voice. Polls /api/crypto/commentary
// every 5s. Timestamped, auto-scroll, expandable detail. Never shows fake data.

import { useEffect, useRef, useCallback, useReducer, useState } from 'react';
import { loadCommentary, type CommentaryItem } from '@services/cryptoClient';

const POLL_MS    = 5_000;
const MAX_ITEMS  = 120;

type Action =
  | { type: 'merge'; items: CommentaryItem[] }
  | { type: 'clear' };

function reducer(state: CommentaryItem[], action: Action): CommentaryItem[] {
  if (action.type === 'clear') return [];
  if (action.type === 'merge') {
    const existing = new Set(state.map(e => e.id));
    const fresh = action.items.filter(e => !existing.has(e.id));
    if (fresh.length === 0) return state;
    return [...fresh, ...state].slice(0, MAX_ITEMS);
  }
  return state;
}

// ── Type → color + icon ───────────────────────────────────────────────────────

const TYPE_COLOR: Record<string, string> = {
  SCANNING:        '#6b7280',
  ANALYZING:       '#60a5fa',
  SIGNAL_FOUND:    '#a855f7',
  TRADE_REJECTED:  '#f59e0b',
  TRADE_OPENED:    '#3b82f6',
  TP_HIT:          '#22c55e',
  SL_HIT:          '#ef4444',
  EARLY_EXIT:      '#f59e0b',
  SAFE_MODE:       '#f97316',
  LEARNING_UPDATE: '#a855f7',
  DESK_SUMMARY:    '#c084fc',
};

const TYPE_ICON: Record<string, string> = {
  SCANNING:        '◌',
  ANALYZING:       '◉',
  SIGNAL_FOUND:    '✦',
  TRADE_REJECTED:  '⊘',
  TRADE_OPENED:    '▲',
  TP_HIT:          '✓',
  SL_HIT:          '✗',
  EARLY_EXIT:      '⤷',
  SAFE_MODE:       '⚠',
  LEARNING_UPDATE: '↻',
  DESK_SUMMARY:    '◈',
};

function color(t: string): string { return TYPE_COLOR[t] ?? '#9ca3af'; }
function icon(t: string): string  { return TYPE_ICON[t] ?? '·'; }

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

export function CommentaryFeed({ className = '' }: Props) {
  const [items, dispatch] = useReducer(reducer, []);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const scrollRef  = useRef<HTMLDivElement>(null);
  const isAtTop    = useRef(true);

  const poll = useCallback(async () => {
    const fetched = await loadCommentary(40);
    if (fetched.length > 0) dispatch({ type: 'merge', items: fetched });
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [poll]);

  // Auto-scroll to newest (top) only when the user is already at the top.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !isAtTop.current) return;
    el.scrollTop = 0;
  }, [items]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    isAtTop.current = el.scrollTop < 40;
  }

  function toggle(id: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div className={className} style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: '#0a0e1a', border: '1px solid #1e2a3a',
      borderRadius: 8, overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '8px 12px', borderBottom: '1px solid #1e2a3a',
        display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, background: '#060810',
      }}>
        <span style={{ color: '#22c55e', fontSize: 10, fontWeight: 700, letterSpacing: 1 }}>● LIVE</span>
        <span style={{ color: '#4b5563', fontSize: 10, fontWeight: 600, letterSpacing: 1 }}>GENESIS COMMENTARY</span>
        <span style={{ marginLeft: 'auto', color: '#374151', fontSize: 9 }}>{items.length}</span>
      </div>

      {/* Feed */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        style={{ flex: 1, overflowY: 'auto', padding: '4px 0', fontFamily: 'monospace' }}
      >
        {items.length === 0 ? (
          <div style={{ color: '#374151', fontSize: 10, padding: '20px 12px', textAlign: 'center' }}>
            Waiting for genesis reasoning…
          </div>
        ) : (
          items.map(item => {
            const c = color(item.type);
            const isDesk = item.type === 'DESK_SUMMARY';
            const hasDetail = item.detail && item.detail.length > 0;
            const isOpen = expanded.has(item.id);
            return (
              <div
                key={item.id}
                onClick={() => hasDetail && toggle(item.id)}
                style={{
                  padding: '3px 12px',
                  borderLeft: isDesk ? `2px solid ${c}` : '2px solid transparent',
                  background: isDesk ? 'rgba(192,132,252,0.05)' : 'transparent',
                  cursor: hasDetail ? 'pointer' : 'default',
                }}
              >
                <div style={{
                  display: 'grid', gridTemplateColumns: '56px 14px 1fr',
                  gap: '0 6px', fontSize: 10, lineHeight: '16px', alignItems: 'start',
                }}>
                  <span style={{ color: '#374151' }}>{formatTs(item.ts)}</span>
                  <span style={{ color: c, fontWeight: 700 }}>{icon(item.type)}</span>
                  <span style={{ color: c, wordBreak: 'break-word' }}>
                    {item.text}
                    {hasDetail && (
                      <span style={{ color: '#374151', marginLeft: 4 }}>{isOpen ? '▾' : '▸'}</span>
                    )}
                  </span>
                </div>
                {hasDetail && isOpen && (
                  <div style={{
                    gridColumn: '3', marginLeft: 76, marginTop: 2, marginBottom: 2,
                    fontSize: 9, color: '#6b7280', lineHeight: '14px',
                    borderLeft: '1px solid #1e2a3a', paddingLeft: 6,
                  }}>
                    {item.detail}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
