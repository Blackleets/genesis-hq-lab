import { CircleAlert, DatabaseZap, ShieldCheck } from 'lucide-react';
import { useRiskState, useRunnerTelemetry } from './useTradingDesk';
import { finite, formatMoney, stateLabel } from './formatters';
import './economicTruth.css';

type CohortStats = {
  trades?: number;
  closed?: number;
  wins?: number;
  losses?: number;
  winRate?: number | null;
  realizedPnl?: number | null;
  profitFactor?: number | null;
  expectancy?: number | null;
  avgWin?: number | null;
  avgLoss?: number | null;
  payoffRatio?: number | null;
  maxDrawdown?: number | null;
};

type ExtendedRunnerStats = {
  sampleTrades?: number;
  sampleClosed?: number;
  openPositions?: number;
  sampleRealizedPnl?: number | null;
  sampleWinRate?: number | null;
  profitFactor?: number | null;
  expectancy?: number | null;
  avgWin?: number | null;
  avgLoss?: number | null;
  payoffRatio?: number | null;
  maxDrawdown?: number | null;
  grossProfit?: number | null;
  grossLoss?: number | null;
  windowLimit?: number | null;
  cohorts?: Record<string, CohortStats>;
};

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' | 'warn' }) {
  return <div><dt>{label}</dt><dd className={tone ? `economic-truth__${tone}` : ''}>{value}</dd></div>;
}

function pnlTone(value: number | null | undefined): 'good' | 'bad' | undefined {
  return finite(value) ? value >= 0 ? 'good' : 'bad' : undefined;
}

