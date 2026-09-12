// solanaWallet — read-only Solana wallet connect + exchange-style portfolio.
//
// Connects Phantom/Solflare via their injected providers (no heavy SDK), reads
// SOL + every SPL / Token-2022 holding through public JSON-RPC, enriches with
// token metadata and USD prices, and returns a portfolio shaped like what an
// exchange shows. STRICTLY read-only: this module never builds, signs, or
// sends a transaction — connect() only asks the wallet for its public key.
//
// Multi-chain by design: this is the Solana implementation of the portfolio
// contract; EVM lives in walletOnchain.ts, and new chains plug in beside them.

const RPCS = [
  'https://api.mainnet-beta.solana.com',
  'https://solana-rpc.publicnode.com',
];

const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnwqK9F91TS';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

// ─── Injected wallet providers ────────────────────────────────────────────────

export interface SolProvider {
  isPhantom?: boolean;
  publicKey: { toString(): string } | null;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toString(): string } }>;
  disconnect(): Promise<void>;
}

interface SolWindow {
  phantom?: { solana?: SolProvider };
  solana?: SolProvider;
  solflare?: SolProvider & { isSolflare?: boolean };
}

export interface DetectedWallet {
  name: 'Phantom' | 'Solflare' | 'Solana Wallet';
  icon: string;
  provider: SolProvider;
}

export function detectSolanaWallets(): DetectedWallet[] {
  const w = window as unknown as SolWindow;
  const out: DetectedWallet[] = [];
  if (w.phantom?.solana?.isPhantom) out.push({ name: 'Phantom', icon: '👻', provider: w.phantom.solana });
  if (w.solflare?.isSolflare) out.push({ name: 'Solflare', icon: '🔥', provider: w.solflare });
  if (!out.length && w.solana) out.push({ name: 'Solana Wallet', icon: '◎', provider: w.solana });
  return out;
}

export async function connectWallet(p: SolProvider, onlyIfTrusted = false): Promise<string | null> {
  try {
    const res = await p.connect(onlyIfTrusted ? { onlyIfTrusted: true } : undefined);
    return res?.publicKey?.toString() ?? p.publicKey?.toString() ?? null;
  } catch {
    return null; // user rejected / not previously trusted
  }
}

// ─── JSON-RPC with endpoint fallback ─────────────────────────────────────────

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  let lastErr: unknown = null;
  for (const url of RPCS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(9000),
      });
      if (!res.ok) throw new Error(`rpc_${res.status}`);
      const body = await res.json();
      if (body.error) throw new Error(body.error.message ?? 'rpc_error');
      return body.result as T;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('rpc_unreachable');
}

// ─── Token metadata ──────────────────────────────────────────────────────────

interface TokenMeta { symbol: string; name: string; logoURI?: string }

// Majors resolved instantly with zero network calls.
const KNOWN_TOKENS: Record<string, TokenMeta> = {
  [SOL_MINT]: { symbol: 'SOL', name: 'Solana' },
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': { symbol: 'USDC', name: 'USD Coin' },
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': { symbol: 'USDT', name: 'Tether USD' },
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': { symbol: 'BONK', name: 'Bonk' },
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN': { symbol: 'JUP', name: 'Jupiter' },
  'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm': { symbol: 'WIF', name: 'dogwifhat' },
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So': { symbol: 'mSOL', name: 'Marinade SOL' },
  'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn': { symbol: 'JitoSOL', name: 'Jito Staked SOL' },
  '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R': { symbol: 'RAY', name: 'Raydium' },
  'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3': { symbol: 'PYTH', name: 'Pyth Network' },
  '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr': { symbol: 'POPCAT', name: 'Popcat' },
};

const META_CACHE_KEY = 'genesis.sol.tokenmeta.v1';

function readMetaCache(): Record<string, TokenMeta> {
  try {
    const raw = localStorage.getItem(META_CACHE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, TokenMeta>) : {};
  } catch {
    return {};
  }
}

// Resolve unknown mints via Jupiter's token list, caching only the mints the
// user actually holds. Fully optional — failures leave the mint truncated.
async function enrichUnknownMints(mints: string[]): Promise<Record<string, TokenMeta>> {
  const cache = readMetaCache();
  const missing = mints.filter((m) => !KNOWN_TOKENS[m] && !cache[m]);
  if (!missing.length) return cache;
  try {
    const res = await fetch('https://token.jup.ag/strict', { signal: AbortSignal.timeout(12000) });
    if (!res.ok) return cache;
    const list = (await res.json()) as Array<{ address: string; symbol: string; name: string; logoURI?: string }>;
    for (const t of list) {
      if (missing.includes(t.address)) {
        cache[t.address] = { symbol: t.symbol, name: t.name, logoURI: t.logoURI };
      }
    }
    try { localStorage.setItem(META_CACHE_KEY, JSON.stringify(cache)); } catch { /* full — fine */ }
  } catch { /* offline / blocked — mints stay truncated */ }
  return cache;
}

