# Solana edge matrix v1

- Branch: `feat/solana-edge-matrix-v1`
- Adds a free-tier SHADOW notional ladder for `USDC → SOL → USDC`.
- Reports quote-positive, net-positive, economically qualified, simulated, and paper-captured counts separately.
- Ranks candidates by net PnL and exposes the observed break-even quote edge for every size.
- Does not change risk parameters, signing, transaction submission, Futures, UI, or `LIVE_LOCKED`.
- The existing observation workflow now runs and publishes the matrix while preserving the original snapshot contract; manual runs check out the selected branch.
- Verification: 15 focused tests passed; `npm run typecheck` passed; `npm run build` passed.
- Live workspace probe: all six Jupiter requests timed out in the restricted workspace, so the result is correctly labeled `DATA_UNAVAILABLE` rather than claiming that no edge exists.
- Note: `docs/CHANGELOG_AI.md` is non-UTF-8 binary data on this branch, so the required change record is stored here rather than corrupting that file.