export function EconomicTruthPanel() {
  const { runner, resource } = useRunnerTelemetry();
  const { capture } = useRiskState();
  const stats = runner?.stats as ExtendedRunnerStats | null | undefined;
  const funding = capture.state === 'ready' ? capture.data?.funding : null;
  const captureLedger = capture.state === 'ready' ? capture.data?.ledger : null;
  const capturePnl = captureLedger && finite(captureLedger.paperBalanceUSDT) && finite(captureLedger.start)
    ? captureLedger.paperBalanceUSDT - captureLedger.start
    : null;
  const futuresReady = resource.state === 'ready' && runner?.paperOnly === true && runner.liveOrders === false;
  const fundingReady = capture.state === 'ready' && funding != null;
  const captureReady = capture.state === 'ready' && captureLedger != null;

  return (
    <section className="economic-truth" data-source="SLEEVE-SCOPED VERIFIED ECONOMICS" aria-label="Genesis economic truth by sleeve">
      <div className="economic-truth__notice">
        <ShieldCheck size={14} />
        <div>
          <strong>ECONOMIC TRUTH · SLEEVE SCOPED</strong>
          <span>Numbers below are kept separate until account ownership and overlap are reconciled. Genesis does not sum unrelated paper ledgers into a fake company P&amp;L.</span>
        </div>
      </div>

      <div className="economic-truth__grid">
        <article className="economic-truth__card">
          <header><div><strong>FUTURES RUNNER</strong><span>SUPABASE · RECENT SAMPLE ≤ {stats?.windowLimit ?? 80}</span></div><i className={futuresReady ? 'is-ready' : ''}>{futuresReady ? 'VERIFIED PAPER' : stateLabel(resource.state)}</i></header>
          <dl>
            <Metric label="REALIZED SAMPLE" value={formatMoney(stats?.sampleRealizedPnl)} tone={pnlTone(stats?.sampleRealizedPnl)} />
            <Metric label="CLOSED" value={stats?.sampleClosed == null ? 'UNAVAILABLE' : String(stats.sampleClosed)} />
            <Metric label="WIN RATE" value={stats?.sampleWinRate == null ? 'UNAVAILABLE' : `${(stats.sampleWinRate * 100).toFixed(1)}%`} />
            <Metric label="PROFIT FACTOR" value={stats?.profitFactor == null ? 'UNAVAILABLE' : stats.profitFactor.toFixed(2)} tone={stats?.profitFactor == null ? undefined : stats.profitFactor >= 1 ? 'good' : 'bad'} />
            <Metric label="EXPECTANCY / TRADE" value={formatMoney(stats?.expectancy)} tone={pnlTone(stats?.expectancy)} />
            <Metric label="MAX SAMPLE DD" value={formatMoney(stats?.maxDrawdown)} tone={finite(stats?.maxDrawdown) && stats!.maxDrawdown! > 0 ? 'warn' : undefined} />
          </dl>
        </article>

        <article className="economic-truth__card">
          <header><div><strong>FUNDING / BASIS</strong><span>TRUTH LEDGER v{funding?.ledgerVersion ?? '—'}</span></div><i className={fundingReady ? 'is-ready' : ''}>{fundingReady ? 'VERIFIED PAPER' : stateLabel(capture.state)}</i></header>
          <dl>
            <Metric label="ECONOMIC P&L" value={formatMoney(funding?.economicPnlUsdt)} tone={pnlTone(funding?.economicPnlUsdt)} />
            <Metric label="PRICE REALIZED" value={formatMoney(funding?.realizedPricePnlUsdt)} tone={pnlTone(funding?.realizedPricePnlUsdt)} />
            <Metric label="FUNDING COLLECTED" value={formatMoney(funding?.realizedFundingUsdt)} tone={pnlTone(funding?.realizedFundingUsdt)} />
            <Metric label="FEES" value={formatMoney(funding?.feesUsdt)} tone={finite(funding?.feesUsdt) && funding!.feesUsdt > 0 ? 'warn' : undefined} />
            <Metric label="SLEEVE EQUITY" value={formatMoney(funding?.equityUsdt)} />
            <Metric label="SETTLES / CLOSED" value={funding ? `${funding.settledCount} / ${funding.closedCount}` : 'UNAVAILABLE'} />
          </dl>
        </article>

        <article className="economic-truth__card">
          <header><div><strong>CAPTURE / MARKET MAKING</strong><span>{capture.data?.venue?.toUpperCase() ?? 'VENUE UNAVAILABLE'} · PAPER LEDGER</span></div><i className={captureReady ? 'is-ready' : ''}>{captureReady ? 'VERIFIED PAPER' : stateLabel(capture.state)}</i></header>
          <dl>
            <Metric label="LEDGER DELTA" value={formatMoney(capturePnl)} tone={pnlTone(capturePnl)} />
            <Metric label="START BALANCE" value={formatMoney(captureLedger?.start)} />
            <Metric label="PAPER BALANCE" value={formatMoney(captureLedger?.paperBalanceUSDT)} />
            <Metric label="FILLS" value={capture.state === 'ready' ? String(capture.data?.filled ?? 0) : 'UNAVAILABLE'} />
            <Metric label="QUOTED" value={capture.state === 'ready' ? String(capture.data?.quoted ?? 0) : 'UNAVAILABLE'} />
            <Metric label="LIVE" value={captureLedger?.liveOff === true ? 'OFF / LOCKED' : 'NOT VERIFIED'} tone="warn" />
          </dl>
        </article>

        <article className="economic-truth__card economic-truth__card--aggregate">
          <header><div><strong>GENESIS COMPANY TOTAL</strong><span>CANONICAL AGGREGATE</span></div><i className="is-blocked">NOT RECONCILED</i></header>
          <div className="economic-truth__blocked">
            <CircleAlert size={18} />
            <strong>NO COMPANY-WIDE P&amp;L CLAIM</strong>
            <p>Futures, funding and capture ledgers are independently observable, but shared capital, account overlap and transfer reconciliation are not yet proven. Summing them would risk double counting.</p>
          </div>
          <footer><DatabaseZap size={12} /> NEXT GATE: durable sleeve IDs + capital ownership + reconciliation proof</footer>
        </article>
      </div>
    </section>
  );
}
