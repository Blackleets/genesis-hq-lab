import { useEffect, useState } from 'react';
import { Activity, ChevronDown, LockKeyhole, RefreshCw, Shield, X } from 'lucide-react';
import { actions } from '@core/store/genesisStore';
import type { ModuleId } from '@core/data/moduleRegistry';
import { useMarketData, useRiskState, useRunnerTelemetry } from './useTradingDesk';
import { formatMoney, stateLabel } from './formatters';

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

export function TradingHeader({ onControl }: { onControl: () => void }) {
  const { market, refresh } = useMarketData();
  const { runner } = useRunnerTelemetry();
  const { capture, truth } = useRiskState();
  const [now, setNow] = useState(() => new Date());
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const runnerReady = runner?.agentAlive === true && runner.paperOnly === true && runner.liveOrders === false;
  const riskBand = truth.data?.execution?.globalRisk?.band ?? truth.data?.globalRisk?.band ?? 'NOT VERIFIED';
  const equity = capture.data?.funding?.equityUsdt;
  const utc = now.toISOString().slice(11, 19);
  const local = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <header className="trading-header">
      <div className="trading-header__identity">
        <div className="trading-header__mark" aria-hidden="true"><span>G</span></div>
        <div className="trading-header__name"><strong>GENESIS HQ</strong><span>FUTURES DESK</span></div>
        <div className="trading-header__nav-wrap">
          <button type="button" className="trading-header__desk-button" onClick={() => setMenuOpen((value) => !value)} aria-expanded={menuOpen}>
            ACTIVE DESK <ChevronDown size={12} />
          </button>
          {menuOpen ? (
            <div className="trading-header__nav-menu">
              {NAV.map((item) => <button key={item.id} type="button" onClick={() => { actions.setSelectedModule(item.id); setMenuOpen(false); }}>{item.label}</button>)}
            </div>
          ) : null}
        </div>
      </div>

      <div className="trading-header__telemetry">
        <Status label="MODE" value="PAPER" tone="warn" />
        <Status label="RUNNER" value={runnerReady ? 'ACTIVE' : runner ? 'NOT VERIFIED' : stateLabel(truth.state)} tone={runnerReady ? 'good' : 'bad'} />
        <Status label="MARKET" value={stateLabel(market.state)} tone={market.state === 'ready' ? 'good' : market.state === 'stale' ? 'warn' : 'bad'} />
        <Status label="SENTINEL" value={riskBand} tone={riskBand === 'HEALTHY' ? 'good' : riskBand === 'WATCH' ? 'warn' : 'bad'} />
        <div className="trading-header__equity"><span>FUNDING EQ</span><strong>{capture.state === 'ready' ? formatMoney(equity) : stateLabel(capture.state)}</strong></div>
      </div>

      <div className="trading-header__controls">
        <button type="button" className="trading-header__live" onClick={onControl}><LockKeyhole size={12} /> LIVE LOCKED</button>
        <button type="button" className="trading-header__control" onClick={onControl}><Shield size={13} /><span>CONTROL</span></button>
        <div className="trading-header__clock"><span>{utc} UTC</span><span>{local} LOCAL</span></div>
        <button type="button" className="trading-header__refresh" onClick={refresh} aria-label="Refresh trading desk data"><RefreshCw size={13} /></button>
        {menuOpen ? <button type="button" className="trading-header__menu-close" onClick={() => setMenuOpen(false)} aria-label="Close navigation"><X size={12} /></button> : null}
        <Activity className={runnerReady ? 'text-emerald-300' : 'text-red-300'} size={14} aria-label={runnerReady ? 'System active' : 'System not verified'} />
      </div>
    </header>
  );
}