// ─── Prices (best-effort, graceful) ──────────────────────────────────────────

async function fetchPrices(mints: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  // Jupiter lite price API — no key, CORS-open.
  try {
    const ids = mints.slice(0, 50).join(',');
    const res = await fetch(`https://lite-api.jup.ag/price/v2?ids=${ids}`, { signal: AbortSignal.timeout(9000) });
    if (res.ok) {
      const body = (await res.json()) as { data?: Record<string, { price?: string | number } | null> };
      for (const [mint, v] of Object.entries(body.data ?? {})) {
        const p = v?.price != null ? Number(v.price) : NaN;
        if (Number.isFinite(p) && p > 0) out[mint] = p;
      }
    }
  } catch { /* price source down — values show as — */ }
  // SOL fallback via CoinGecko if Jupiter missed it.
  if (out[SOL_MINT] == null) {
    try {
      const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', { signal: AbortSignal.timeout(9000) });
      if (res.ok) {
        const body = (await res.json()) as { solana?: { usd?: number } };
        if (body.solana?.usd) out[SOL_MINT] = body.solana.usd;
      }
    } catch { /* fine */ }
  }
  return out;
}

// ─── Portfolio ───────────────────────────────────────────────────────────────

export interface SolTokenHolding {
  mint: string;
  symbol: string;
  name: string;
  uiAmount: number;
  decimals: number;
  priceUsd: number | null;
  valueUsd: number | null;
  logoURI?: string;
}

export interface SolPortfolio {
  address: string;
  sol: number;
  solPriceUsd: number | null;
  solValueUsd: number | null;
  totalUsd: number | null;
  tokens: SolTokenHolding[];
  fetchedAt: string;
}

interface ParsedTokenAccount {
  account: { data: { parsed: { info: { mint: string; tokenAmount: { uiAmount: number | null; decimals: number } } } } };
}

export async function fetchSolPortfolio(address: string): Promise<SolPortfolio> {
  const [balRes, splRes, t22Res] = await Promise.all([
    rpc<{ value: number }>('getBalance', [address]),
    rpc<{ value: ParsedTokenAccount[] }>('getParsedTokenAccountsByOwner', [
      address, { programId: TOKEN_PROGRAM }, { encoding: 'jsonParsed' },
    ]),
    rpc<{ value: ParsedTokenAccount[] }>('getParsedTokenAccountsByOwner', [
      address, { programId: TOKEN_2022_PROGRAM }, { encoding: 'jsonParsed' },
    ]).catch(() => ({ value: [] as ParsedTokenAccount[] })),
  ]);

  const sol = (balRes?.value ?? 0) / 1e9;

  const raw = [...(splRes?.value ?? []), ...(t22Res?.value ?? [])]
    .map((a) => a.account.data.parsed.info)
    .filter((i) => (i.tokenAmount.uiAmount ?? 0) > 0);

  const mints = raw.map((i) => i.mint);
  const [meta, prices] = await Promise.all([
    enrichUnknownMints(mints),
    fetchPrices([SOL_MINT, ...mints]),
  ]);

  const tokens: SolTokenHolding[] = raw.map((i) => {
    const m = KNOWN_TOKENS[i.mint] ?? meta[i.mint];
    const uiAmount = i.tokenAmount.uiAmount ?? 0;
    const priceUsd = prices[i.mint] ?? null;
    return {
      mint: i.mint,
      symbol: m?.symbol ?? `${i.mint.slice(0, 4)}…${i.mint.slice(-4)}`,
      name: m?.name ?? 'Token desconocido',
      uiAmount,
      decimals: i.tokenAmount.decimals,
      priceUsd,
      valueUsd: priceUsd != null ? uiAmount * priceUsd : null,
      logoURI: m?.logoURI,
    };
  }).sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1));

  const solPriceUsd = prices[SOL_MINT] ?? null;
  const solValueUsd = solPriceUsd != null ? sol * solPriceUsd : null;
  const priced = tokens.filter((t) => t.valueUsd != null);
  const totalUsd = solValueUsd != null || priced.length
    ? (solValueUsd ?? 0) + priced.reduce((s, t) => s + (t.valueUsd ?? 0), 0)
    : null;

  return { address, sol, solPriceUsd, solValueUsd, totalUsd, tokens, fetchedAt: new Date().toISOString() };
}
