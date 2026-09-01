import { useCallback, useEffect, useState } from 'react';
import { fetchCaptureReport, type CaptureReport } from '@services/captureClient';

const BG = '#07090d';
const BORDER = '#1c2430';

const NAME: Record<string, string> = {
  XAU: 'Oro',
  CL: 'Petróleo',
  XAG: 'Plata',
  BTC: 'Bitcoin',
  ETH: 'Ether',
};

function fmtUsd(n: number, sign = true) {
  const s = sign && n >= 0 ? '+' : '';
  return `${s}${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function moneyColor(n: number) {
  if (n > 0) return '#4ade80';
  if (n < 0) return '#f87171';
  return '#a1a1aa';
}

function instName(instId: string) {
  const code = String(instId || '').replace('-USDT-SWAP', '');
  return NAME[code] || code;
}

function sideEs(side: string) {
  return side === 'short' ? 'corto' : side === 'long' ? 'largo' : side;
}

function parisWhen(ms?: number) {
  if (!ms || !Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleString('es-ES', {
    timeZone: 'Europe/Paris',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function CaptureDeskPanel({ es = true }: { es?: boolean }) {
  const [report, setReport] = useState<CaptureReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [detalle, setDetalle] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetchCaptureReport(40);
      setReport(r);
      if (!r.ok && r.error) setErr(r.error);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'sin cinta');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(t);
  }, [load]);

  const f = report?.funding;
  const cobrado = f?.realizedFundingUsdt ?? 0;
  const mercado = f?.mtmUsdt ?? 0;
  const fees = f?.feesUsdt ?? 0;
  const neto = cobrado + mercado - fees;
  const holds = f?.holds ?? [];

  return (
    <div style={{ background: BG, borderTop: `1px solid ${BORDER}` }} className="px-4 py-3">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
            {es ? 'Qué está pasando' : 'Now'}
          </div>
          <div className="text-[15px] text-zinc-100 mt-1 leading-snug max-w-xl">
            {es
              ? 'Enfoque: el exchange nos paga por aguantar (funding). Paper. Live apagado. El spread no se cotiza.'
              : 'Approach: collect funding. Paper. Live off. Spread desk quotes 0.'}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={busy}
          className="font-mono text-[10px] uppercase tracking-wider px-2 py-1 border border-zinc-700 text-zinc-300 hover:bg-white/5 disabled:opacity-40"
        >
          {busy ? (es ? '…' : '…') : (es ? 'actualizar' : 'refresh')}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        {[
          { label: es ? 'Cobrado' : 'Collected', value: cobrado, hint: es ? 'solo settles reales' : 'realized only' },
          { label: es ? 'A mercado' : 'Mark', value: mercado, hint: es ? 'aún no es cobro' : 'unrealized' },
          { label: es ? 'Fees' : 'Fees', value: -Math.abs(fees), hint: es ? 'ya pagados' : 'paid' },
        ].map((c) => (
          <div key={c.label} style={{ border: `1px solid ${BORDER}` }} className="px-3 py-2">
            <div className="font-mono text-[9px] uppercase tracking-wider text-zinc-500">{c.label}</div>
            <div className="font-mono text-[20px] tabular-nums mt-0.5" style={{ color: moneyColor(c.value) }}>
              {fmtUsd(c.value)}
            </div>
            <div className="font-mono text-[9px] text-zinc-600">{c.hint}</div>
          </div>
        ))}
      </div>

      <div className="flex items-baseline gap-2 mb-3">
        <span className="font-mono text-[9px] uppercase tracking-wider text-zinc-500">{es ? 'Neto paper' : 'Paper net'}</span>
        <span className="font-mono text-[18px] tabular-nums" style={{ color: moneyColor(neto) }}>{fmtUsd(neto)}</span>
        <span className="font-mono text-[9px] text-zinc-600">{es ? 'PAPER · live apagado · no es un GO' : 'PAPER · live off'}</span>
      </div>

      {err && (
        <div className="mb-2 font-mono text-[11px] text-zinc-400">{es ? 'Desk en pausa' : 'Stood down'}: {err}</div>
      )}

      <div className="font-mono text-[9px] uppercase tracking-wider text-zinc-500 mb-1">
        {es ? 'Posiciones paper' : 'Paper holds'}
      </div>
      {holds.length === 0 ? (
        <div className="font-mono text-[12px] text-zinc-500 mb-3">
          {es ? 'Aún no hay posición en cinta. No se inventa.' : 'No hold on tape. Nothing invented.'}
        </div>
      ) : (
        <div className="grid gap-2 mb-3 sm:grid-cols-3">
          {holds.map((h) => (
            <div key={h.instId} style={{ border: `1px solid ${BORDER}` }} className="px-3 py-2">
              <div className="text-[14px] text-zinc-100">
                {instName(h.instId)} <span className="text-zinc-500">{sideEs(h.side)}</span>
              </div>
              <div className="font-mono text-[10px] text-zinc-500 mt-1">
                {es ? 'próximo cobro' : 'next'} {parisWhen(h.nextFundingTime)}
              </div>
              <div className="font-mono text-[12px] tabular-nums mt-1" style={{ color: moneyColor(h.mtmUsdt || 0) }}>
                {es ? 'a mercado' : 'mark'} {fmtUsd(h.mtmUsdt || 0)}
              </div>
              <div className="font-mono text-[11px] text-zinc-400">
                {es ? 'cobrado' : 'collected'} {fmtUsd(h.realizedFundingUsdt || 0)}
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => setDetalle((v) => !v)}
        className="font-mono text-[10px] text-zinc-600 underline-offset-2 hover:text-zinc-400"
      >
        {detalle
          ? (es ? 'ocultar mesa del spread' : 'hide spread desk')
          : (es ? 'mesa del spread (no cotizamos)' : 'spread desk (quoting 0)')}
      </button>

      {detalle && (
        <div className="mt-2 font-mono text-[11px] text-zinc-500">
          {es
            ? `Scan ${report?.scanned ?? 0} · cotizo ${report?.quoted ?? 0} · fills ${report?.filled ?? 0}. El libro no cubre fees. Por eso el enfoque es funding, no spread.`
            : `Scan ${report?.scanned ?? 0} · quote ${report?.quoted ?? 0} · fills ${report?.filled ?? 0}.`}
        </div>
      )}
    </div>
  );
}
