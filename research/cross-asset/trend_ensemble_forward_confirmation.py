from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pandas as pd
import yfinance as yf

import trend_ensemble_v1 as frozen

FORWARD_START = pd.Timestamp("2022-03-07")
END = "2026-09-07"
OUT = Path(__file__).resolve().parent / "trend-ensemble-forward-output"
OUT.mkdir(parents=True, exist_ok=True)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def download_adjusted_close(ticker: str) -> pd.Series:
    raw = yf.download(
        ticker,
        start=frozen.START,
        end=END,
        interval="1d",
        auto_adjust=True,
        progress=False,
    )
    if raw is None or raw.empty:
        raise RuntimeError(f"{ticker}: empty yfinance response")
    close = raw["Close"]
    if isinstance(close, pd.DataFrame):
        if close.shape[1] != 1:
            raise RuntimeError(f"{ticker}: ambiguous Close columns")
        close = close.iloc[:, 0]
    s = pd.Series(
        pd.to_numeric(close, errors="coerce").values,
        index=pd.to_datetime(close.index),
        name=ticker,
    ).dropna().sort_index()
    path = OUT / f"{ticker}.csv"
    pd.DataFrame({"Date": s.index, "Close": s.values}).to_csv(
        path, index=False, date_format="%Y-%m-%d"
    )
    print(
        f"DATA_OK ticker={ticker} rows={len(s)} start={s.index[0].date()} "
        f"end={s.index[-1].date()} sha256={sha256(path)}"
    )
    return s


def main() -> None:
    frozen_file = Path(frozen.__file__).resolve()
    print("=== GENESIS FROZEN TREND ENSEMBLE FORWARD CONFIRMATION ===")
    print(f"FROZEN_ENGINE_FILE_SHA256 {sha256(frozen_file)}")
    print("FROZEN_PARAMS no_changes=true")
    print(
        f"PARAMS horizons={frozen.HORIZONS} rebalance={frozen.REBALANCE_DAYS} "
        f"vol_lookback={frozen.VOL_LOOKBACK} target_asset_vol={frozen.TARGET_ASSET_VOL} "
        f"max_exposure={frozen.MAX_EXPOSURE} cost_bps={frozen.COST_BPS}"
    )
    print(f"EVIDENCE_GATES {frozen.GATES}")
    print("SELECTION_DISCLOSURE candidate_selected_after_prior_family_screening=true")
    print("INTERPRETATION_POLICY forward_confirmation_only_not_capital_authority=true")
    print("LEGACY_HOLDOUT_POLICY 2018_2022_metrics_remain_sealed=true")
    print("AUTHORITY RESEARCH_ONLY liveOrders=false capitalEligible=false")

    data = {ticker: download_adjusted_close(ticker) for ticker in frozen.UNIVERSE}
    prices = pd.concat(data, axis=1).dropna()
    print(
        f"COMMON_WINDOW assets={len(prices.columns)} rows={len(prices)} "
        f"start={prices.index[0].date()} end={prices.index[-1].date()}"
    )

    pnl, weights, diag = frozen.build_portfolio(prices)
    confirmation = pnl.loc[pnl.index >= FORWARD_START]
    if len(confirmation) < 1000:
        raise RuntimeError(f"forward sample too short: {len(confirmation)} daily rows")

    print(
        f"FORWARD_WINDOW start={confirmation.index[0].date()} end={confirmation.index[-1].date()} "
        f"days={len(confirmation)}"
    )
    print(
        f"PORTFOLIO_DIAGNOSTICS avg_gross_exposure={diag.loc[confirmation.index, 'turnover'].shape[0] and weights.loc[confirmation.index].abs().sum(axis=1).mean():.6f} "
        f"avg_net_exposure={weights.loc[confirmation.index].sum(axis=1).mean():.6f} "
        f"avg_daily_turnover={diag.loc[confirmation.index, 'turnover'].mean():.6f} "
        f"total_cost_pct={diag.loc[confirmation.index, 'costs'].sum()*100:.4f}"
    )

    result = frozen.evaluate_slice(confirmation)
    frozen.print_result("FORWARD_2022_2026", result)
    passed = frozen.gate_pass(result)
    report = {
        "engine": "trend_ensemble_v1_forward_confirmation",
        "frozen_engine_sha256": sha256(frozen_file),
        "frozen_params": {
            "horizons": frozen.HORIZONS,
            "rebalance_days": frozen.REBALANCE_DAYS,
            "vol_lookback": frozen.VOL_LOOKBACK,
            "target_asset_vol": frozen.TARGET_ASSET_VOL,
            "max_exposure": frozen.MAX_EXPOSURE,
            "cost_bps": frozen.COST_BPS,
        },
        "gates": frozen.GATES,
        "selection_disclosure": "candidate_selected_after_prior_family_screening",
        "legacy_holdout_2018_2022": "SEALED",
        "forward_period": {
            "start": str(confirmation.index[0].date()),
            "end": str(confirmation.index[-1].date()),
            "n_days": len(confirmation),
        },
        "forward_result": result,
        "forward_verdict": "FORWARD_PASS" if passed else "NO_GO",
        "capitalEligible": False,
        "liveOrders": False,
    }
    print(
        f"FORWARD_VERDICT {report['forward_verdict']} legacy_holdout_sealed=true "
        f"capitalEligible=false liveOrders=false"
    )
    path = OUT / "trend_ensemble_forward_confirmation.json"
    path.write_text(json.dumps(report, indent=2, default=str))
    print(f"REPORT {path}")


if __name__ == "__main__":
    main()
