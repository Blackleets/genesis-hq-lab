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
HORIZONS = (63, 126, 252)
REBALANCE_DAYS = 21
VOL_LOOKBACK = 60
TARGET_ASSET_VOL = 0.10
MAX_EXPOSURE = 2.0
COST_BPS = 2.0

# Fixed ex-ante liquid ETF universe spanning equity beta, sectors, metals and rates.
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

OUT = Path(__file__).resolve().parent / "trend-ensemble-output"
OUT.mkdir(parents=True, exist_ok=True)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def download_adjusted_close(ticker: str) -> pd.Series:
    raw = yf.download(ticker, start=START, end=END, interval="1d", auto_adjust=True, progress=False)
    if raw is None or raw.empty:
        raise RuntimeError(f"{ticker}: empty yfinance response")
    close = raw["Close"]
    if isinstance(close, pd.DataFrame):
        if close.shape[1] != 1:
            raise RuntimeError(f"{ticker}: ambiguous Close columns")
        close = close.iloc[:, 0]
    s = pd.Series(pd.to_numeric(close, errors="coerce").values,
                  index=pd.to_datetime(close.index), name=ticker).dropna().sort_index()
    if len(s) < 2000:
        raise RuntimeError(f"{ticker}: insufficient history ({len(s)} rows)")
    path = OUT / f"{ticker}.csv"
    pd.DataFrame({"Date": s.index, "Close": s.values}).to_csv(path, index=False, date_format="%Y-%m-%d")
    print(f"DATA_OK ticker={ticker} rows={len(s)} start={s.index[0].date()} end={s.index[-1].date()} "
          f"role={UNIVERSE[ticker]} sha256={sha256(path)}")
    return s


def build_portfolio(prices: pd.DataFrame) -> tuple[pd.Series, pd.DataFrame, pd.DataFrame]:
    ret = prices.pct_change()
    ann_vol = ret.rolling(VOL_LOOKBACK).std().shift(1) * math.sqrt(252.0)

    # Pre-specified multi-horizon ensemble: average signs from 3m/6m/12m.
    signals = []
    for h in HORIZONS:
        signals.append(np.sign(prices / prices.shift(h) - 1.0))
    score = sum(signals) / float(len(signals))

    weights = pd.DataFrame(np.nan, index=prices.index, columns=prices.columns, dtype=float)
    first_eligible = max(max(HORIZONS), VOL_LOOKBACK + 1)
    rebalances = 0
    avg_abs_signal = []

    for i in range(first_eligible, len(prices)):
        if (i - first_eligible) % REBALANCE_DAYS != 0:
            continue
        sig = score.iloc[i].replace([np.inf, -np.inf], np.nan)
        vol = ann_vol.iloc[i].replace([np.inf, -np.inf, 0.0], np.nan)
        row = pd.Series(0.0, index=prices.columns)
        eligible = sig.dropna().index.intersection(vol.dropna().index)
        if len(eligible) < 8:
            continue
        raw_exposure = sig.loc[eligible] * (TARGET_ASSET_VOL / vol.loc[eligible])
        raw_exposure = raw_exposure.clip(lower=-MAX_EXPOSURE, upper=MAX_EXPOSURE)
        # Each sleeve is risk-normalized; divide by N to avoid notional explosion.
        row.loc[eligible] = raw_exposure / len(eligible)
        weights.iloc[i] = row
        rebalances += 1
        avg_abs_signal.append(float(sig.loc[eligible].abs().mean()))

    weights = weights.ffill().fillna(0.0)
    active = weights.abs().sum(axis=1) > 0
    if not active.any():
        raise RuntimeError("no active trend weights created")
    weights = weights.loc[active[active].index[0]:]
    ret = ret.reindex(weights.index).fillna(0.0)

    gross = (weights.shift(1).fillna(0.0) * ret).sum(axis=1)
    turnover = weights.diff().abs().sum(axis=1).fillna(0.0)
    costs = turnover * (COST_BPS / 10000.0)
    net = gross - costs

    diagnostics = pd.DataFrame({"gross_pnl": gross, "costs": costs, "turnover": turnover, "net_pnl": net})
    diagnostics.attrs["rebalances"] = rebalances
    diagnostics.attrs["avg_abs_ensemble_signal"] = float(np.mean(avg_abs_signal)) if avg_abs_signal else None
    diagnostics.attrs["avg_gross_exposure"] = float(weights.abs().sum(axis=1).mean())
    diagnostics.attrs["avg_net_exposure"] = float(weights.sum(axis=1).mean())
    return net, weights, diagnostics


def evaluate_slice(pnl: pd.Series) -> dict:
    trades = daily_pnl_to_trades(pnl, REBALANCE_DAYS)
    sc = scorecard(trades)
    mc = monte_carlo(trades)
    mid = len(trades) // 2
    h1 = float(trades[:mid].mean() * 100) if mid else None
    h2 = float(trades[mid:].mean() * 100) if len(trades) - mid else None
    consistent = bool(h1 is not None and h2 is not None and h1 > 0 and h2 > 0)
    return {"score": sc, "monte_carlo": mc, "h1_mean_pct": h1, "h2_mean_pct": h2, "consistent": consistent}


