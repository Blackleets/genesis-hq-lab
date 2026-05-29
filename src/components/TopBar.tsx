import { useEffect, useState } from 'react';
import { useLanguage } from '../i18n/languageStore';
import {
  useCapital, usePositions, useTradingStats,
  useActiveAgents, useOnboardingAgents, useWallet,
} from '../state/genesisStore';

function truncateAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function TopBar() {
  const lang = useLanguage();
  const capital = useCapital();
  const stats = useTradingStats();
  const positions = usePositions();
  const activeAgents = useActiveAgents();
  const onboardingAgents = useOnboardingAgents();
  const wallet = useWallet();
  const totalAgents = activeAgents.length + onboardingAgents.length;
  const [livePulse, setLivePulse] = useState(true);

  useEffect(() => {
    const id = window.setInterval(() => setLivePulse((v) => !v), 1_500);
    return () => window.clearInterval(id);
  }, []);

  const unrealizedPnL = positions.reduce(
    (sum, p) => sum + (p.currentPrice - p.entryPrice) * p.shares * (p.outcome === 'YES' ? 1 : -1),
    0
  );
  const totalPnL = stats.totalPnL + unrealizedPnL;
  const pnlColor = totalPnL >= 0 ? '#00ff9c' : '#ff4757';
  const capitalColor = capital >= 10_000 ? '#00ff9c' : '#ff4757';

  return (
    <div className="shrink-0 h-8 bg-carbon-200 border-b border-trim flex items-center px-4 gap-4 font-mono text-[10px] uppercase tracking-wider overflow-hidden">
      <span className="text-zinc-400 shrink-0">Genesis HQ</span>
      <span className="text-zinc-700">|</span>
      <span className="text-zinc-500 shrink-0">
        {lang === 'es' ? 'Capital' : 'Cap'}:{' '}
        <span style={{ color: capitalColor }}>
          ${capital.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      </span>
      <span className="text-zinc-700">|</span>
      <span className="text-zinc-500 shrink-0">
        P&L:{' '}
        <span style={{ color: pnlColor }}>
          {totalPnL >= 0 ? '+' : ''}${totalPnL.toFixed(2)}
        </span>
        {unrealizedPnL !== 0 && (
          <span className="text-zinc-600 ml-1">
            ({unrealizedPnL >= 0 ? '+' : ''}${unrealizedPnL.toFixed(2)} {lang === 'es' ? 'no real.' : 'unreal.'})
          </span>
        )}
      </span>
      <span className="text-zinc-700">|</span>
      <span className="text-zinc-500 shrink-0">
        {lang === 'es' ? 'Ags' : 'Ags'}:{' '}
        <span className="text-zinc-200">{totalAgents}</span>
      </span>
      {wallet.connected && wallet.address && (
        <>
          <span className="text-zinc-700">|</span>
          <span style={{ color: '#7c5cff' }} className="shrink-0">{truncateAddress(wallet.address)}</span>
        </>
      )}
      <span className="text-zinc-700 ml-auto">|</span>
      <span
        className="flex items-center gap-1.5 shrink-0"
        style={{ color: livePulse ? '#00ff9c' : '#4a5568' }}
      >
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-current" />
        LIVE
      </span>
    </div>
  );
}
