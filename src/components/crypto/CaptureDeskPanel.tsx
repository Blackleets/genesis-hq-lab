import { useCallback, useEffect, useState } from 'react';
import { fetchCaptureReport, type CaptureReport, type CaptureRow } from '@services/captureClient';

const BG = '#0a0c10';
const BORDER = '#1c2430';

function fmtBps(n: number) {
  return Number.isFinite(n) ? n.toFixed(2) : '—';
}

function fmtUsd(n: number) {
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function reasonColor(row: CaptureRow): string {
  if (row.fillCount > 0) return '#22c55e';
  if (row.quote) return '#f59e0b';
  if (row.reason === 'VPIN_HALT') return '#ef4444';
  return '#71717a';
}

export function CaptureDeskPanel({ es = true }: { es?: boolean }) {
  const [report, setReport] = useState<CaptureReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  const load = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetchCaptureReport(6);
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

  const equity = report?.ledger?.paperBalanceUSDT ?? 10000;
  const pnl = equity - (report?.ledger?.start ?? 10000);

  return (
    <div style={{ background: BG, border: `1px solid ${BORDER}` }} className="px-3 py-3">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-zinc-500">
            {es ? 'Mesa de captura · PAPER' : 'Capture desk · PAPER'}
          </div>
          <div className="font-mono text-[18px] font-bold text-zinc-100 mt-0.5">
            ${equity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            <span className={`ml-2 text-[12px] ${pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {fmtUsd(pnl)}
            </span>
          </div>
          <div className="font-mono text-[10px] text-zinc-500 mt-0.5">
            LIVE_OFF · {es ? 'no es un GO de 6 gates' : 'not a 6-gate GO'} · {report?.venue ?? 'okx'}
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

      <div className="flex flex-wrap gap-3 font-mono text-[10px] mb-3">
        <span className="text-zinc-500">scan <span className="text-zinc-200">{report?.scanned ?? 0}</span></span>
        <span className="text-zinc-500">quote <span className="text-amber-300">{report?.quoted ?? 0}</span></span>
        <span className="text-zinc-500">fills <span className="text-emerald-300">{report?.filled ?? 0}</span></span>
        <span className="text-zinc-500">GO <span className="text-red-400">NO</span></span>
      </div>

      {err && (
        <div className="mb-3 border border-zinc-700 px-3 py-2 font-mono text-[11px] text-zinc-400">
          {es ? 'Desk en stand-down' : 'Desk stood down'}: {err}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full font-mono text-[10px]">
          <thead>
            <tr className="text-zinc-600 uppercase tracking-wider text-[8px]">
              <th className="text-left py-1 pr-2">sym</th>
              <th className="text-right py-1 px-1">H</th>
              <th className="text-right py-1 px-1">spr</th>
              <th className="text-right py-1 px-1">VPIN</th>
              <th className="text-left py-1 px-1">why</th>
              <th className="text-right py-1 px-1">fills</th>
              <th className="text-right py-1 pl-1">pnl</th>
            </tr>
          </thead>
          <tbody>
            {(report?.rows ?? []).map((row) => (
              <tr key={row.symbol} style={{ borderTop: `1px solid ${BORDER}` }}>
                <td className="py-1.5 pr-2 text-zinc-200">{row.symbol.replace('-USDT-SWAP', '')}</td>
                <td className="text-right px-1 text-zinc-300">{fmtBps(row.harvestBps)}</td>
                <td className="text-right px-1 text-zinc-400">{fmtBps(row.spreadBps)}</td>
                <td className="text-right px-1 text-zinc-400">{row.vpin.toFixed(2)}</td>
                <td className="px-1" style={{ color: reasonColor(row) }}>{row.captureReason || row.reason}</td>
                <td className="text-right px-1 text-zinc-300">{row.fillCount}</td>
                <td className={`text-right pl-1 ${row.netPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {fmtUsd(row.netPnl)}
                </td>
              </tr>
            ))}
            {!busy && (report?.rows?.length ?? 0) === 0 && (
              <tr>
                <td colSpan={7} className="py-4 text-zinc-600">
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
