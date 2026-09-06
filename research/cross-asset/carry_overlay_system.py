from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd

from forex_trend_system import StrategyParams, daily_pnl_to_trades, load_price_csv, monte_carlo, scorecard
from forex_portfolio_system import combine_portfolio, per_asset_daily_pnl

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
START = pd.Timestamp("2012-12-04")
END = pd.Timestamp("2022-03-04")
REB = 21
LOOKBACK = 252

RATE_SERIES = {
    "USD": "IR3TIB01USM156N",
    "EUR": "IR3TIB01EZM156N",
    "GBP": "IR3TIB01GBM156N",
    "JPY": "IR3TIB01JPM156N",
    "AUD": "IR3TIB01AUM156N",
    "CAD": "IR3TIB01CAM156N",
    "CHF": "IR3TIB01CHM156N",
}

PAIR_META = {
    "EURUSD": ("EUR", "USD", 0.0001),
    "GBPUSD": ("GBP", "USD", 0.0001),
    "USDJPY": ("USD", "JPY", 0.01),
    "AUDUSD": ("AUD", "USD", 0.0001),
    "USDCAD": ("USD", "CAD", 0.0001),
    "USDCHF": ("USD", "CHF", 0.0001),
}

MOMENTUM_NAMES = ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD", "USDCHF", "XAUUSD", "SP500", "WTI", "UST10Y"]


def fred_monthly(series_id: str) -> pd.Series:
    url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}"
    df = pd.read_csv(url, na_values=["."])
    date_col = df.columns[0]
    value_col = df.columns[1]
    df[date_col] = pd.to_datetime(df[date_col])
    values = pd.to_numeric(df[value_col], errors="coerce")
    s = pd.Series(values.values, index=df[date_col], name=series_id).dropna().sort_index()
    s = s[(s.index >= START - pd.DateOffset(months=3)) & (s.index <= END)]
    if s.empty:
        raise RuntimeError(f"FRED series empty: {series_id}")
    # FRED/OECD observation is a monthly average. Lag one full monthly observation
    # before forward-filling to daily dates so the strategy never sees a month's
    # average before that month has completed.
    return s.shift(1).dropna()


def rate_on_dates(monthly: pd.Series, dates: pd.DatetimeIndex) -> pd.Series:
    union = monthly.index.union(dates).sort_values()
    return monthly.reindex(union).ffill().reindex(dates)


def carry_leg(pair: str, rates: dict[str, pd.Series]) -> pd.Series:
    base, quote, pip_size = PAIR_META[pair]
    prices = load_price_csv(str(DATA / f"{pair}.csv"))
    idx = pd.DatetimeIndex(prices.index)
    base_rate = rate_on_dates(rates[base], idx)
    quote_rate = rate_on_dates(rates[quote], idx)
    diff_pct = base_rate - quote_rate
    signal = np.sign(diff_pct).fillna(0.0)

    ret = prices.pct_change().fillna(0.0)
    held_signal = signal.shift(1).fillna(0.0)
    held_diff_pct = diff_pct.shift(1).fillna(0.0)

    spot_pnl = held_signal * ret
    # Annualized interest differential in percent -> approximate daily financing return.
    carry_accrual = held_signal * (held_diff_pct / 100.0) / 252.0
    turnover = signal.diff().abs().fillna(signal.abs())
    costs = turnover * ((1.0 * pip_size) / prices)
    net = (spot_pnl + carry_accrual - costs).dropna()

    print(
        f"CARRY_LEG pair={pair} rows={len(net)} "
        f"avg_abs_diff_pct={diff_pct.abs().mean():.4f} mean_daily_pnl_pct={net.mean()*100:.6f}"
    )
    return net


