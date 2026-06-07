// TradeNotifier.tsx — premium, anti-spam trade notifications.
// Lifecycle (open/exit) drives off tradeStories (structured: conf, TP/SL%, PnL, duration).
// SAFE_MODE + rejections drive off commentary. No own polling — props from CryptoLabView.

import { useEffect, useRef, useState } from 'react';
import type { CommentaryItem, TradeStory } from '@services/cryptoClient';

interface Toast {
  id: string;
  title: string;
  lines: string[];
  color: string;
  at: number;
}

const DURATION = 5500;
const MAX = 3;
const REJECT_THROTTLE_MS = 30_000;

function pct(n: number): string { return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`; }

function durationLabel(open: string, close: string | null): string {
  try {
    const ms = (close ? Date.parse(close) : Date.now()) - Date.parse(open);
    const m = Math.floor(ms / 60_000);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d`;
  } catch { return '—'; }
}

const EXIT_TITLE: Record<string, string> = {
  TP: 'TP HIT', SL: 'SL HIT', TIMEOUT: 'TIMEOUT EXIT', CONFIDENCE: 'EARLY EXIT', EXIT: 'CLOSED',
};
const EXIT_COLOR: Record<string, string> = {
  TP: '#22c55e', SL: '#ef4444', TIMEOUT: '#f59e0b', CONFIDENCE: '#f97316', EXIT: '#9ca3af',
};

function openToast(t: TradeStory): Toast {
  const sym = t.pair.replace('USDT', '');
  const tpPct = ((t.target_price! - t.entry_price) / t.entry_price) * 100 * (t.side === 'LONG' ? 1 : -1);
  const slPct = ((t.stop_price! - t.entry_price) / t.entry_price) * 100 * (t.side === 'LONG' ? 1 : -1);
  return {
    id: `open-${t.id}`,
    title: `${sym} ${t.side} OPENED`,
    lines: [
      `Confidence: ${Math.round((t.confidence ?? 0) * 100)}`,
      ...(t.target_price ? [`TP: ${pct(tpPct)}`] : []),
      ...(t.stop_price ? [`SL: ${pct(slPct)}`] : []),
    ],
    color: t.side === 'LONG' ? '#22c55e' : '#a855f7',
    at: Date.now(),
  };
}

function exitToast(t: TradeStory): Toast {
  const sym = t.pair.replace('USDT', '');
  const kind = t.exit_kind ?? 'EXIT';
  const pnlPct = t.exit_price != null
    ? ((t.exit_price - t.entry_price) / t.entry_price) * 100 * (t.side === 'LONG' ? 1 : -1)
    : 0;
  return {
    id: `exit-${t.id}`,
    title: `${sym} ${EXIT_TITLE[kind] ?? 'CLOSED'}`,
    lines: [
      `PnL: ${pct(pnlPct)}`,
      `Duration: ${durationLabel(t.opened_at, t.closed_at)}`,
    ],
    color: EXIT_COLOR[kind] ?? '#9ca3af',
    at: Date.now(),
  };
}

interface Props {
  commentary: CommentaryItem[];
  trades: TradeStory[];
}

export function TradeNotifier({ commentary, trades }: Props) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seenOpen = useRef<Set<string>>(new Set());
  const seenClose = useRef<Set<string>>(new Set());
  const seenComment = useRef<Set<string>>(new Set());
  const initialized = useRef(false);
  const lastRejectAt = useRef(0);

  function push(next: Toast[]) {
    if (next.length === 0) return;
    setToasts(prev => [...prev, ...next].slice(-MAX));
  }

  // Lifecycle from tradeStories. On first render, mark existing as seen (no backfill spam).
  useEffect(() => {
    const fresh: Toast[] = [];
    for (const t of trades) {
      if (!seenOpen.current.has(t.id)) {
        seenOpen.current.add(t.id);
        if (initialized.current) fresh.push(openToast(t));
      }
      if (t.status === 'closed' && t.closed_at && !seenClose.current.has(t.id)) {
        seenClose.current.add(t.id);
        if (initialized.current) fresh.push(exitToast(t));
      }
    }
    if (!initialized.current) { initialized.current = true; return; }
    push(fresh);
  }, [trades]);

  // SAFE_MODE (critical) + throttled rejections from commentary.
  useEffect(() => {
    const fresh: Toast[] = [];
    for (const c of commentary.slice(0, 10)) {
      if (seenComment.current.has(c.id)) continue;
      seenComment.current.add(c.id);
      if (!initialized.current) continue;
      if (c.type === 'SAFE_MODE') {
        fresh.push({ id: `c-${c.id}`, title: 'SAFE MODE', lines: [c.text], color: '#ef4444', at: Date.now() });
      } else if (c.type === 'TRADE_REJECTED') {
        const now = Date.now();
        if (now - lastRejectAt.current < REJECT_THROTTLE_MS) continue;
        lastRejectAt.current = now;
        fresh.push({ id: `c-${c.id}`, title: 'SIGNAL REJECTED', lines: [c.text], color: '#f59e0b', at: now });
      }
    }
    push(fresh);
  }, [commentary]);

  // Auto-dismiss oldest
  useEffect(() => {
    if (toasts.length === 0) return;
    const oldest = toasts[0];
    const id = window.setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== oldest.id));
    }, Math.max(300, DURATION - (Date.now() - oldest.at)));
    return () => window.clearTimeout(id);
  }, [toasts]);

  if (toasts.length === 0) return null;

  return (
    <div style={{ position: 'fixed', bottom: 16, right: 16, zIndex: 60, display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none' }}>
      {toasts.map(t => (
        <div
          key={t.id}
          style={{
            pointerEvents: 'auto', width: 230,
            background: '#11151f', border: '1px solid #1e2a3a', borderLeft: `3px solid ${t.color}`,
            borderRadius: 6, padding: '9px 11px', fontFamily: 'monospace',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)', animation: 'gx-toast-in 0.3s ease-out',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: t.color, flexShrink: 0 }} />
            <span style={{ color: t.color, fontSize: 11, fontWeight: 800, letterSpacing: 0.5 }}>{t.title}</span>
            <button
              type="button"
              onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}
              style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: '#4b5563', cursor: 'pointer', fontSize: 11, padding: 0 }}
            >✕</button>
          </div>
          {t.lines.map((l, i) => (
            <div key={i} style={{ color: '#9ca3af', fontSize: 10, lineHeight: '15px', marginTop: i === 0 ? 4 : 0, paddingLeft: 12 }}>{l}</div>
          ))}
        </div>
      ))}
    </div>
  );
}
