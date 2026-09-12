import { useEffect, useState } from 'react';
import { useConnect, useDisconnect, useAccount, useChainId, useSwitchChain } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { mainnet, polygon, base } from 'wagmi/chains';
import { useT, useLanguage } from '@core/i18n/languageStore';
import { actions, useWallet } from '@core/store/genesisStore';
import { getNativeBalance, getUsdcBalance, chainLabel } from '@services/walletOnchain';
import SolanaWalletPanel from '@ui/SolanaWalletPanel';

type ChainTab = 'solana' | 'evm';

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
  const [tab, setTab] = useState<ChainTab>('solana');

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
      const id = window.setTimeout(() => {
        setNativeBal('—');
        setUsdcBal('—');
        setLoadingBal(false);
      }, 0);
      return () => window.clearTimeout(id);
    }

    let canceled = false;

    const loadBalances = async () => {
      setLoadingBal(true);
      try {
        const [native, usdc] = await Promise.all([
          getNativeBalance(address as `0x${string}`, chainId),
          getUsdcBalance(address as `0x${string}`, chainId),
        ]);
        if (!canceled) {
          setNativeBal(native);
          setUsdcBal(usdc);
        }
      } finally {
        if (!canceled) {
          setLoadingBal(false);
        }
      }
    };

    loadBalances();
    return () => {
      canceled = true;
    };
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
          <div className="mt-3 border border-amber-400/30 bg-amber-500/5 px-4 py-3 font-mono text-[11px] text-amber-200 leading-relaxed">
            {lang === 'es'
              ? 'Estado actual: esta wallet es solo lectura on-chain. Genesis todavia no ejecuta trades desde esta wallet ni mueve fondos del usuario.'
              : 'Current state: this wallet is read-only on-chain. Genesis does not trade from this wallet or move user funds yet.'}
          </div>
        </header>

        {/* Chain tabs — Solana first, EVM preserved, more networks pluggable */}
        <div className="flex items-center gap-1 border-b border-zinc-800">
          <button
            type="button"
            onClick={() => setTab('solana')}
            className={`font-mono text-[11px] uppercase tracking-wider px-4 py-2 border-b-2 -mb-px ${tab === 'solana' ? 'border-[#00ff9c] text-[#00ff9c]' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}
          >
            ◎ Solana
          </button>
          <button
            type="button"
            onClick={() => setTab('evm')}
            className={`font-mono text-[11px] uppercase tracking-wider px-4 py-2 border-b-2 -mb-px ${tab === 'evm' ? 'border-[#4ea1ff] text-[#4ea1ff]' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}
          >
            ⟠ EVM · ETH / Polygon / Base
          </button>
          <span className="font-mono text-[10px] text-zinc-600 px-3 py-2 cursor-not-allowed" title={lang === 'es' ? 'Arquitectura lista para más cadenas' : 'Architecture ready for more chains'}>
            + BTC · {lang === 'es' ? 'más redes pronto' : 'more networks soon'}
          </span>
        </div>

        {tab === 'solana' && <SolanaWalletPanel />}

        {tab === 'evm' && (
        <>
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
          <section className="gx-card p-5 space-y-3">
            <div className="gx-label mb-2">
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
            <section className="gx-card">
              <header className="gx-card-head gx-card-title">
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
                        { id: base.id, label: 'Base' },
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

            <div className="border border-zinc-700 bg-carbon-200 px-4 py-3 font-mono text-[11px] text-zinc-400 leading-relaxed">
              {lang === 'es'
                ? 'Wallet conectada — saldo on-chain en lectura. El trading lo ejecuta el agente backend (SQLite), no esta wallet aún.'
                : 'Wallet connected — on-chain balance read-only. Trading is executed by the backend agent (SQLite), not this wallet yet.'}
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
        </>
        )}
      </div>
    </main>
  );
}
