import { useEffect, useState } from 'react';
import { useLanguage } from '@core/i18n/languageStore';
import { useLiveTrading } from '@dashboard/hooks/useLiveTrading';
import { useActiveAgents, useOnboardingAgents, useWallet } from '@core/store/genesisStore';

function truncateAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function TopBar() {
  const lang = useLanguage();
  const live = useLiveTrading();
  const activeAgents = useActiveAgents();
  const onboardingAgents = useOnboardingAgents();
  const wallet = useWallet();
  const totalAgents = activeAgents.length + onboardingAgents.length;
  const [livePulse, setLivePulse] = useState(true);

  useEffect(() => {
    const id = window.setInterval(() => setLivePulse((v) => !v), 1_500);
    return () => window.clearInterval(id);
  }, []);

  const totalPnL = live.totalPnL;
  const pnlColor = totalPnL >= 0 ? '#00ff9c' : '#ff4757';
  const capitalColor = live.online && live.capital >= 10_000 ? '#00ff9c' : live.online ? '#ff4757' : '#71717a';

  return (
    <div className="shrink-0 h-8 bg-carbon-200 border-b border-trim flex items-center px-4 gap-4 font-mono text-[10px] uppercase tracking-wider overflow-hidden">
      <span className="text-zinc-400 shrink-0">Genesis HQ</span>
      <span className="text-zinc-700">|</span>
      {live.online ? (
        <>
          <span className="text-zinc-500 shrink-0">
            {lang === 'es' ? 'Capital' : 'Cap'}:{' '}
            <span style={{ color: capitalColor }}>
              ${live.capital.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </span>
          <span className="text-zinc-700">|</span>
          <span className="text-zinc-500 shrink-0">
            P&L:{' '}
            <span style={{ color: pnlColor }}>
              {totalPnL >= 0 ? '+' : ''}${totalPnL.toFixed(2)}
            </span>
          </span>
          {live.openTrades.length > 0 && (
            <>
              <span className="text-zinc-700">|</span>
              <span className="text-zinc-500 shrink-0">
                {lang === 'es' ? 'Abiertas' : 'Open'}:{' '}
                <span className="text-zinc-200">{live.openTrades.length}</span>
              </span>
            </>
          )}
        </>
      ) : (
        <span className="text-amber-400/90 shrink-0">
          {lang === 'es' ? 'Backend offline — npm run start' : 'Backend offline — npm run start'}
        </span>
      )}
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
        style={{ color: live.online ? (livePulse ? '#00ff9c' : '#4a5568') : '#ff4757' }}
      >
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-current" />
        {live.online ? 'LIVE' : 'OFFLINE'}
      </span>
    </div>
  );
}
