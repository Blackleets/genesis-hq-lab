// LiveExecutionsView.tsx — shows the live-trader audit trail in (near) real time.
// Polls /api/crypto/executions every 5s. No secrets involved; the API only
// returns trade events already stripped of any key material.
import { useEffect, useState } from 'react';

type Trade = {
  t: number;
  pair: string;
  event: 'OPEN' | 'TP' | 'SL' | 'FUNDING' | 'PROTECT' | 'FLAT';
  side?: string;
  price?: number;
  pnl?: number;
  equity?: number;
  rate?: number;
  reason?: string;
  live?: boolean;
  order?: string | number;
};

type Executions = {
  mode?: string;
  pairs?: number;
  interval?: string;
  start?: number;
  total?: number;
  updatedAt?: number;
  trades: Trade[];
  source?: string;
};

function timeAgo(ms: number) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

export default function LiveExecutionsView() {
  const [data, setData] = useState<Executions>({ trades: [] });
  const [lastSync, setLastSync] = useState<number>(0);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        // Dev: vite serves public/executions.json statically (no local API server
        // needed). Prod (Vercel): the /api function serves it. Try both.
        let j = null;
        try { const r = await fetch('/executions.json'); j = await r.json(); } catch {}
        if (!j || !j.ok) {
          const r2 = await fetch('/api/crypto/executions'); j = await r2.json();
        }
        if (active && j && j.ok) { setData(j); setLastSync(Date.now()); }
      } catch { /* keep last good data */ }
    };
    load();
    const id = setInterval(load, 5000);
    return () => { active = false; clearInterval(id); };
  }, []);

  const trades = [...(data.trades || [])].sort((a, b) => b.t - a.t).slice(0, 50);
  const live = data.mode === 'live-testnet' || data.mode === 'live';
  const funding = data.mode === 'funding-paper';
  const modeLabel = funding ? '🟡 FUNDING PAPER' : live ? '🟢 TESTNET' : '⚪ PAPER';

  return (
    <div style={{ padding: 16, color: '#e6e6e6', fontFamily: 'monospace' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Live Executions {modeLabel}</h2>
        <span style={{ fontSize: 12, opacity: 0.7 }}>
          {data.pairs || '—'} pairs · {data.interval || (funding ? '8h funding' : '—')} · {data.total !== undefined ? `eq $${data.total}` : ''} · sync {lastSync ? timeAgo(lastSync) + ' ago' : '—'}
        </span>
      </div>

      {data.source === 'sample' && (
        <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 8 }}>
          (sample data — start the live-trader bot to see real executions)
        </div>
      )}

      {lastSync === 0 && trades.length === 0 && (
        <div style={{
          fontSize: 13, marginBottom: 10, padding: '10px 12px',
          border: '1px solid #ffa64d55', background: '#ffa64d14', color: '#ffce9e', borderRadius: 6,
        }}>
          Backend offline — no execution feed available. Start it with <code>npm run start</code>.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '120px 70px 90px 90px 90px 80px', gap: 4, fontSize: 13, opacity: 0.9 }}>
        <div style={{ opacity: 0.5 }}>time</div>
        <div style={{ opacity: 0.5 }}>pair</div>
        <div style={{ opacity: 0.5 }}>event</div>
        <div style={{ opacity: 0.5 }}>side</div>
        <div style={{ opacity: 0.5 }}>price</div>
        <div style={{ opacity: 0.5 }}>pnl</div>

        {trades.map((t, i) => (
          <FragmentRow key={`${t.t}-${t.pair}-${i}`} t={t} />
        ))}
      </div>
    </div>
  );
}

function FragmentRow({ t }: { t: Trade }) {
  const color =
    t.event === 'TP' || t.event === 'FUNDING' ? '#3ad17f' :
    t.event === 'SL' ? '#ff5d5d' :
    t.event === 'PROTECT' ? '#ffa64d' :
    t.event === 'FLAT' ? '#888' : '#6aa0ff';
  const txt = (v: unknown) => (v === undefined ? '—' : String(v));
  return (
    <>
      <div style={{ opacity: 0.7 }}>{timeAgo(t.t)}</div>
      <div>{t.pair}</div>
      <div style={{ color }}>{t.event}</div>
      <div>{txt(t.side)}</div>
      <div>{t.price !== undefined ? t.price : (t.rate !== undefined ? 'fr ' + t.rate : '—')}</div>
      <div style={{ color: t.pnl && t.pnl >= 0 ? '#3ad17f' : '#ff5d5d' }}>
        {t.pnl !== undefined ? (t.pnl >= 0 ? '+' : '') + t.pnl : '—'}
      </div>
    </>
  );
}
