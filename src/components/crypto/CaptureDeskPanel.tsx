import { useCallback, useEffect, useState } from 'react';
import { fetchCaptureReport, type CaptureReport, type CaptureRow } from '@services/captureClient';

const BG = '#07090d';
const BORDER = '#1c2430';

const WHY_ES: Record<string, string> = {
  VPIN_HALT: 'Flujo informado. No cotizo.',
  H_LE_EDGE: 'Spread no cubre fees + toxicidad',
  WOULD_CROSS: 'Cruzaría el libro. No soy taker.',
  SHORT_TAPE: 'Cinta corta',
  TAPE_PENDING: 'Este tick no cargó libro. No invento fair.',
  DEAD_BOOK: 'Libro muerto',
  MARKOUT_HALT: 'Me pickearon. Paro.',
  DENY_NEG_PNL: 'Ya perdió paper. Cooldown.',
  NO_THROUGH_FILL: 'Cotiza, nadie cruzó',
  CAPTURED: 'Fills paper (no es GO)',
  HARVEST: 'Candidato paper',
  KELLY_FLAT: 'Media ≤ 0. Tamaño 0.',
  LIVE_BLOCK: 'Live off',
};

function fmtBps(n: number | null | undefined) {
  return Number.isFinite(n as number) ? (n as number).toFixed(2) : '—';
}

