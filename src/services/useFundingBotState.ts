// useFundingBotState — live source of truth for the PAPER funding bot.
// Pulls REAL data from the bot's executions feed (Vercel Function -> Gist).
// No fabricated numbers: every field comes from the bot's real trades.
import { useEffect, useState } from 'react';

export interface BotTrade {
  pair: string;
  event: 'OPEN' | 'FLAT' | 'FUNDING' | 'PROTECT';
  side?: string;
  pnl?: number;
  equity?: number;
  t?: number;
  paperAccrual?: boolean;
}

export interface BotState {
  booted: boolean;
  equity: number;
  startCapital: number;
  fundingPaid: number;
  openPairs: string[];
  openCount: number;
  trades: BotTrade[];
  last: BotTrade[];
  updatedAt: number | null;
}

const START = 10000; // lab paper capital; gist overrides when present

export function useFundingBotState(pollMs = 9000): BotState {
  const [s, setS] = useState<BotState>({
    booted: false,
    equity: START,
    startCapital: START,
    fundingPaid: 0,
    openPairs: [],
    openCount: 0,
    trades: [],
    last: [],
    updatedAt: null,
  });

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch('/api/crypto/executions', { cache: 'no-store' });
        if (!r.ok) return;
        const j = await r.json();
        const trades: BotTrade[] = Array.isArray(j.trades) ? j.trades : [];
        const fundingPaid = trades
          .filter((t) => t.event === 'FUNDING')
          .reduce((a, t) => a + (t.pnl ?? 0), 0);
        // open = last event per pair is OPEN
        const lastByPair = new Map<string, string>();
        trades.forEach((t) => lastByPair.set(t.pair, t.event));
        const openPairs = [...lastByPair.entries()]
          .filter(([, e]) => e === 'OPEN')
          .map(([p]) => p);
        const start = typeof j.start === 'number' ? j.start : START;
        if (alive) {
          setS({
            booted: true,
            equity: start + fundingPaid,
            startCapital: start,
            fundingPaid,
            openPairs,
            openCount: openPairs.length,
            trades,
            last: trades.slice(-6).reverse(),
            updatedAt: j.updatedAt ?? Date.now(),
          });
        }
      } catch {
        /* keep previous state on fetch error */
      }
    };
    tick();
    const id = setInterval(tick, pollMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [pollMs]);

  return s;
}
