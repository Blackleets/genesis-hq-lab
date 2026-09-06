from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

import numpy as np
import pandas as pd
import yfinance as yf

from forex_trend_system import GATES, daily_pnl_to_trades, monte_carlo, scorecard

START = "2003-12-01"
END = "2022-03-05"
MOM_LOOKBACK = 252
SKIP_RECENT = 21
REBALANCE_DAYS = 21
VOL_LOOKBACK = 60
TOP_FRACTION = 0.30
COST_BPS = 2.0

# Fixed ex-ante universe. No post-hoc asset mining after seeing results.
UNIVERSE = {
    "SPY": "US_large_cap",
    "QQQ": "US_growth_tech",
    "IWM": "US_small_cap",
    "EFA": "developed_ex_US",
    "EEM": "emerging_markets",
    "GLD": "gold",
    "SLV": "silver",
    "IEF": "US_treasury_7_10y",
    "TLT": "US_treasury_20y_plus",
    "XLE": "US_energy_sector",
    "XLF": "US_financials_sector",
    "XLK": "US_technology_sector",
    "XLI": "US_industrials_sector",
    "XLP": "US_staples_sector",
    "XLU": "US_utilities_sector",
    "XLV": "US_healthcare_sector",
    "XLB": "US_materials_sector",
    "XLY": "US_discretionary_sector",
}

