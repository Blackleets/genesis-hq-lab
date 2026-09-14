import { useEffect, useState } from 'react';
import { Activity, ChevronDown, LockKeyhole, RefreshCw, Settings, Shield, X } from 'lucide-react';
import { actions } from '@core/store/genesisStore';
import type { ModuleId } from '@core/data/moduleRegistry';
import { useMarketData, useRiskState, useRunnerTelemetry } from './useTradingDesk';
import { formatMoney, stateLabel } from './formatters';

export type TradingDeskMode = 'solana' | 'futures';

const NAV: Array<{ id: ModuleId; label: string }> = [
  { id: 'hq', label: 'TRADING DESK' },
  { id: 'markets', label: 'MARKETS' },
  { id: 'edge', label: 'RISK & EDGE' },
  { id: 'system', label: 'SYSTEM' },
];

function Status({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'good' | 'warn' | 'bad' | 'neutral' }) {
  return (
    <div className={`trading-status trading-status--${tone}`}>
      <span className="trading-status__dot" />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function TradingHeader({
  onControl,
  onSettings,
  deskMode,
  onDeskModeChange,
}: {
  onControl: () => void;
  onSettings: () => void;
  deskMode: TradingDeskMode;
  onDeskModeChange: (mode: TradingDeskMode) => void;
}) {
  const { market, refresh } = useMarketData();
  const { runner } = useRunnerTelemetry();
  const { capture, truth } = useRiskState();
  const [now, setNow] = useState(() => new Date());
  const [menuOpen, setMenuOpen] = useState(false);
  const [solanaOpportunities, setSolanaOpportunities] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      try {
        const response = await fetch('/api/genesis/context?view=solana-arbitrage-radar', { cache: 'no-store' });
        if (!response.ok) return;
        const body = await response.json() as { events?: Array<{ type?: string }> };
        if (disposed) return;
        const qualified = Array.isArray(body.events)
          ? body.events.filter((event) => event?.type === 'OPPORTUNITY_DETECTED' || event?.type === 'QUALIFIED').length
          : 0;
        setSolanaOpportunities(qualified);
      } finally {
        if (!disposed) timer = setTimeout(load, 30_000);
      }
    };
    void load();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const runnerReady = runner?.agentAlive === true && runner.paperOnly === true && runner.liveOrders === false;
  const riskBand = truth.data?.execution?.globalRisk?.band ?? truth.data?.globalRisk?.band ?? 'NOT VERIFIED';
  const equity = capture.data?.funding?.equityUsdt;
  const utc = now.toISOString().slice(11, 19);
  const local = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const isSolana = deskMode === 'solana';

  const chooseDesk = (mode: TradingDeskMode) => {
    onDeskModeChange(mode);
    setMenuOpen(false);
  };

  return (
    <header className="trading-header">
      <div className="trading-header__identity">
        <div className="trading-header__mark" aria-hidden="true"><span>G</span></div>
        <div className="trading-header__name">
          <strong>GENESIS HQ</strong>
          <span>{isSolana ? 'SOLANA ARBITRAGE' : 'FUTURES DESK'}</span>
        </div>
        <div className="trading-header__nav-wrap">
          <button type="button" className="trading-header__desk-button" onClick={() => setMenuOpen((value) => !value)} aria-expanded={menuOpen}>
            {isSolana ? 'SOLANA' : 'FUTURES'} <ChevronDown size={12} />
          </button>
          {menuOpen ? (
            <div className="trading-header__nav-menu">
              <button type="button" onClick={() => chooseDesk('futures')}>FUTURES · TRADING</button>
              <button type="button" onClick={() => chooseDesk('solana')}>SOLANA · {solanaOpportunities > 0 ? `${solanaOpportunities} OPORTUNIDAD${solanaOpportunities === 1 ? '' : 'ES'}` : 'BUSCANDO'}</button>
              {NAV.map((item) => (
                <button key={item.id} type="button" onClick={() => { actions.setSelectedModule(item.id); setMenuOpen(false); }}>
                  {item.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="trading-header__telemetry">
        {isSolana ? (
          <>
            <Status label="RADAR" value="ACTIVE" tone="good" />
            <Status label="MODE" value="SHADOW" tone="warn" />
          </>
        ) : (
          <>
            <Status label="MODE" value="PAPER" tone="warn" />
            <Status label="RUNNER" value={runnerReady ? 'ACTIVE' : runner ? 'NOT VERIFIED' : stateLabel(truth.state)} tone={runnerReady ? 'good' : 'bad'} />
            <Status label="MARKET" value={stateLabel(market.state)} tone={market.state === 'ready' ? 'good' : market.state === 'stale' ? 'warn' : 'bad'} />
            <Status label="SENTINEL" value={riskBand} tone={riskBand === 'HEALTHY' ? 'good' : riskBand === 'WATCH' ? 'warn' : 'bad'} />
            <button type="button" className={`trading-header__solana-signal ${solanaOpportunities > 0 ? 'is-active' : ''}`} onClick={() => chooseDesk('solana')}>SOLANA · {solanaOpportunities > 0 ? `${solanaOpportunities} OPP` : 'SCANNING'}</button>
            <div className="trading-header__equity"><span>FUNDING EQ</span><strong>{capture.state === 'ready' ? formatMoney(equity) : stateLabel(capture.state)}</strong></div>
          </>
        )}
      </div>

      <div className="trading-header__controls">
        <button type="button" className="trading-header__live" onClick={onControl}><LockKeyhole size={12} /> LIVE LOCKED</button>
        {!isSolana ? <button type="button" className="trading-header__control" onClick={onControl}><Shield size={13} /><span>CONTROL</span></button> : null}
        <button type="button" className="trading-header__refresh" onClick={onSettings} aria-label="Open Genesis settings"><Settings size={14} /></button>
        <div className="trading-header__clock"><span>{utc} UTC</span><span>{local} LOCAL</span></div>
        <button type="button" className="trading-header__refresh" onClick={refresh} aria-label="Refresh trading desk data"><RefreshCw size={13} /></button>
        {menuOpen ? <button type="button" className="trading-header__menu-close" onClick={() => setMenuOpen(false)} aria-label="Close navigation"><X size={12} /></button> : null}
        <Activity className={isSolana || runnerReady ? 'text-emerald-300' : 'text-red-300'} size={14} aria-label={isSolana ? 'Solana radar active' : runnerReady ? 'System active' : 'System not verified'} />
      </div>
    </header>
  );
}
