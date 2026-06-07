// LiveActivityStrip.tsx — single-line live activity ticker at the top of Crypto Lab.
// Priority-aware: a HIGH/CRITICAL event holds the strip for HOLD_MS and a lower-priority
// event cannot replace it during that window. Subtle fade on change. No own polling —
// consumes the commentary items already fetched by CryptoLabView.

import { useEffect, useRef, useState } from 'react';
import type { CommentaryItem } from '@services/cryptoClient';
import { priorityOf, HOLD_MS, PRIORITY_COLOR, type Priority } from './eventPriority';

const TYPE_ICON: Record<string, string> = {
  SCANNING: '◌', ANALYZING: '◉', SIGNAL_FOUND: '✦', TRADE_REJECTED: '⊘',
  TRADE_OPENED: '▲', TP_HIT: '✓', SL_HIT: '✗', EARLY_EXIT: '⤷',
  SAFE_MODE: '⚠', LEARNING_UPDATE: '↻', DESK_SUMMARY: '◈',
};

interface Props {
  items: CommentaryItem[];
}

export function LiveActivityStrip({ items }: Props) {
  const [current, setCurrent] = useState<CommentaryItem | null>(null);
  const [flash, setFlash] = useState(0);
  const lockedUntil = useRef(0);

  useEffect(() => {
    const newest = items[0];
    if (!newest) return;
    if (current && newest.id === current.id) return;

    const now = Date.now();
    const newPri: Priority = priorityOf(newest);
    const curPri: Priority = current ? priorityOf(current) : 'LOW';

    // Hold the important event: don't let a lower/equal-priority event replace it yet.
    if (current && now < lockedUntil.current) {
      const rank = { CRITICAL: 3, HIGH: 2, MEDIUM: 1, LOW: 0 };
      if (rank[newPri] <= rank[curPri]) return;
    }

    setCurrent(newest);
    setFlash(f => f + 1);
    lockedUntil.current = now + HOLD_MS[newPri];
  }, [items, current]);

  const pri: Priority = current ? priorityOf(current) : 'LOW';
  const color = PRIORITY_COLOR[pri];
  const icon = current ? (TYPE_ICON[current.type] ?? '·') : '◌';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '4px 12px', minHeight: 22, overflow: 'hidden',
      fontFamily: 'monospace',
    }}>
      <span style={{
        width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0,
        boxShadow: `0 0 6px ${color}`,
        animation: pri === 'HIGH' || pri === 'CRITICAL' ? 'gx-pulse 1s ease-in-out infinite' : 'none',
      }} />
      <span style={{ color, fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{icon}</span>
      <span
        key={flash}
        style={{
          color: pri === 'LOW' ? '#9ca3af' : color,
          fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          animation: 'gx-fadein 0.4s ease-out',
        }}
      >
        {current ? current.text : 'Genesis online — monitoring market…'}
      </span>
      {current?.source === 'llm' && (
        <span style={{ marginLeft: 'auto', color: '#c084fc', fontSize: 9, flexShrink: 0 }}>◈ AI</span>
      )}
    </div>
  );
}
