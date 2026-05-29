import { useEffect, useState } from 'react';
import { useConnect, useDisconnect, useAccount, useChainId, useSwitchChain } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { mainnet, polygon, base } from 'wagmi/chains';
import { useT, useLanguage } from '../i18n/languageStore';
import { actions, useWallet } from '../state/genesisStore';
import { getNativeBalance, getUsdcBalance, chainLabel } from '../lib/walletOnchain';

function truncateAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function WalletView() {
  const t = useT();
  const lang = useLanguage();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const storedWallet = useWallet();

  const chain = chainLabel(chainId);
  const [nativeBal, setNativeBal] = useState<string>('—');
  const [usdcBal, setUsdcBal] = useState<string>('—');
  const [loadingBal, setLoadingBal] = useState(false);

  // Sync wagmi state → genesis store
  useEffect(() => {
    if (isConnected && address) {
      actions.setWallet(address);
    } else {
      actions.setWallet(null);
    }
  }, [isConnected, address]);

  // Fetch balances when connected or chain changes
  useEffect(() => {
    if (!isConnected || !address) {
      setNativeBal('—');
      setUsdcBal('—');
      return;
    }
    setLoadingBal(true);
    Promise.all([
      getNativeBalance(address as `0x${string}`, chainId),
      getUsdcBalance(address as `0x${string}`, chainId),
    ]).then(([native, usdc]) => {
      setNativeBal(native);
      setUsdcBal(usdc);
    }).finally(() => setLoadingBal(false));
  }, [isConnected, address, chainId]);

  return (
    <main className="flex-1 min-w-0 min-h-0 overflow-y-auto px-8 py-8 bg-carbon-300">
      <div className="max-w-2xl mx-auto space-y-6">
        <header>
          <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-500 mb-1">
            Genesis HQ
          </div>
          <h1 className="font-mono text-2xl text-zinc-100">{t('wallet.title')}</h1>
          <p className="font-mono text-[12px] text-zinc-500 mt-1">{t('wallet.intro')}</p>
        </header>

        {/* Status banner */}
        <div
          className="border px-4 py-3 font-mono text-[12px] flex items-center gap-3"
          style={{
            borderColor: isConnected ? 'rgba(0,255,156,0.4)' : 'rgba(113,113,122,0.4)',
            background: isConnected ? 'rgba(0,255,156,0.05)' : 'transparent',
            color: isConnected ? '#00ff9c' : '#71717a',
          }}
        >
          <span
            className="inline-block w-2 h-2 rounded-full shrink-0"
            style={{ background: isConnected ? '#00ff9c' : '#4a5568' }}
          />
          {isConnected ? t('wallet.connected') : t('wallet.disconnected')}
          {isConnected && address && (
            <span className="font-mono text-[10px] text-zinc-400 ml-auto">{truncateAddress(address)}</span>
          )}
        </div>

        {/* Connect buttons */}
        {!isConnected && (
          <section className="border border-trim bg-carbon-200 p-5 space-y-3">
            <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500 mb-2">
              {lang === 'es' ? 'Conectar wallet' : 'Connect wallet'}
            </div>
            <button
              type="button"
              onClick={() => connect({ connector: injected() })}
              className="w-full font-mono text-[12px] uppercase tracking-wider px-4 py-3 border border-zinc-600 text-zinc-200 hover:border-emerald-400/60 hover:text-emerald-300 hover:bg-emerald-500/5 text-left flex items-center gap-3"
            >
              <span className="text-lg">🦊</span>
              <span>{t('wallet.connect.metamask')}</span>
              <span className="ml-auto text-zinc-500 text-[10px]">injected</span>
            </button>
          </section>
        )}

        {/* Connected state */}
        {isConnected && address && (
          <>
            <section className="border border-trim bg-carbon-200">
              <header className="px-4 py-2.5 border-b border-trim font-mono text-[11px] uppercase tracking-wider text-zinc-300">
                {lang === 'es' ? 'Detalles de wallet' : 'Wallet details'}
              </header>
              <div className="divide-y divide-trim">
                <div className="px-4 py-3 flex items-center justify-between">
                  <span className="font-mono text-[11px] text-zinc-500 uppercase tracking-wider">
                    {lang === 'es' ? 'Dirección' : 'Address'}
                  </span>
                  <span className="font-mono text-[12px] text-zinc-100">{truncateAddress(address)}</span>
                </div>
                <div className="px-4 py-3 flex items-start justify-between gap-3">
                  <span className="font-mono text-[11px] text-zinc-500 uppercase tracking-wider shrink-0">{t('wallet.network')}</span>
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    <span
                      className="font-mono text-[12px] px-2 py-0.5 border"
                      style={{ color: chain.color, borderColor: `${chain.color}44` }}
                    >
                      {chain.name}
                    </span>
                    <div className="flex gap-1">
                      {[
                        { id: polygon.id, label: 'Polygon' },
                        { id: mainnet.id, label: 'Ethereum' },
                        { id: base.id,    label: 'Base' },
                      ].filter((c) => c.id !== chainId).map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => switchChain?.({ chainId: c.id })}
                          className="font-mono text-[9px] px-1.5 py-0.5 border border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-500"
                        >
                          → {c.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="px-4 py-3 flex items-center justify-between">
                  <span className="font-mono text-[11px] text-zinc-500 uppercase tracking-wider">
                    {chain.symbol}
                  </span>
                  <span className="font-mono text-[12px] text-zinc-100">
                    {loadingBal ? '…' : `${nativeBal} ${chain.symbol}`}
                  </span>
                </div>
                <div className="px-4 py-3 flex items-center justify-between">
                  <span className="font-mono text-[11px] text-zinc-500 uppercase tracking-wider">{t('wallet.balance.usdc')}</span>
                  <span className="font-mono text-[12px] text-zinc-100">
                    {loadingBal ? '…' : `${usdcBal} USDC`}
                  </span>
                </div>
              </div>
            </section>

            <div className="border border-emerald-400/40 bg-emerald-500/5 px-4 py-3 font-mono text-[12px] text-emerald-200 flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
              {t('wallet.realMode')}
            </div>

            <button
              type="button"
              onClick={() => { disconnect(); actions.setWallet(null); }}
              className="font-mono text-[11px] uppercase tracking-wider px-4 py-2 border border-red-400/40 text-red-300 hover:bg-red-400/10"
            >
              {t('wallet.disconnect')}
            </button>
          </>
        )}

        {/* Note */}
        <div className="border border-zinc-700 bg-carbon-200 px-4 py-3 font-mono text-[11px] text-zinc-500 leading-relaxed">
          {t('wallet.note')}
        </div>

        {/* Stored wallet from genesis store (persisted) */}
        {storedWallet.connected && !isConnected && (
          <div className="border border-zinc-700 bg-carbon-200 px-4 py-3 font-mono text-[11px] text-zinc-500">
            {lang === 'es' ? 'Última wallet conectada' : 'Last connected wallet'}:{' '}
            <span className="text-zinc-300">{storedWallet.address ? truncateAddress(storedWallet.address) : '—'}</span>
          </div>
        )}
      </div>
    </main>
  );
}
