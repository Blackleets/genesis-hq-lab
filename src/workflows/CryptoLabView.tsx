import { useEffect, useState, useCallback, useMemo } from 'react';
import { useLanguage } from '@core/i18n/languageStore';
import {
  applyIntelligenceSupervisorRun, loadCryptoOverview, loadTradeStories, loadCommentary, loadDiagnostics, loadShadowCandidateDiagnostics, loadBreakoutShadow, loadFuturesDesk, resetFuturesDeskBaseline, rollbackIntelligenceSupervisor, runIntelligenceSupervisor,
  type CryptoOverview, type TradeStory, type CommentaryItem, type ExecutionDiagnostics, type ShadowCandidateDiagnostics, type BreakoutShadowDiagnostics, type FuturesDeskSnapshot,
} from '@services/cryptoClient';
import CandleChart from '@dashboard/charts/CandleChart';
import { apiUrl } from '@services/apiBase';
import { CommentaryFeed } from '../components/crypto/CommentaryFeed';
import { RightPanel } from '../components/crypto/RightPanel';
import { DeskPanel } from '../components/crypto/DeskPanel';
import { LiveActivityStrip } from '../components/crypto/LiveActivityStrip';
import { OperatorStatusBar } from '../components/crypto/OperatorStatusBar';
import { TradeNotifier } from '../components/crypto/TradeNotifier';

const ACCENT = '#f7931a';

const usd = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n ?? 0);
const pct = (n: number) => `${((n ?? 0) * 100).toFixed(1)}%`;