function fmtUsd(n: number) {
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPx(n: number | undefined) {
  if (!Number.isFinite(n as number)) return null;
  const v = n as number;
  if (Math.abs(v) > 0 && Math.abs(v) < 1e-4) return v.toExponential(3);
  return v.toFixed(4);
}

function reasonColor(row: CaptureRow): string {
  if (row.fillCount > 0) return '#22c55e';
  if (row.quote) return '#f59e0b';
  if (row.reason === 'VPIN_HALT') return '#ef4444';
  return '#71717a';
}

function whyLabel(code: string, es: boolean) {
  if (!es) return code;
  return WHY_ES[code] || code;
}

export function CaptureDeskPanel({ es = true }: { es?: boolean }) {
  const [report, setReport] = useState<CaptureReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  const load = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetchCaptureReport(40);
      setReport(r);
      if (!r.ok && r.error) setErr(r.error);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'capture unreachable');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const start = report?.ledger?.start ?? report?.capital ?? 10000;
  const equity = report?.ledger?.paperBalanceUSDT ?? start;
  const pnl = equity - start;
  const paper = report?.paper ?? true;
  const liveOff = report?.liveOff ?? true;
  const go = report?.go ?? false;

  return (
    <div style={{ background: BG, borderTop: `1px solid ${BORDER}` }} className="px-3 py-2.5">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-zinc-500">
              {es ? 'Mesa de captura' : 'Capture desk'}
            </span>
            <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 border border-amber-500/40 text-amber-300">
              {paper ? 'PAPER' : 'NOT-PAPER'}
            </span>
            <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 border border-zinc-700 text-zinc-500">
              {liveOff ? 'LIVE_OFF' : 'LIVE'}
            </span>
            <span className={`font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 border ${go ? 'border-emerald-500/40 text-emerald-300' : 'border-red-500/30 text-red-400'}`}>
              {go ? 'GO' : 'GO NO'}
            </span>
            <span className="font-mono text-[9px] text-zinc-600">{report?.venue ?? 'okx'}</span>
            <span className="font-mono text-[9px] text-zinc-600">New Bot · harvest paper · no live</span>
          </div>
          {es ? (
            <div className="font-mono text-[10px] text-zinc-500 mt-1 leading-tight space-y-0.5">
              <div>Tóxico → no cotizo. Me pickean → paro. Precio justo = Kalman, no el último tick.</div>
              <div>ETH/BTC a 0.0x bps cruzaría. Sleeve maker: nocional ≥ $1M y spread ≥ 5 bps.</div>
              <div>PAPER · LIVE_OFF · esto no abre live ni es un GO de 6 gates.</div>
            </div>
          ) : (
            <div className="font-mono text-[10px] text-zinc-500 mt-0.5">
              LIVE_OFF · not a 6-gate GO · {report?.venue ?? 'okx'}
            </div>
          )}
          <div className="font-mono text-[16px] font-semibold text-zinc-100 mt-1 tabular-nums">
            ${equity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            <span className={`ml-2 text-[11px] ${pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {fmtUsd(pnl)}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={busy}
          className="font-mono text-[10px] uppercase tracking-wider px-2 py-1 border border-zinc-700 text-zinc-300 hover:bg-white/5 disabled:opacity-40"
        >
          {busy ? (es ? 'escaneando…' : 'scanning…') : (es ? 'rescan' : 'rescan')}
        </button>
      </div>

      <div className="flex flex-wrap gap-3 font-mono text-[10px] mb-2">
        <span className="text-zinc-500">scan <span className="text-zinc-200">{report?.scanned ?? 0}</span></span>
        <span className="text-zinc-500">quote <span className="text-amber-300">{report?.quoted ?? 0}</span></span>
        <span className="text-zinc-500">fills <span className="text-emerald-300">{report?.filled ?? 0}</span></span>
      </div>

      {err && (
        <div className="mb-2 border border-zinc-700 px-3 py-2 font-mono text-[11px] text-zinc-400">
          {es ? 'Desk en stand-down' : 'Desk stood down'}: {err}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full font-mono text-[10px] tabular-nums">
          <thead>
            <tr className="text-zinc-600 uppercase tracking-wider text-[8px]">
              <th className="text-left py-1 pr-2">sym</th>
              <th className="text-right py-1 px-1">H</th>
              <th className="text-right py-1 px-1">spr</th>
              <th className="text-right py-1 px-1">VPIN</th>
              <th className="text-right py-1 px-1">fair K</th>
              <th className="text-left py-1 px-1">why</th>
              <th className="text-right py-1 px-1">fills</th>
              <th className="text-right py-1 pl-1">pnl</th>
            </tr>
          </thead>
          <tbody>
            {(report?.rows ?? []).map((row) => {
              const code = row.captureReason || row.reason;
              const label = whyLabel(code, es);
              const fair = fmtPx(row.fair);
              const mid = fmtPx(row.mid);
              const k = Number.isFinite(row.kellyF as number) ? (row.kellyF as number).toFixed(3) : null;
              return (
                <tr key={row.symbol} style={{ borderTop: `1px solid ${BORDER}` }}>
                  <td className="py-1.5 pr-2 text-zinc-200">{row.symbol.replace('-USDT-SWAP', '')}{row.sleeve === 'maker' ? <span className="text-zinc-600"> m</span> : row.sleeve === 'watch' ? <span className="text-zinc-700"> w</span> : null}</td>
                  <td className="text-right px-1 text-zinc-300">{fmtBps(row.harvestBps)}</td>
                  <td className="text-right px-1 text-zinc-400">{fmtBps(row.spreadBps)}</td>
                  <td className="text-right px-1 text-zinc-400">{Number.isFinite(row.vpin) ? row.vpin.toFixed(2) : '—'}</td>
                  <td className="text-right px-1 text-zinc-300">
                    {fair ?? '—'}
                    {fair && mid ? (
                      <div className="text-zinc-600">mid {mid}{k != null ? ` · k ${k}` : ''}</div>
                    ) : (k != null ? <div className="text-zinc-600">k {k}</div> : null)}
                  </td>
                  <td className="px-1" style={{ color: reasonColor(row) }} title={code}>
                    {label}
                    {es && WHY_ES[code] ? (
                      <span className="text-zinc-700 ml-1">{code}</span>
                    ) : null}
                  </td>
                  <td className="text-right px-1 text-zinc-300">{row.fillCount}</td>
                  <td className={`text-right pl-1 ${row.netPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {fmtUsd(row.netPnl)}
                  </td>
                </tr>
              );
            })}
            {!busy && (report?.rows?.length ?? 0) === 0 && (
              <tr>
                <td colSpan={8} className="py-4 text-zinc-600">
                  {es ? 'Sin cinta. No se inventa un fill.' : 'No tape. No invented fill.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {report?.note && (
        <div className="mt-2 font-mono text-[9px] text-zinc-600">{report.note}</div>
      )}
    </div>
  );
}
