# Genesis Truth Ledger v2

Status: PAPER ONLY. `LIVE_OFF` remains frozen. This change is not a GO for real capital.

## Why this exists

The funding desk historically tracked collected funding and aggregate fees at top level, while adverse price movement on closed holds could remain only inside `closed[].mtmUsdt`. That made `realizedFundingUsdt - feesUsdt` an incomplete profitability number.

Truth Ledger v2 makes closed-trade economics auditable and reconstructable before ASTRA is allowed to optimize or evolve agents against P&L.

## Accounting identity

For the funding desk:

```text
realizedNetPnlUsdt = realizedFundingUsdt
                   + realizedPricePnlUsdt
                   - feesUsdt

economicPnlUsdt   = realizedNetPnlUsdt
                   + mtmUsdt

equityUsdt        = capitalUsdt
                   + economicPnlUsdt
```

`mtmUsdt` is open mark-to-market only. It is never labeled as collected or realized.

## Source-of-truth rules

1. `closed[]` is authoritative for realized price P&L.
2. A closed trade uses persisted `realizedPricePnlUsdt` when present.
3. Otherwise price P&L is reconstructed from `entryPx`, `exitPx`, `notional`, and `side`.
4. Legacy closes without `exitPx` may use their final persisted `mtmUsdt` as historical evidence rather than silently becoming zero.
5. `feesUsdt` remains the authoritative aggregate fee total. Legacy fee allocation gaps are exposed, not invented.
6. Top-level `realizedPricePnlUsdt` is a reconciled cache; it never overrides newly appended `closed[]` rows.
7. Promotion/edge scoring uses realized economic profitability, not funding-only fee coverage.
8. `LIVE_OFF=true`, `go=false`, and no real-order path are changed by this ledger.

## ASTRA prerequisite

ASTRA may later optimize research, strategies, prompts, skills, and agent policies, but its reward signal must come from this reconciled economic layer. An evolving agent must not be rewarded for a metric that can omit closed losses.

Recommended next gate before ASTRA autonomous evolution:

- Truth Ledger v2 merged and deployed.
- Paper snapshots migrate cleanly.
- At least one full open → settle → close cycle shows exact entry fee, exit fee, funding, price P&L, realized net, MTM, and equity.
- Scorecard remains fail-closed and never enables real trading.