export default function CryptoLabView() {
  const lang = useLanguage();
  const es = lang === 'es';
  const [data, setData] = useState<CryptoOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [orderStatus, setOrderStatus] = useState<string | null>(null);
  const [tradeStories, setTradeStories] = useState<TradeStory[]>([]);
  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null);
  const [commentary, setCommentary] = useState<CommentaryItem[]>([]);
  const [diagnostics, setDiagnostics] = useState<ExecutionDiagnostics | null>(null);
  const [shadowCandidate, setShadowCandidate] = useState<ShadowCandidateDiagnostics | null>(null);
  const [breakoutShadow, setBreakoutShadow] = useState<BreakoutShadowDiagnostics | null>(null);
  const [futuresDesk, setFuturesDesk] = useState<FuturesDeskSnapshot | null>(null);
  const [futuresCycleBusy, setFuturesCycleBusy] = useState(false);
  const [futuresCycleStatus, setFuturesCycleStatus] = useState<string | null>(null);
  const [futuresBaselineBusy, setFuturesBaselineBusy] = useState(false);
  const [supervisorBusy, setSupervisorBusy] = useState(false);
  const [supervisorApplyBusy, setSupervisorApplyBusy] = useState(false);
  const [supervisorRollbackBusy, setSupervisorRollbackBusy] = useState(false);

  const fetchOverview = useCallback(async () => {
    try {
      const d = await loadCryptoOverview();
      setData(d);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const fetchTrades = useCallback(async () => { setTradeStories(await loadTradeStories(60)); }, []);
  const fetchCommentary = useCallback(async () => {
    const c = await loadCommentary(40);
    if (c.length > 0) setCommentary(c);
  }, []);
  const fetchDiagnostics = useCallback(async () => {
    const d = await loadDiagnostics();
    if (d) setDiagnostics(d);
  }, []);
  const fetchShadowCandidate = useCallback(async () => {
    const data = await loadShadowCandidateDiagnostics();
    if (data) setShadowCandidate(data);
  }, []);
  const fetchBreakoutShadow = useCallback(async () => {
    const data = await loadBreakoutShadow();
    if (data) setBreakoutShadow(data);
  }, []);
  const fetchFuturesDesk = useCallback(async () => {
    const desk = await loadFuturesDesk();
    if (desk) {
      setFuturesDesk(desk);
      setFuturesCycleStatus((prev) =>
        prev && /backend no devolvio|backend did not return|no se pudo refrescar|could not refresh/i.test(prev)
          ? null
          : prev
      );
    }
  }, []);

  // In the serverless prod deploy the futures desk is a read-only Supabase
  // snapshot (the edge fn flags this in `warnings`). Write actions (run cycle,
  // baseline reset, supervisor run/apply/rollback, manual orders) hit endpoints
  // that don't exist there and 404. Detect snapshot mode so handlers can refuse
  // with a clear message instead of a silent failure.
  const isSnapshot = (futuresDesk?.warnings ?? []).some((w) =>
    /snapshot|fallback|unavailable|render backend/i.test(w.error));
  const snapshotMsg = es
    ? 'Modo snapshot (solo lectura): acción no disponible en producción.'
    : 'Snapshot mode (read-only): action unavailable in production.';

  const handleRunFuturesCycle = useCallback(async () => {
    if (isSnapshot) { setFuturesCycleStatus(snapshotMsg); return; }
    setFuturesCycleBusy(true);
    setFuturesCycleStatus(es ? 'Ejecutando ciclo real de futuros...' : 'Running real futures cycle...');
    try {
      const desk = await loadFuturesDesk(true, 35_000);
      if (desk) {
        setFuturesDesk(desk);
        await Promise.all([fetchOverview(), fetchTrades(), fetchDiagnostics()]);
        const executed = desk.cycle?.executed ?? 0;
        const qualified = desk.cycle?.qualified ?? 0;
        setFuturesCycleStatus(
          es
            ? `Ciclo completado: ${executed} entradas, ${qualified} setups calificados`
            : `Cycle completed: ${executed} entries, ${qualified} qualified setups`
        );
      } else {
        const latestDesk = await loadFuturesDesk(false, 10_000);
        if (latestDesk) {
          setFuturesDesk(latestDesk);
          setFuturesCycleStatus(
            es
              ? 'Ciclo lanzado, pero el snapshot tardo mas de lo esperado. Manteniendo el ultimo estado valido.'
              : 'Cycle launched, but the snapshot took longer than expected. Keeping the last valid state.'
          );
        } else {
          setFuturesCycleStatus(
            es
              ? 'No se pudo refrescar el snapshot de futuros. El desk sigue vivo, pero sin confirmacion nueva.'
              : 'Could not refresh the futures snapshot. The desk is still live, but without a fresh confirmation.'
          );
        }
      }
    } catch {
      setFuturesCycleStatus(es ? 'Fallo el ciclo manual de futuros.' : 'Manual futures cycle failed.');
    } finally {
      setFuturesCycleBusy(false);
    }
  }, [es, fetchDiagnostics, fetchOverview, fetchTrades, isSnapshot, snapshotMsg]);

  const handleResetFuturesBaseline = useCallback(async () => {
    if (isSnapshot) { setFuturesCycleStatus(snapshotMsg); return; }
    setFuturesBaselineBusy(true);
    setFuturesCycleStatus(es ? 'Reiniciando baseline de PnL de futuros...' : 'Resetting futures PnL baseline...');
    try {
      const baseline = await resetFuturesDeskBaseline();
      if (baseline) {
        const latestDesk = await loadFuturesDesk(false, 10_000);
        if (latestDesk) setFuturesDesk(latestDesk);
        await Promise.all([fetchOverview(), fetchTrades(), fetchDiagnostics()]);
        setFuturesCycleStatus(
          es
            ? `Baseline reiniciado en ${baseline.baselineAt}. El historial queda intacto.`
            : `Baseline reset at ${baseline.baselineAt}. Historical trades remain intact.`
        );
      } else {
        setFuturesCycleStatus(es ? 'No se pudo reiniciar el baseline de futuros.' : 'Could not reset the futures baseline.');
      }
    } catch {
      setFuturesCycleStatus(es ? 'Fallo el reinicio del baseline de futuros.' : 'Futures baseline reset failed.');
    } finally {
      setFuturesBaselineBusy(false);
    }
  }, [es, fetchDiagnostics, fetchOverview, fetchTrades, isSnapshot, snapshotMsg]);

  const handleRunSupervisor = useCallback(async () => {
    if (isSnapshot) { setFuturesCycleStatus(snapshotMsg); return; }
    setSupervisorBusy(true);
    setFuturesCycleStatus(es ? 'Ejecutando supervisor advisory de futuros...' : 'Running futures advisory supervisor...');
    try {
      const result = await runIntelligenceSupervisor(40_000);
      const latestDesk = await loadFuturesDesk(false, 10_000);
      if (latestDesk) setFuturesDesk(latestDesk);

      if (!result) {
        setFuturesCycleStatus(es ? 'No hubo respuesta del supervisor.' : 'Supervisor did not return a response.');
      } else if (result.ok) {
        const latest = result.state?.latest ?? result.state?.latestAttempt ?? null;
        setFuturesCycleStatus(
          latest?.score != null
            ? (es ? `Supervisor listo: score ${latest.score.toFixed(3)} advisory only.` : `Supervisor ready: score ${latest.score.toFixed(3)} advisory only.`)
            : (es ? 'Supervisor ejecutado en modo advisory.' : 'Supervisor completed in advisory mode.')
        );
      } else {
        setFuturesCycleStatus(
          es
            ? `Supervisor degradado: ${result.error ?? 'proveedor no disponible'}`
            : `Supervisor degraded: ${result.error ?? 'provider unavailable'}`
        );
      }
    } catch {
      setFuturesCycleStatus(es ? 'Fallo el supervisor advisory.' : 'Advisory supervisor failed.');
    } finally {
      setSupervisorBusy(false);
    }
  }, [es, isSnapshot, snapshotMsg]);

  const handleApplySupervisor = useCallback(async () => {
    if (isSnapshot) { setFuturesCycleStatus(snapshotMsg); return; }
    const runId = futuresDesk?.supervisor?.latest?.id ?? futuresDesk?.supervisor?.latestAttempt?.id ?? null;
    if (!runId) {
      setFuturesCycleStatus(es ? 'No hay recomendacion aplicable.' : 'No applicable recommendation exists.');
      return;
    }
    setSupervisorApplyBusy(true);
    setFuturesCycleStatus(es ? 'Aplicando overrides seguros del supervisor...' : 'Applying safe supervisor overrides...');
    try {
      const result = await applyIntelligenceSupervisorRun(runId, 15_000);
      const latestDesk = await loadFuturesDesk(false, 10_000);
      if (latestDesk) setFuturesDesk(latestDesk);

      if (!result) {
        setFuturesCycleStatus(es ? 'No hubo respuesta al aplicar el supervisor.' : 'No response while applying the supervisor.');
      } else if (result.ok) {
        const count = result.state?.appliedPolicy?.overrides?.length ?? 0;
        setFuturesCycleStatus(
          es
            ? `Supervisor aplicado: ${count} override(s) activos en runtime.`
            : `Supervisor applied: ${count} runtime override(s) active.`
        );
      } else {
        setFuturesCycleStatus(
          es
            ? `No se pudo aplicar: ${result.error ?? 'error desconocido'}`
            : `Could not apply: ${result.error ?? 'unknown error'}`
        );
      }
    } catch {
      setFuturesCycleStatus(es ? 'Fallo la aplicacion del supervisor.' : 'Supervisor apply failed.');
    } finally {
      setSupervisorApplyBusy(false);
    }
  }, [es, futuresDesk, isSnapshot, snapshotMsg]);

  const handleRollbackSupervisor = useCallback(async () => {
    if (isSnapshot) { setFuturesCycleStatus(snapshotMsg); return; }
    setSupervisorRollbackBusy(true);
    setFuturesCycleStatus(es ? 'Revirtiendo overrides del supervisor...' : 'Rolling back supervisor overrides...');
    try {
      const result = await rollbackIntelligenceSupervisor(15_000);
      const latestDesk = await loadFuturesDesk(false, 10_000);
      if (latestDesk) setFuturesDesk(latestDesk);
      if (!result) {
        setFuturesCycleStatus(es ? 'No hubo respuesta al revertir.' : 'No response while rolling back.');
      } else if (result.ok) {
        setFuturesCycleStatus(es ? 'Overrides del supervisor revertidos.' : 'Supervisor overrides rolled back.');
      } else {
        setFuturesCycleStatus(
          es
            ? `No se pudo revertir: ${result.error ?? 'error desconocido'}`
            : `Could not roll back: ${result.error ?? 'unknown error'}`
        );
      }
    } catch {
      setFuturesCycleStatus(es ? 'Fallo el rollback del supervisor.' : 'Supervisor rollback failed.');
    } finally {
      setSupervisorRollbackBusy(false);
    }
  }, [es, isSnapshot, snapshotMsg]);

  useEffect(() => {
    fetchOverview(); fetchTrades(); fetchCommentary(); fetchDiagnostics(); fetchShadowCandidate(); fetchBreakoutShadow(); fetchFuturesDesk();
    const id1 = setInterval(fetchOverview, 15_000);
    const id2 = setInterval(fetchTrades, 15_000);
    const id3 = setInterval(fetchCommentary, 5_000);
    const id4 = setInterval(fetchDiagnostics, 10_000);
    const id5 = setInterval(fetchShadowCandidate, 10_000);
    const id6 = setInterval(fetchBreakoutShadow, 60_000); // 4h strategy — 1 min refresh is plenty
    const id7 = setInterval(fetchFuturesDesk, 15_000);
    return () => { clearInterval(id1); clearInterval(id2); clearInterval(id3); clearInterval(id4); clearInterval(id5); clearInterval(id6); clearInterval(id7); };
  }, [fetchOverview, fetchTrades, fetchCommentary, fetchDiagnostics, fetchShadowCandidate, fetchBreakoutShadow, fetchFuturesDesk]);

  // Today's realized stats — computed from closed trades (real, no extra fetch)
  const today = useMemo(() => {
    const startMs = new Date().setHours(0, 0, 0, 0);
    let pnl = 0, wins = 0, losses = 0;
    for (const t of tradeStories) {
      if (t.status === 'closed' && t.closed_at && Date.parse(t.closed_at) >= startMs) {
        pnl += t.pnl ?? 0;
        if ((t.pnl ?? 0) > 0) wins++; else if ((t.pnl ?? 0) < 0) losses++;
      }
    }
    return { pnl, wins, losses };
  }, [tradeStories]);

  async function handleManualOrder(side: 'LONG' | 'SHORT', pair: string) {
    if (isSnapshot) { setOrderStatus(snapshotMsg); return; }
    setOrderStatus(`Enviando ${side} ${pair.replace('USDT', '')}…`);
    try {
      const res = await fetch(apiUrl('/api/crypto/order'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pair, side, capitalUsed: 100 }),
      });
      const json = await res.json();
      if (json.ok) {
        setOrderStatus(`✓ ${side} ejecutado — $100 en ${pair.replace('USDT', '')}`);
      } else {
        setOrderStatus(`✗ Error: ${json.error}`);
      }
    } catch {
      setOrderStatus('✗ Sin conexión al backend');
    }
    setTimeout(() => setOrderStatus(null), 5000);
  }

  const pnl = data?.pnl;
  const futuresTreasury = futuresDesk?.treasury ?? null;
  const futuresClosedPnl = futuresDesk?.closedSummary.reduce((sum, row) => sum + (row.totalPnl ?? 0), 0) ?? 0;
  const futuresNetPnl = futuresTreasury ? futuresClosedPnl + (futuresTreasury.unrealizedPnl ?? 0) : futuresClosedPnl;
  const futuresOpenCount = futuresDesk?.openPositions.length ?? 0;
  const futuresOnlyView = (futuresDesk?.config.profiles.length ?? 0) > 0;
  const filteredCommentary = futuresOnlyView
    ? commentary.filter((item) => !/SCALPING PAUSED|negative edge recommendation|PAUSE NOW/i.test(`${item.text} ${item.detail}`))
    : commentary;

  return (
    <main className="flex-1 min-w-0 min-h-0 flex flex-col bg-carbon-300 overflow-hidden">
      {/* ── Header: brand row + live activity strip + operator status bar ─── */}
      <div className="shrink-0 border-b border-zinc-800">
        {/* Row 1 — brand + lifetime PnL */}
        <div className="flex items-center justify-between px-4 py-2.5">
          <div className="flex items-center gap-3">
            <span className="inline-block w-2 h-2 rounded-full animate-pulse" style={{ background: ACCENT }} />
            <span className="font-mono text-xs uppercase tracking-wider text-zinc-500">Genesis HQ · Crypto Terminal</span>
            {futuresTreasury ? (
              <div className="flex gap-4 ml-4">
                <span className="font-mono text-xs" style={{ color: futuresNetPnl >= 0 ? '#22c55e' : '#ef4444' }}>
                  Futures {usd(futuresNetPnl)}
                </span>
                <span className="font-mono text-xs text-zinc-400">
                  Avail {usd(futuresTreasury.available)}
                </span>
                <span className="font-mono text-xs text-amber-400">margin {usd(futuresTreasury.inTrades)}</span>
                <span className="font-mono text-xs text-zinc-500">{futuresOpenCount} open</span>
              </div>
            ) : pnl && (
              <div className="flex gap-4 ml-4">
                <span className="font-mono text-xs" style={{ color: pnl.closed.totalPnl >= 0 ? '#22c55e' : '#ef4444' }}>
                  PnL {usd(pnl.closed.totalPnl)}
                </span>
                <span className="font-mono text-xs text-zinc-500">
                  Win {pnl.closed.total > 0 ? pct(pnl.closed.winRate) : '—'}
                </span>
                <span className="font-mono text-xs text-amber-400">{pnl.open.count} open</span>
              </div>
            )}
          </div>
          {error && <span className="font-mono text-[10px] text-red-400">⚠ backend offline</span>}
          {orderStatus && (
            <span className="font-mono text-[10px] text-zinc-300 flex items-center gap-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              {orderStatus}
            </span>
          )}
        </div>

        {/* Row 2 — live activity strip (priority-aware) */}
        <div className="border-t border-zinc-800/60">
          <LiveActivityStrip items={filteredCommentary} />
        </div>

        {/* Row 3 — operator status bar (counter + training + heartbeat) */}
        <OperatorStatusBar
          diagnostics={diagnostics}
          openCount={pnl?.open.count ?? 0}
          today={today}
          futuresDesk={futuresDesk}
        />
      </div>

      {/* ── Chart-Hero Terminal Grid ──────────────────────────────────── */}
      {/*
        Layout:
          [──────────── CHART (hero, full width, tall) ────────────────]
          [ COMMENTARY ] [ DESK (positions/stats) ] [ INTEL | DEPTH ]
      */}
      <div className="crypto-terminal-grid">
        {/* Hero chart — spans full width on top */}
        <div className="crypto-zone-chart">
          <CandleChart
            positions={data?.positions ?? []}
            onManualOrder={handleManualOrder}
            tradeStories={tradeStories}
            selectedTradeId={selectedTradeId}
            onSelectTrade={setSelectedTradeId}
          />
        </div>

        {/* AI Commentary (bottom-left) */}
        <div className="crypto-zone-commentary">
          <CommentaryFeed items={filteredCommentary} />
        </div>

        {/* Desk panel — positions + stats + trades (bottom-center) */}
        <div className="crypto-zone-desk">
          <DeskPanel
            data={data}
            es={es}
            tradeStories={tradeStories}
            selectedTradeId={selectedTradeId}
            onSelectTrade={setSelectedTradeId}
            diagnostics={diagnostics}
            shadowCandidate={shadowCandidate}
            breakoutShadow={breakoutShadow}
            futuresDesk={futuresDesk}
            onRunFuturesCycle={handleRunFuturesCycle}
            onResetFuturesBaseline={handleResetFuturesBaseline}
            onRunSupervisor={handleRunSupervisor}
            onApplySupervisor={handleApplySupervisor}
            onRollbackSupervisor={handleRollbackSupervisor}
            futuresCycleBusy={futuresCycleBusy}
            futuresBaselineBusy={futuresBaselineBusy}
            supervisorBusy={supervisorBusy}
            supervisorApplyBusy={supervisorApplyBusy}
            supervisorRollbackBusy={supervisorRollbackBusy}
            futuresCycleStatus={futuresCycleStatus}
          />
        </div>

        {/* Market Intelligence / Depth (bottom-right) */}
        <div className="crypto-zone-intel">
          <RightPanel />
        </div>
      </div>

      {/* Premium trade notifications (fixed, bottom-right) */}
      <TradeNotifier commentary={commentary} trades={tradeStories} />
    </main>
  );
}
