import { useEffect, useState } from 'react';
import { useLanguage } from '@core/i18n/languageStore';
import { useLiveTrading } from '@dashboard/hooks/useLiveTrading';
import { useActiveAgents, useOnboardingAgents, useWallet } from '@core/store/genesisStore';
import { useTruthLayer } from '@hooks/useTruthLayer';
import { describeSystemStatus } from '@ui/systemStatus';

function truncateAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function TopBar() {
  const lang = useLanguage();
  const live = useLiveTrading();
  const { truth } = useTruthLayer();
  const systemStatus = describeSystemStatus(truth);
  const activeAgents = useActiveAgents();
  const onboardingAgents = useOnboardingAgents();
  const wallet = useWallet();
  const totalAgents = activeAgents.length + onboardingAgents.length;
  const [livePulse, setLivePulse] = useState(true);

  useEffect(() => {
    const id = window.setInterval(() => setLivePulse((v) => !v), 1_500);
    return () => window.clearInterval(id);
  }, []);

  const capitalPnl = live.netWorth - live.startingCapital;
  const pnlColor = capitalPnl >= 0 ? '#00ff9c' : '#ff4757';
  const capitalColor = live.online && live.netWorth >= live.startingCapital ? '#00ff9c' : live.online ? '#ff4757' : '#71717a';
  const capitalLabel = live.futuresMode ? (lang === 'es' ? 'Equidad fut' : 'Fut equity') : (lang === 'es' ? 'Neto' : 'Net');
  const pnlLabel = live.futuresMode ? 'P&L fut' : 'P&L cap';
  const marginLabel = live.futuresMode ? (lang === 'es' ? 'Margen fut' : 'Fut margin') : (lang === 'es' ? 'Margen' : 'Margin');
  const openLabel = live.futuresMode ? (lang === 'es' ? 'Fut abiertas' : 'Fut open') : (lang === 'es' ? 'Abiertas' : 'Open');
  const statusColor = systemStatus.tone === 'live'
    ? '#00ff9c'
    : systemStatus.tone === 'warn'
      ? '#fbbf24'
      : '#ff4757';

  return (
    <div className="shrink-0 h-8 bg-carbon-200 border-b border-trim flex items-center px-4 gap-4 font-mono text-[10px] uppercase tracking-wider overflow-hidden">
      <span className="text-zinc-400 shrink-0">Genesis HQ</span>
      <span className="text-zinc-700">|</span>
      {live.online ? (
        <>
          <span className="text-zinc-500 shrink-0">
            {capitalLabel}:{' '}
            <span style={{ color: capitalColor }}>
              ${live.netWorth.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </span>
          <span className="text-zinc-700">|</span>
          <span className="text-zinc-500 shrink-0">
            {pnlLabel}:{' '}
            <span style={{ color: pnlColor }}>
              {capitalPnl >= 0 ? '+' : ''}${capitalPnl.toFixed(2)}
            </span>
          </span>
          <span className="text-zinc-700">|</span>
          <span className="text-zinc-500 shrink-0">
            {lang === 'es' ? 'Disponible' : 'Avail'}:{' '}
            <span className="text-zinc-200">${live.available.toFixed(2)}</span>
          </span>
          <span className="text-zinc-700">|</span>
          <span className="text-zinc-500 shrink-0">
            {marginLabel}:{' '}
            <span className="text-amber-300">${live.inTrades.toFixed(2)}</span>
          </span>
          <span className="text-zinc-700">|</span>
          <span className="text-zinc-500 shrink-0">
            {openLabel}:{' '}
            <span className="text-zinc-200">{live.openTrades.length}</span>
          </span>
        </>
      ) : (
        <span className="shrink-0" style={{ color: statusColor }}>
          {systemStatus.label[lang]}
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
        style={{ color: systemStatus.tone === 'live' ? (livePulse ? '#00ff9c' : '#4a5568') : statusColor }}
        title={systemStatus.detail[lang]}
      >
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-current" />
        {systemStatus.tone === 'live' ? 'LIVE' : systemStatus.tone === 'warn' ? 'WARN' : 'OFFLINE'}
      </span>
    </div>
  );
}