OUT = Path(__file__).resolve().parent / "cross-sectional-momentum-output"
OUT.mkdir(parents=True, exist_ok=True)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def download_adjusted_close(ticker: str) -> pd.Series:
    raw = yf.download(
        ticker,
        start=START,
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
    if len(s) < 2000:
        raise RuntimeError(f"{ticker}: insufficient history ({len(s)} rows)")
    path = OUT / f"{ticker}.csv"
    pd.DataFrame({"Date": s.index, "Close": s.values}).to_csv(
        path, index=False, date_format="%Y-%m-%d"
    )
    print(
        f"DATA_OK ticker={ticker} rows={len(s)} start={s.index[0].date()} "
        f"end={s.index[-1].date()} role={UNIVERSE[ticker]} sha256={sha256(path)}"
    )
    return s


def build_portfolio(prices: pd.DataFrame) -> tuple[pd.Series, pd.DataFrame, pd.DataFrame]:
    ret = prices.pct_change()
    # 12-1 cross-sectional momentum: return from t-252 to t-21.
    momentum = prices.shift(SKIP_RECENT) / prices.shift(MOM_LOOKBACK) - 1.0
    ann_vol = ret.rolling(VOL_LOOKBACK).std().shift(1) * math.sqrt(252.0)

    weights = pd.DataFrame(np.nan, index=prices.index, columns=prices.columns, dtype=float)
    n_assets = len(prices.columns)
    n_side = max(1, int(math.floor(n_assets * TOP_FRACTION)))

    first_eligible = max(MOM_LOOKBACK, VOL_LOOKBACK + 1)
    rebalance_count = 0
    long_short_gap = []

    for i in range(first_eligible, len(prices)):
        if (i - first_eligible) % REBALANCE_DAYS != 0:
            continue
        signal = momentum.iloc[i].replace([np.inf, -np.inf], np.nan).dropna()
        vol = ann_vol.iloc[i].replace([np.inf, -np.inf, 0.0], np.nan)
        eligible = signal.index.intersection(vol.dropna().index)
        signal = signal.loc[eligible]
        vol = vol.loc[eligible]
        if len(signal) < 8:
            continue

        n = min(n_side, max(1, len(signal) // 3))
        ranked = signal.sort_values()
        shorts = ranked.index[:n]
        longs = ranked.index[-n:]

        long_inv = 1.0 / vol.loc[longs]
        short_inv = 1.0 / vol.loc[shorts]
        long_w = 0.5 * long_inv / long_inv.sum()
        short_w = -0.5 * short_inv / short_inv.sum()

        row = pd.Series(0.0, index=prices.columns)
        row.loc[longs] = long_w
        row.loc[shorts] = short_w
        weights.iloc[i] = row
        rebalance_count += 1
        long_short_gap.append(float(signal.loc[longs].mean() - signal.loc[shorts].mean()))

    weights = weights.ffill().fillna(0.0)
    active = weights.abs().sum(axis=1) > 0
    if not active.any():
        raise RuntimeError("no active portfolio weights were created")
    first_active = active[active].index[0]
    weights = weights.loc[first_active:]
    ret = ret.reindex(weights.index).fillna(0.0)

    # Yesterday's weights earn today's return; no same-day signal look-ahead.
    gross = (weights.shift(1).fillna(0.0) * ret).sum(axis=1)
    turnover = weights.diff().abs().sum(axis=1).fillna(0.0)
    costs = turnover * (COST_BPS / 10000.0)
    net = gross - costs

    diagnostics = pd.DataFrame({
        "gross_pnl": gross,
        "costs": costs,
        "turnover": turnover,
        "net_pnl": net,
    })
    diagnostics.attrs["rebalance_count"] = rebalance_count
    diagnostics.attrs["avg_long_short_signal_gap"] = (
        float(np.mean(long_short_gap)) if long_short_gap else None
    )
    return net, weights, diagnostics


def evaluate_slice(pnl: pd.Series) -> dict:
    trades = daily_pnl_to_trades(pnl, REBALANCE_DAYS)
    sc = scorecard(trades)
    mc = monte_carlo(trades)
    mid = len(trades) // 2
    h1 = float(trades[:mid].mean() * 100) if mid else None
    h2 = float(trades[mid:].mean() * 100) if len(trades) - mid else None
    consistent = bool(h1 is not None and h2 is not None and h1 > 0 and h2 > 0)
    return {
        "score": sc,
        "monte_carlo": mc,
        "h1_mean_pct": h1,
        "h2_mean_pct": h2,
        "consistent": consistent,
    }


def gate_pass(result: dict) -> bool:
    mc = result["monte_carlo"] or {}
    return bool(
        result["score"]["verdict"] == "GO"
        and result["consistent"]
        and mc.get("p5_total_return_pct", -1e9) > 0
    )


def print_result(label: str, result: dict) -> None:
    s = result["score"]
    mc = result["monte_carlo"] or {}
    print(
        f"SLICE_RESULT name={label} n={s['n_trades']} WR={s['win_rate']*100:.1f}% "
        f"PF={s['profit_factor']:.4f} EV={s['expectancy_pct']:.4f}% "
        f"tstat={s['tstat']:.4f} maxDD={s['max_dd_pct']:.2f}% "
        f"h1={result['h1_mean_pct']} h2={result['h2_mean_pct']} "
        f"consistent={result['consistent']} MC_p5={mc.get('p5_total_return_pct')} "
        f"verdict={s['verdict']} gate_pass={gate_pass(result)}"
    )


def main() -> None:
    print("=== GENESIS CROSS-SECTIONAL MOMENTUM V1 ===")
    print(f"DATA_POLICY yfinance_adjusted_real_only start={START} end_exclusive={END}")
    print(f"UNIVERSE_POLICY fixed_ex_ante_assets={len(UNIVERSE)} no_posthoc_asset_mining=true")
    print(
        f"SIGNAL_POLICY 12_minus_1 lookback={MOM_LOOKBACK} skip_recent={SKIP_RECENT} "
        f"rebalance={REBALANCE_DAYS} top_fraction={TOP_FRACTION}"
    )
    print("WEIGHT_POLICY long_gross=0.5 short_gross=0.5 inverse_vol_60d_causal=true")
    print(f"COST_POLICY portfolio_turnover_bps={COST_BPS} research_assumption=true")
    print(f"EVIDENCE_GATES {GATES}")
    print("HOLDOUT_POLICY sealed_until_validation_pass=true")
    print("AUTHORITY RESEARCH_ONLY liveOrders=false capitalEligible=false")

    data = {ticker: download_adjusted_close(ticker) for ticker in UNIVERSE}
    prices = pd.concat(data, axis=1).dropna()
    if len(prices) < 2500:
        raise RuntimeError(f"common universe history too short: {len(prices)}")
    print(
        f"COMMON_WINDOW assets={len(prices.columns)} rows={len(prices)} "
        f"start={prices.index[0].date()} end={prices.index[-1].date()}"
    )

    pnl, weights, diag = build_portfolio(prices)
    n = len(pnl)
    i1 = int(n * 0.40)
    i2 = int(n * 0.70)
    development = pnl.iloc[:i1]
    validation = pnl.iloc[i1:i2]
    holdout = pnl.iloc[i2:]
    print(
        f"SPLIT active_days={n} dev40={len(development)} val30={len(validation)} "
        f"holdout30={len(holdout)} start={pnl.index[0].date()} end={pnl.index[-1].date()}"
    )
    print(
        f"PORTFOLIO_DIAGNOSTICS rebalances={diag.attrs['rebalance_count']} "
        f"avg_long_short_signal_gap={diag.attrs['avg_long_short_signal_gap']} "
        f"avg_daily_turnover={diag['turnover'].mean():.6f} total_cost_pct={diag['costs'].sum()*100:.4f}"
    )

    dev_result = evaluate_slice(development)
    val_result = evaluate_slice(validation)
    print_result("DEVELOPMENT", dev_result)
    print_result("VALIDATION", val_result)

    validation_pass = gate_pass(val_result)
    report = {
        "engine": "cross_sectional_momentum_v1",
        "data_policy": "yfinance_adjusted_real_only",
        "universe": UNIVERSE,
        "params": {
            "momentum_lookback": MOM_LOOKBACK,
            "skip_recent": SKIP_RECENT,
            "rebalance_days": REBALANCE_DAYS,
            "vol_lookback": VOL_LOOKBACK,
            "top_fraction": TOP_FRACTION,
            "cost_bps": COST_BPS,
        },
        "gates": GATES,
        "period": {"start": str(pnl.index[0].date()), "end": str(pnl.index[-1].date()), "n_days": n},
        "development": dev_result,
        "validation": val_result,
        "holdout": {"sealed": True},
        "capitalEligible": False,
        "liveOrders": False,
    }

    if validation_pass:
        print("VALIDATION_GATE PASS -> HOLDOUT_OPENED")
        holdout_result = evaluate_slice(holdout)
        print_result("HOLDOUT", holdout_result)
        report["holdout"] = {"sealed": False, **holdout_result}
        report["final_verdict"] = "RESEARCH_GO" if gate_pass(holdout_result) else "NO_GO"
    else:
        print("VALIDATION_GATE FAIL -> HOLDOUT_REMAINS_SEALED")
        report["final_verdict"] = "NO_GO"

    print(
        f"FINAL_VERDICT {report['final_verdict']} holdout_sealed={report['holdout']['sealed']} "
        f"capitalEligible=false liveOrders=false"
    )
    path = OUT / "cross_sectional_momentum_v1_report.json"
    path.write_text(json.dumps(report, indent=2, default=str))
    print(f"REPORT {path}")


if __name__ == "__main__":
    main()