def gate_pass(result: dict) -> bool:
    mc = result["monte_carlo"] or {}
    return bool(result["score"]["verdict"] == "GO" and result["consistent"] and mc.get("p5_total_return_pct", -1e9) > 0)


def print_result(label: str, result: dict) -> None:
    s = result["score"]
    mc = result["monte_carlo"] or {}
    print(f"SLICE_RESULT name={label} n={s['n_trades']} WR={s['win_rate']*100:.1f}% PF={s['profit_factor']:.4f} "
          f"EV={s['expectancy_pct']:.4f}% tstat={s['tstat']:.4f} maxDD={s['max_dd_pct']:.2f}% "
          f"h1={result['h1_mean_pct']} h2={result['h2_mean_pct']} consistent={result['consistent']} "
          f"MC_p5={mc.get('p5_total_return_pct')} verdict={s['verdict']} gate_pass={gate_pass(result)}")


def main() -> None:
    print("=== GENESIS CTA MULTI-HORIZON TREND ENSEMBLE V1 ===")
    print(f"DATA_POLICY yfinance_adjusted_real_only start={START} end_exclusive={END}")
    print(f"UNIVERSE_POLICY fixed_ex_ante_assets={len(UNIVERSE)} no_posthoc_asset_mining=true")
    print(f"SIGNAL_POLICY horizons={HORIZONS} ensemble=mean_sign rebalance={REBALANCE_DAYS}")
    print(f"RISK_POLICY asset_target_vol={TARGET_ASSET_VOL} vol_lookback={VOL_LOOKBACK} max_exposure={MAX_EXPOSURE}")
    print(f"COST_POLICY portfolio_turnover_bps={COST_BPS} research_assumption=true")
    print(f"EVIDENCE_GATES {GATES}")
    print("HOLDOUT_POLICY sealed_until_validation_pass=true")
    print("AUTHORITY RESEARCH_ONLY liveOrders=false capitalEligible=false")

    data = {ticker: download_adjusted_close(ticker) for ticker in UNIVERSE}
    prices = pd.concat(data, axis=1).dropna()
    print(f"COMMON_WINDOW assets={len(prices.columns)} rows={len(prices)} start={prices.index[0].date()} end={prices.index[-1].date()}")

    pnl, weights, diag = build_portfolio(prices)
    n = len(pnl)
    i1 = int(n * 0.40)
    i2 = int(n * 0.70)
    dev, val, hold = pnl.iloc[:i1], pnl.iloc[i1:i2], pnl.iloc[i2:]
    print(f"SPLIT active_days={n} dev40={len(dev)} val30={len(val)} holdout30={len(hold)} start={pnl.index[0].date()} end={pnl.index[-1].date()}")
    print(f"PORTFOLIO_DIAGNOSTICS rebalances={diag.attrs['rebalances']} avg_abs_signal={diag.attrs['avg_abs_ensemble_signal']} "
          f"avg_gross_exposure={diag.attrs['avg_gross_exposure']:.6f} avg_net_exposure={diag.attrs['avg_net_exposure']:.6f} "
          f"avg_daily_turnover={diag['turnover'].mean():.6f} total_cost_pct={diag['costs'].sum()*100:.4f}")

    dev_result = evaluate_slice(dev)
    val_result = evaluate_slice(val)
    print_result("DEVELOPMENT", dev_result)
    print_result("VALIDATION", val_result)

    report = {
        "engine": "trend_ensemble_v1",
        "data_policy": "yfinance_adjusted_real_only",
        "universe": UNIVERSE,
        "params": {"horizons": HORIZONS, "rebalance_days": REBALANCE_DAYS, "vol_lookback": VOL_LOOKBACK,
                   "target_asset_vol": TARGET_ASSET_VOL, "max_exposure": MAX_EXPOSURE, "cost_bps": COST_BPS},
        "gates": GATES,
        "development": dev_result,
        "validation": val_result,
        "holdout": {"sealed": True},
        "capitalEligible": False,
        "liveOrders": False,
    }

    if gate_pass(val_result):
        print("VALIDATION_GATE PASS -> HOLDOUT_OPENED")
        hold_result = evaluate_slice(hold)
        print_result("HOLDOUT", hold_result)
        report["holdout"] = {"sealed": False, **hold_result}
        report["final_verdict"] = "RESEARCH_GO" if gate_pass(hold_result) else "NO_GO"
    else:
        print("VALIDATION_GATE FAIL -> HOLDOUT_REMAINS_SEALED")
        report["final_verdict"] = "NO_GO"

    print(f"FINAL_VERDICT {report['final_verdict']} holdout_sealed={report['holdout']['sealed']} capitalEligible=false liveOrders=false")
    path = OUT / "trend_ensemble_v1_report.json"
    path.write_text(json.dumps(report, indent=2, default=str))
    print(f"REPORT {path}")


if __name__ == "__main__":
    main()