def score_daily(pnl: pd.Series) -> dict:
    split = int(len(pnl) * 0.6)
    train_pnl, test_pnl = pnl.iloc[:split], pnl.iloc[split:]
    train_trades = daily_pnl_to_trades(train_pnl, REB)
    test_trades = daily_pnl_to_trades(test_pnl, REB)
    train = scorecard(train_trades)
    test = scorecard(test_trades)
    mid = len(test_trades) // 2
    h1, h2 = test_trades[:mid], test_trades[mid:]
    consistent = bool(len(h1) and len(h2) and h1.mean() > 0 and h2.mean() > 0)
    mc = monte_carlo(test_trades)
    final = "GO" if test["verdict"] == "GO" and consistent else (
        "INSUFFICIENT_DATA" if test["verdict"] == "INSUFFICIENT_DATA" else "NO_GO"
    )
    return {
        "train": train,
        "test": test,
        "temporal_consistency": {
            "h1_mean_pct": float(h1.mean() * 100) if len(h1) else None,
            "h2_mean_pct": float(h2.mean() * 100) if len(h2) else None,
            "consistent": consistent,
        },
        "monte_carlo_oos": mc,
        "final_verdict": final,
    }


def main() -> None:
    print("CARRY_POLICY source=FRED_OECD_3M_INTERBANK monthly_lag=1 strategy_authority=RESEARCH_ONLY")
    rates = {ccy: fred_monthly(series) for ccy, series in RATE_SERIES.items()}
    for ccy, s in rates.items():
        print(f"RATE_OK ccy={ccy} series={RATE_SERIES[ccy]} n={len(s)} start={s.index.min().date()} end={s.index.max().date()}")

    carry_legs = {pair: carry_leg(pair, rates) for pair in PAIR_META}
    carry_sleeve = combine_portfolio(carry_legs)

    momentum_legs = {}
    for i, name in enumerate(MOMENTUM_NAMES):
        prices = load_price_csv(str(DATA / f"{name}.csv"))
        p = StrategyParams(
            lookback_days=LOOKBACK,
            rebalance_days=REB,
            spread_pips=1.0,
            pip_size=0.01 if name == "USDJPY" else 0.0001,
        )
        momentum_legs[name] = per_asset_daily_pnl(prices, p)
    momentum_sleeve = combine_portfolio(momentum_legs)

    sleeves = pd.concat({"TSMOM": momentum_sleeve, "FX_CARRY": carry_sleeve}, axis=1).dropna()
    sleeve_corr = float(sleeves["TSMOM"].corr(sleeves["FX_CARRY"]))
    combined = combine_portfolio({"TSMOM": sleeves["TSMOM"], "FX_CARRY": sleeves["FX_CARRY"]})

    result = {
        "method": {
            "carry_rate_source": "FRED/OECD 3M interbank monthly",
            "carry_rate_publication_safety": "one-month observation lag before daily forward-fill",
            "carry_pairs": list(PAIR_META),
            "momentum_assets": MOMENTUM_NAMES,
            "sleeve_combination": "inverse-vol risk parity, 60d vol shifted 1 day",
            "lookback_days": LOOKBACK,
            "rebalance_days": REB,
        },
        "daily_sleeve_correlation": sleeve_corr,
        "momentum": score_daily(sleeves["TSMOM"]),
        "carry": score_daily(sleeves["FX_CARRY"]),
        "combined": score_daily(combined),
    }

    print(f"SLEEVE_CORRELATION daily_tsmom_vs_carry={sleeve_corr:.4f}")
    for name in ["momentum", "carry", "combined"]:
        r = result[name]
        t = r["test"]
        tc = r["temporal_consistency"]
        mc = r["monte_carlo_oos"]
        print(
            f"SLEEVE_RESULT name={name.upper()} n={t['n_trades']} WR={t['win_rate']*100:.1f}% "
            f"PF={t['profit_factor']:.2f} EV={t['expectancy_pct']:.4f}% tstat={t['tstat']:.2f} "
            f"maxDD={t['max_dd_pct']:.1f}% h1={tc['h1_mean_pct']:.4f}% h2={tc['h2_mean_pct']:.4f}% "
            f"MC_p5={mc.get('p5_total_return_pct') if mc else None} verdict={r['final_verdict']}"
        )

    out = ROOT / "carry_overlay_report.json"
    out.write_text(json.dumps(result, indent=2, default=str), encoding="utf-8")
    print(f"CARRY_REPORT {out}")


if __name__ == "__main__":
    main()
