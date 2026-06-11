import { useState } from 'react';
import { apiUrl } from '@services/apiBase';

interface PaperOrderResult {
  ok: boolean;
  mode?: string;
  orderId?: string;
  status?: string;
  fillPrice?: number;
  fees?: number;
  disclaimer?: string;
  error?: string;
  reason?: string;
  detail?: string;
}

export function ExecutionPanel() {
  const [marketId, setMarketId] = useState('');
  const [outcome, setOutcome] = useState<'YES' | 'NO'>('YES');
  const [amount, setAmount] = useState('5');
  const [result, setResult] = useState<PaperOrderResult | null>(null);
  const [loading, setLoading] = useState(false);

  const submitPaperOrder = async () => {
    if (!marketId || !amount) return;
    setLoading(true);
    try {
      const res = await fetch(apiUrl('/api/prediction-markets/execution/paper-order'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marketId, outcome, amount: Number(amount), source: 'polymarket' }),
      });
      setResult(await res.json());
    } catch (e) {
      setResult({ ok: false, error: (e as Error).message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-lg border border-zinc-800 bg-[#0d1117] overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-400">Execution</h3>
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[9px] font-mono font-bold"
            style={{ color: '#60a5fa', background: 'rgba(96,165,250,0.10)', border: '1px solid rgba(96,165,250,0.25)' }}>
            PAPER_MODE
          </span>
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[9px] font-mono font-bold"
            style={{ color: '#ef4444', background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.25)' }}>
            LIVE_LOCKED
          </span>
        </div>
        <p className="text-[9px] text-zinc-600 mt-0.5">No real money is moved in paper mode</p>
      </div>

      <div className="p-4 space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2">
            <label className="block text-[9px] text-zinc-500 font-medium mb-1 uppercase tracking-wider">Market ID</label>
            <input
              value={marketId}
              onChange={(e) => setMarketId(e.target.value)}
              placeholder="0x1234… or fixture-001"
              className="w-full bg-[#111827] border border-zinc-700 rounded px-3 py-1.5 text-[11px] text-zinc-200 font-mono focus:outline-none focus:border-zinc-500"
            />
          </div>
          <div>
            <label className="block text-[9px] text-zinc-500 font-medium mb-1 uppercase tracking-wider">Amount ($)</label>
            <input
              type="number"
              min="1"
              max="10"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full bg-[#111827] border border-zinc-700 rounded px-3 py-1.5 text-[11px] text-zinc-200 font-mono focus:outline-none focus:border-zinc-500"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {(['YES', 'NO'] as const).map((o) => (
              <button key={o} onClick={() => setOutcome(o)}
                className="px-4 py-1.5 rounded text-[11px] font-mono font-bold transition-all"
                style={{
                  background: outcome === o ? (o === 'YES' ? 'rgba(0,255,156,0.15)' : 'rgba(239,68,68,0.15)') : 'transparent',
                  color: outcome === o ? (o === 'YES' ? '#00ff9c' : '#ef4444') : '#6b7280',
                  border: `1px solid ${outcome === o ? (o === 'YES' ? 'rgba(0,255,156,0.3)' : 'rgba(239,68,68,0.3)') : '#374151'}`,
                }}>
                {o}
              </button>
            ))}
          </div>
          <button
            onClick={submitPaperOrder}
            disabled={loading || !marketId}
            className="ml-auto px-4 py-1.5 rounded text-[11px] font-semibold transition-all disabled:opacity-40"
            style={{ background: 'rgba(96,165,250,0.15)', color: '#60a5fa', border: '1px solid rgba(96,165,250,0.3)' }}
          >
            {loading ? 'Submitting…' : 'Paper Trade'}
          </button>

          {/* Live order button — disabled, always */}
          <button disabled
            className="px-4 py-1.5 rounded text-[11px] font-semibold opacity-30 cursor-not-allowed"
            style={{ background: 'rgba(239,68,68,0.10)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}
            title="Live trading is locked. Set ENABLE_LIVE_PREDICTION_TRADING=true to unlock.">
            Live Trade 🔒
          </button>
        </div>

        {result && (
          <div className={`rounded border p-3 text-[10px] font-mono space-y-1 ${
            result.ok ? 'border-emerald-900/40 bg-emerald-950/20' : 'border-red-900/40 bg-red-950/20'
          }`}>
            {result.ok ? (
              <>
                <p style={{ color: '#00ff9c' }}>✓ Paper order created: {result.orderId}</p>
                <p className="text-zinc-400">Fill: {result.fillPrice != null ? `${(result.fillPrice * 100).toFixed(1)}%` : '—'} · Fees: ${result.fees?.toFixed(4) ?? '—'}</p>
                {result.disclaimer && <p className="text-zinc-600 text-[9px]">{result.disclaimer}</p>}
              </>
            ) : (
              <>
                <p style={{ color: '#ef4444' }}>✗ {result.reason ?? result.error}</p>
                {result.detail && <p className="text-zinc-500">{result.detail}</p>}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
