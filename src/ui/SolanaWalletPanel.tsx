// SolanaWalletPanel — exchange-style read-only portfolio for a connected
// Solana wallet: total balance hero, SOL row, and every SPL/Token-2022
// holding with amount, price and USD value. Never signs anything.

import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '@core/i18n/languageStore';
import { actions } from '@core/store/genesisStore';
import {
  detectSolanaWallets,
  connectWallet,
  fetchSolPortfolio,
  type DetectedWallet,
  type SolPortfolio,
} from '@services/solanaWallet';
import { auditLog, readAuditLog, exportAuditLog, WALLET_CAPABILITIES, type WalletAuditEvent } from '@services/walletAudit';

function short(addr: string) {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function usd(v: number | null, digits = 2): string {
  if (v == null) return '—';
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function amount(v: number): string {
  if (v >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (v >= 1) return v.toLocaleString('en-US', { maximumFractionDigits: 4 });
  return v.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

function TokenIcon({ symbol, logoURI }: { symbol: string; logoURI?: string }) {
  const [broken, setBroken] = useState(false);
  if (logoURI && !broken) {
    return (
      <img
        src={logoURI}
        alt=""
        className="w-7 h-7 rounded-full bg-zinc-800 shrink-0"
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <span className="w-7 h-7 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center font-mono text-[10px] text-zinc-300 shrink-0">
      {symbol.slice(0, 2).toUpperCase()}
    </span>
  );
}

export default function SolanaWalletPanel() {
  const lang = useLanguage();
  const es = lang === 'es';
  const [wallets, setWallets] = useState<DetectedWallet[]>([]);
  const [address, setAddress] = useState<string | null>(null);
  const [portfolio, setPortfolio] = useState<SolPortfolio | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);

  const [audit, setAudit] = useState<WalletAuditEvent[]>(() => readAuditLog());
  const [showAudit, setShowAudit] = useState(false);

  const track = useCallback((kind: WalletAuditEvent['kind'], detail: string) => {
    auditLog(kind, detail);
    setAudit(readAuditLog());
  }, []);

  const load = useCallback(async (addr: string) => {
    setLoading(true);
    setError(null);
    try {
      const p = await fetchSolPortfolio(addr);
      setPortfolio(p);
      track('read_portfolio', `${short(addr)} · SOL + ${p.tokens.length} tokens`);
    } catch {
      track('rpc_error', short(addr));
      setError(es
        ? 'No se pudo leer la wallet (RPC saturado) — reintenta en unos segundos.'
        : 'Could not read the wallet (RPC busy) — retry in a few seconds.');
    } finally {
      setLoading(false);
    }
  }, [es, track]);

  // Detect installed wallets + silent reconnect if previously trusted.
  // Deferred out of the effect body so no setState fires during commit.
  useEffect(() => {
    const id = setTimeout(async () => {
      const found = detectSolanaWallets();
      setWallets(found);
      for (const w of found) {
        const addr = await connectWallet(w.provider, true);
        if (addr) {
          setAddress(addr);
          actions.setWallet(addr);
          track('reconnect_trusted', `${w.name} · ${short(addr)}`);
          void load(addr);
          break;
        }
      }
    }, 0);
    return () => clearTimeout(id);
  }, [load, track]);

  const handleConnect = async (w: DetectedWallet) => {
    setConnecting(w.name);
    try {
      const addr = await connectWallet(w.provider);
      if (addr) {
        setAddress(addr);
        actions.setWallet(addr);
        track('connect', `${w.name} · ${short(addr)}`);
        void load(addr);
      }
    } finally {
      setConnecting(null);
    }
  };

  const handleDisconnect = async () => {
    for (const w of wallets) {
      try { await w.provider.disconnect(); } catch { /* already disconnected */ }
    }
    if (address) track('disconnect', short(address));
    setAddress(null);
    setPortfolio(null);
    actions.setWallet(null);
  };

  // ── Not connected ──
  if (!address) {
    return (
      <div className="space-y-4">
        {wallets.length === 0 ? (
          <div className="gx-card p-5 font-mono text-[12px] text-zinc-400 leading-relaxed">
            {es
              ? 'No se detectó ninguna wallet Solana. Instala Phantom o Solflare (extensión o app) y recarga.'
              : 'No Solana wallet detected. Install Phantom or Solflare (extension or app) and reload.'}
            <div className="mt-3 flex gap-2">
              <a href="https://phantom.com" target="_blank" rel="noreferrer" className="font-mono text-[11px] px-3 py-1.5 border border-zinc-600 text-zinc-300 hover:border-[#ab9ff2] hover:text-[#ab9ff2]">👻 Phantom</a>
              <a href="https://solflare.com" target="_blank" rel="noreferrer" className="font-mono text-[11px] px-3 py-1.5 border border-zinc-600 text-zinc-300 hover:border-[#ffc10b] hover:text-[#ffc10b]">🔥 Solflare</a>
            </div>
          </div>
        ) : (
          <section className="gx-card p-5 space-y-3">
            <div className="gx-label mb-2">{es ? 'Conectar wallet Solana' : 'Connect Solana wallet'}</div>
            {wallets.map((w) => (
              <button
                key={w.name}
                type="button"
                onClick={() => handleConnect(w)}
                disabled={connecting != null}
                className="w-full font-mono text-[12px] uppercase tracking-wider px-4 py-3 border border-zinc-600 text-zinc-200 hover:border-[#00ff9c66] hover:text-[#00ff9c] hover:bg-[#00ff9c0d] text-left flex items-center gap-3 disabled:opacity-50"
              >
                <span className="text-lg">{w.icon}</span>
                <span>{connecting === w.name ? (es ? 'Conectando…' : 'Connecting…') : w.name}</span>
                <span className="ml-auto text-zinc-500 text-[10px]">{es ? 'solo lectura' : 'read-only'}</span>
              </button>
            ))}
          </section>
        )}
        <div className="border border-zinc-700 bg-carbon-200 px-4 py-3 font-mono text-[11px] text-zinc-500 leading-relaxed">
          {es
            ? 'Conexión de solo lectura: Genesis solo pide tu dirección pública. Nunca construye, firma ni envía transacciones desde tu wallet.'
            : 'Read-only connection: Genesis only requests your public address. It never builds, signs, or sends transactions from your wallet.'}
        </div>
      </div>
    );
  }

  // ── Connected: exchange-style portfolio ──
  const rows = portfolio ? [
    {
      mint: 'SOL',
      symbol: 'SOL',
      name: 'Solana',
      uiAmount: portfolio.sol,
      priceUsd: portfolio.solPriceUsd,
      valueUsd: portfolio.solValueUsd,
      logoURI: undefined as string | undefined,
    },
    ...portfolio.tokens,
  ] : [];

  return (
    <div className="space-y-4">
      {/* Header: address + actions */}
      <div className="flex items-center gap-3 flex-wrap border border-[#00ff9c44] bg-[#00ff9c08] px-4 py-3">
        <span className="inline-block w-2 h-2 rounded-full bg-[#00ff9c]" />
        <span className="font-mono text-[12px] text-[#00ff9c]">{es ? 'Solana conectada' : 'Solana connected'}</span>
        <button
          type="button"
          onClick={() => { void navigator.clipboard?.writeText(address); }}
          title={address}
          className="font-mono text-[11px] text-zinc-300 border border-zinc-700 px-2 py-0.5 hover:border-zinc-500"
        >
          {short(address)} ⧉
        </button>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={() => void load(address)}
            disabled={loading}
            className="font-mono text-[10px] uppercase px-3 py-1 border border-zinc-600 text-zinc-300 hover:border-[#4ea1ff88] hover:text-[#4ea1ff] disabled:opacity-50"
          >
            {loading ? '…' : es ? 'Actualizar' : 'Refresh'}
          </button>
          <button
            type="button"
            onClick={() => void handleDisconnect()}
            className="font-mono text-[10px] uppercase px-3 py-1 border border-red-400/40 text-red-300 hover:bg-red-400/10"
          >
            {es ? 'Desconectar' : 'Disconnect'}
          </button>
        </div>
      </div>

      {error && (
        <div className="border border-amber-400/40 bg-amber-400/5 px-4 py-2 font-mono text-[11px] text-amber-300">{error}</div>
      )}

      {/* Total balance hero */}
      <div className="gx-card p-5">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">
          {es ? 'Balance total estimado' : 'Estimated total balance'}
        </div>
        <div className="font-mono text-3xl font-bold text-zinc-100 mt-1 tabular-nums">
          {loading && !portfolio ? '…' : usd(portfolio?.totalUsd ?? null)}
        </div>
        {portfolio && (
          <div className="font-mono text-[10px] text-zinc-500 mt-1">
            {portfolio.tokens.length + 1} {es ? 'activos' : 'assets'} · SOL {usd(portfolio.solPriceUsd)} ·{' '}
            {es ? 'actualizado' : 'updated'} {new Date(portfolio.fetchedAt).toLocaleTimeString()}
          </div>
        )}
      </div>

      {/* Holdings table */}
      <section className="gx-card overflow-hidden">
        <header className="gx-card-head gx-card-title flex items-center justify-between">
          <span>{es ? 'Tus activos' : 'Your assets'}</span>
          <span className="font-mono text-[9px] text-zinc-500 normal-case tracking-normal">
            {es ? 'solo lectura · on-chain' : 'read-only · on-chain'}
          </span>
        </header>
        <div className="divide-y divide-trim">
          {loading && !portfolio && (
            <div className="px-4 py-6 font-mono text-[12px] text-zinc-500">{es ? 'Leyendo la blockchain…' : 'Reading the blockchain…'}</div>
          )}
          {rows.map((t) => (
            <div key={t.mint} className="px-4 py-3 flex items-center gap-3">
              <TokenIcon symbol={t.symbol} logoURI={t.logoURI} />
              <div className="min-w-0">
                <div className="font-mono text-[12px] text-zinc-100 font-bold">{t.symbol}</div>
                <div className="font-mono text-[10px] text-zinc-500 truncate">{t.name}</div>
              </div>
              <div className="ml-auto text-right">
                <div className="font-mono text-[12px] text-zinc-100 tabular-nums">{amount(t.uiAmount)}</div>
                <div className="font-mono text-[10px] text-zinc-500 tabular-nums">
                  {t.priceUsd != null ? `@ ${usd(t.priceUsd, t.priceUsd < 0.01 ? 6 : 2)}` : es ? 'sin precio' : 'no price'}
                </div>
              </div>
              <div className="w-24 text-right font-mono text-[12px] tabular-nums shrink-0">
                <span className={t.valueUsd != null ? 'text-zinc-100 font-bold' : 'text-zinc-600'}>{usd(t.valueUsd)}</span>
              </div>
            </div>
          ))}
          {portfolio && rows.length === 1 && portfolio.sol === 0 && (
            <div className="px-4 py-4 font-mono text-[11px] text-zinc-500">
              {es ? 'Wallet vacía en mainnet — sin SOL ni tokens.' : 'Empty wallet on mainnet — no SOL or tokens.'}
            </div>
          )}
        </div>
      </section>

      {/* Auditable security — verify, don't trust */}
      <section className="gx-card overflow-hidden">
        <header className="gx-card-head gx-card-title flex items-center justify-between">
          <span>🔒 {es ? 'Seguridad auditable' : 'Auditable security'}</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowAudit((v) => !v)}
              className="font-mono text-[9px] uppercase px-2 py-0.5 border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 normal-case tracking-normal"
            >
              {showAudit ? (es ? 'ocultar registro' : 'hide log') : (es ? `ver registro (${audit.length})` : `view log (${audit.length})`)}
            </button>
            <button
              type="button"
              onClick={exportAuditLog}
              className="font-mono text-[9px] uppercase px-2 py-0.5 border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 normal-case tracking-normal"
            >
              {es ? 'exportar JSON' : 'export JSON'}
            </button>
          </div>
        </header>
        <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-trim">
          <div className="px-4 py-3">
            <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-[#00ff9c] mb-2">{es ? 'Esta app PUEDE' : 'This app CAN'}</div>
            {WALLET_CAPABILITIES.can.map((c, i) => (
              <div key={i} className="font-mono text-[11px] text-zinc-300 py-0.5">✓ {es ? c.es : c.en}</div>
            ))}
          </div>
          <div className="px-4 py-3">
            <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-red-400 mb-2">{es ? 'Esta app NO PUEDE' : 'This app CANNOT'}</div>
            {WALLET_CAPABILITIES.cannot.map((c, i) => (
              <div key={i} className="font-mono text-[11px] text-zinc-400 py-0.5">✗ {es ? c.es : c.en}</div>
            ))}
          </div>
        </div>
        {showAudit && (
          <div className="border-t border-trim max-h-48 overflow-y-auto">
            {audit.length === 0 && (
              <div className="px-4 py-3 font-mono text-[11px] text-zinc-500">{es ? 'Sin eventos aún.' : 'No events yet.'}</div>
            )}
            {[...audit].reverse().map((e, i) => (
              <div key={i} className="px-4 py-1.5 flex items-center gap-3 border-b border-trim/50 last:border-0">
                <span className="font-mono text-[9px] text-zinc-600 tabular-nums shrink-0">{new Date(e.ts).toLocaleString()}</span>
                <span className={`font-mono text-[10px] uppercase shrink-0 ${e.kind === 'rpc_error' ? 'text-amber-400' : e.kind === 'disconnect' ? 'text-red-300' : 'text-[#00ff9c]'}`}>{e.kind}</span>
                <span className="font-mono text-[10px] text-zinc-400 truncate">{e.detail}</span>
              </div>
            ))}
          </div>
        )}
        <div className="border-t border-trim px-4 py-2 font-mono text-[10px] text-zinc-500">
          {es
            ? 'El registro vive solo en tu navegador — nunca se sube a ningún servidor. Código abierto: verifica cada afirmación en el repositorio.'
            : 'The log lives only in your browser — it is never uploaded. Open source: verify every claim in the repository.'}
        </div>
      </section>
    </div>
  );
}
