import { useCallback, useEffect, useState } from 'react';
import { fetchCaptureReport, type CaptureReport } from '@services/captureClient';

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
  const precioRealizado = f?.realizedPricePnlUsdt ?? 0;
  const mercado = f?.mtmUsdt ?? 0;
  const fees = f?.feesUsdt ?? 0;
  const netoRealizado = f?.realizedNetPnlUsdt ?? (cobrado + precioRealizado - fees);
  const neto = f?.economicPnlUsdt ?? (netoRealizado + mercado);
  const equity = f?.equityUsdt ?? ((report?.capital ?? 10000) + neto);
  const holds = f?.holds ?? [];
  const paper = report?.paper ?? true;
  const liveOff = report?.liveOff ?? true;
  const go = report?.go ?? false;

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-carbon-300 text-zinc-200">
      <header className="shrink-0 h-11 border-b border-trim bg-[#07090d] flex items-center px-4 md:px-6 gap-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-100 shrink-0">
          Génesis HQ
        </span>
        <span className="w-px h-3.5 bg-trim shrink-0" aria-hidden />
        <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 border border-amber-500/40 text-amber-300">
          {paper ? 'PAPER' : 'NOT-PAPER'}
        </span>
        <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 border border-zinc-700 text-zinc-500">
          {liveOff ? 'LIVE OFF' : 'LIVE'}
        </span>
        <span className={`font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 border ${go ? 'border-emerald-500/40 text-emerald-300' : 'border-red-500/30 text-red-400'}`}>
          {go ? 'GO' : 'GO NO'}
        </span>
        <span className="font-mono text-[9px] text-zinc-500">{report?.venue ?? 'OKX'}</span>
        <span className="ml-auto">
          <button
            type="button"
            onClick={() => void load()}
            disabled={busy}
            className="gx-btn text-[9px] disabled:opacity-40"
          >
            {busy ? '…' : (es ? 'actualizar' : 'refresh')}
          </button>
        </span>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 py-5">
        <div className="mb-5">
          <div className="gx-overline">{es ? 'Qué está pasando' : 'Now'}</div>
          <p className="text-[15px] text-zinc-100 mt-1.5 leading-snug max-w-2xl">
            {es
              ? 'Truth Ledger v2: neto = P&L de precio realizado + funding cobrado - fees + MTM abierto. Paper. Live apagado. No es un GO.'
              : 'Truth Ledger v2: net = realized price P&L + collected funding - fees + open MTM. Paper. Live off.'}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2 mb-4">
          {[
            { label: es ? 'Funding cobrado' : 'Funding collected', value: cobrado, hint: es ? 'solo settles reales' : 'realized settles only' },
            { label: es ? 'Precio realizado' : 'Realized price', value: precioRealizado, hint: es ? `${f?.closedCount ?? 0} cierres` : `${f?.closedCount ?? 0} closes` },
            { label: es ? 'Fees' : 'Fees', value: -Math.abs(fees), hint: es ? 'entrada + salida conocidas' : 'known entry + exit' },
            { label: es ? 'A mercado' : 'Open MTM', value: mercado, hint: es ? 'aún no realizado' : 'not realized' },
          ].map((c) => (
            <div key={c.label} className="gx-tile px-4 py-3">
              <div className="gx-label">{c.label}</div>
              <div className="gx-value text-[22px] mt-1" style={{ color: moneyColor(c.value) }}>
                {fmtUsd(c.value)}
              </div>
              <div className="font-mono text-[9px] text-zinc-600 mt-1">{c.hint}</div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mb-6">
          <span className="gx-label">{es ? 'Neto realizado' : 'Realized net'}</span>
          <span className="gx-value text-[18px]" style={{ color: moneyColor(netoRealizado) }}>{fmtUsd(netoRealizado)}</span>
          <span className="gx-label ml-2">{es ? 'Neto económico' : 'Economic net'}</span>
          <span className="gx-value text-[18px]" style={{ color: moneyColor(neto) }}>{fmtUsd(neto)}</span>
          <span className="font-mono text-[9px] text-zinc-600">
            {es ? `equity ${fmtUsd(equity, false)} · ledger v${f?.ledgerVersion ?? 2} · LIVE OFF` : `equity ${fmtUsd(equity, false)} · ledger v${f?.ledgerVersion ?? 2} · LIVE OFF`}
          </span>
        </div>

        {err && (
          <div className="mb-4 font-mono text-[11px] text-zinc-400">
            {es ? 'Desk en pausa' : 'Stood down'}: {err}
          </div>
        )}

        <div className="gx-overline mb-2">
          {es ? 'Posiciones paper' : 'Paper holds'}
          {holds.length ? ` · ${holds.length}` : ''}
        </div>
        {holds.length === 0 ? (
          <div className="gx-card px-4 py-6 font-mono text-[12px] text-zinc-500 mb-6">
            {es ? 'Aún no hay posición en cinta. No se inventa.' : 'No hold on tape. Nothing invented.'}
          </div>
        ) : (
          <div className="grid gap-2 mb-6 sm:grid-cols-3">
            {holds.map((h) => (
              <article key={h.instId} className="gx-card px-4 py-3">
                <div className="text-[15px] text-zinc-100">
                  {instName(h.instId)}{' '}
                  <span className="text-zinc-500">{sideEs(h.side)}</span>
                </div>
                <div className="font-mono text-[10px] text-zinc-500 mt-2">
                  {es ? 'próximo cobro' : 'next'} {parisWhen(h.nextFundingTime)}
                </div>
                <div className="gx-value text-[13px] mt-2" style={{ color: moneyColor(h.mtmUsdt || 0) }}>
                  {es ? 'a mercado' : 'mark'} {fmtUsd(h.mtmUsdt || 0)}
                </div>
                <div className="font-mono text-[11px] text-zinc-400 mt-0.5">
                  {es ? 'funding cobrado' : 'funding collected'} {fmtUsd(h.realizedFundingUsdt || 0)}
                </div>
              </article>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={() => setDetalle((v) => !v)}
          className="font-mono text-[10px] text-zinc-600 hover:text-zinc-400"
        >
          {detalle
            ? (es ? 'ocultar mesa del spread' : 'hide spread desk')
            : (es ? 'mesa del spread (no cotizamos)' : 'spread desk (quoting 0)')}
        </button>
        {detalle && (
          <div className="mt-2 font-mono text-[11px] text-zinc-500">
            {es
              ? `Scan ${report?.scanned ?? 0} · cotizo ${report?.quoted ?? 0} · fills ${report?.filled ?? 0}. El libro no cubre fees.`
              : `Scan ${report?.scanned ?? 0} · quote ${report?.quoted ?? 0} · fills ${report?.filled ?? 0}.`}
          </div>
        )}
      </div>
    </div>
  );
}
