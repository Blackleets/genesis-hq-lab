// feePolicy — the app's revenue model, in the open.
//
// A transparent performance fee, the same model hedge funds and copy-trading
// platforms use: a percentage of NET POSITIVE profit only. No profit, no fee.
//
// Honesty by construction:
//  - The rate and treasury address live HERE, visible in the source and UI —
//    never hidden in obfuscated code. Forks can see exactly what exists.
//  - Today (paper mode) the fee only ACCRUES as a displayed number so users
//    see what real execution would cost. Nothing is charged.
//  - When real execution ships, the fee is settled at the EXECUTION layer
//    (backend deducts at trade settlement) — NEVER by pulling from a user's
//    connected wallet, which stays strictly read-only forever.

export const PERFORMANCE_FEE_BPS = 1000; // 10.00% of net positive PnL

// Operator treasury (Solana). Set by the deployment owner; empty = accrual
// display only. Forks that deploy commercially set their own or license.
export const TREASURY_WALLET_SOL = '2V7qrcSqH59hG4BgQdZonefx27uUNyyXCfozDzi1w5zL';

export function feeRateLabel(): string {
  return `${(PERFORMANCE_FEE_BPS / 100).toFixed(2)}%`;
}

/** Fee accrued on a PnL figure — zero unless the PnL is positive. */
export function computeAccruedFeeUsd(netPnlUsd: number): number {
  if (!Number.isFinite(netPnlUsd) || netPnlUsd <= 0) return 0;
  return Math.round(netPnlUsd * (PERFORMANCE_FEE_BPS / 10_000) * 100) / 100;
}

/** What the trader keeps after the performance fee. */
export function netAfterFeeUsd(netPnlUsd: number): number {
  return Math.round((netPnlUsd - computeAccruedFeeUsd(netPnlUsd)) * 100) / 100;
}
