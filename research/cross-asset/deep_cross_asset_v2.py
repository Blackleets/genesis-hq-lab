from __future__ import annotations
import json, math, hashlib
from pathlib import Path
import numpy as np
import pandas as pd
import yfinance as yf

from forex_trend_system import GATES, scorecard, monte_carlo, daily_pnl_to_trades

START = "2003-12-01"
END = "2022-03-05"
LOOKBACK = 252
REBALANCE = 21
VOL_LOOKBACK = 60
TARGET_VOL_ANNUAL = 0.10
MAX_EXPOSURE = 2.0

ASSETS = {
    "EURUSD": {"ticker":"EURUSD=X", "cost_bps":1.0, "kind":"fx_spot"},
    "GBPUSD": {"ticker":"GBPUSD=X", "cost_bps":1.2, "kind":"fx_spot"},
    "USDJPY": {"ticker":"USDJPY=X", "cost_bps":1.0, "kind":"fx_spot"},
    "AUDUSD": {"ticker":"AUDUSD=X", "cost_bps":1.2, "kind":"fx_spot"},
    "USDCAD": {"ticker":"USDCAD=X", "cost_bps":1.2, "kind":"fx_spot"},
    "USDCHF": {"ticker":"USDCHF=X", "cost_bps":1.2, "kind":"fx_spot"},
    "SP500": {"ticker":"ES=F", "cost_bps":1.5, "kind":"future_proxy"},
    "GOLD": {"ticker":"GC=F", "cost_bps":2.0, "kind":"future_proxy"},
    "WTI": {"ticker":"CL=F", "cost_bps":3.0, "kind":"future_proxy"},
    "UST10Y": {"ticker":"ZN=F", "cost_bps":1.0, "kind":"future_proxy"},
}

OUT = Path(__file__).resolve().parent / "deep-v2-output"
OUT.mkdir(parents=True, exist_ok=True)

def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

def download_close(name: str, cfg: dict) -> pd.Series:
    raw = yf.download(cfg["ticker"], start=START, end=END, interval="1d",
                      auto_adjust=False, progress=False)
    if raw is None or raw.empty:
        raise RuntimeError(f"{name}: empty yfinance response for {cfg['ticker']}")
    close = raw["Close"]
    if isinstance(close, pd.DataFrame):
        close = close.iloc[:, 0]
    s = pd.Series(pd.to_numeric(close, errors="coerce").values,
                  index=pd.to_datetime(close.index), name=name).dropna().sort_index()
    if len(s) < 2000:
        raise RuntimeError(f"{name}: only {len(s)} rows; deep-history test requires >=2000")
    p = OUT / f"{name}.csv"
    pd.DataFrame({"Date":s.index, "Close":s.values}).to_csv(p, index=False, date_format="%Y-%m-%d")
    print(f"DATA_OK name={name} ticker={cfg['ticker']} kind={cfg['kind']} rows={len(s)} "
          f"start={s.index[0].date()} end={s.index[-1].date()} cost_bps={cfg['cost_bps']} sha256={sha256(p)}")
    return s

def tsmom_pnl(prices: pd.Series, cost_bps: float) -> pd.Series:
    ret = prices.pct_change()
    mom = prices.pct_change(LOOKBACK)
    ann_vol = ret.rolling(VOL_LOOKBACK).std() * math.sqrt(252.0)
    signal = np.sign(mom)
    mask = (np.arange(len(prices)) % REBALANCE) == 0
    pos = pd.Series(np.where(mask, signal, np.nan), index=prices.index).ffill().fillna(0.0)
    size = (TARGET_VOL_ANNUAL / ann_vol).clip(upper=MAX_EXPOSURE).fillna(0.0)
    exposure = pos * size
    gross = exposure.shift(1).fillna(0.0) * ret.fillna(0.0)
    turnover = exposure.diff().abs().fillna(0.0)
    cost = turnover * (cost_bps / 10000.0)
    net = gross - cost
    return net.dropna()

def combine_risk_parity(pnls: dict[str,pd.Series], lookback=60) -> tuple[pd.Series,pd.DataFrame]:
    df = pd.concat(pnls, axis=1).dropna()
    vols = df.rolling(lookback).std().shift(1)
    inv = 1.0 / vols.replace(0.0, np.nan)
    w = inv.div(inv.sum(axis=1), axis=0).fillna(1.0/len(df.columns))
    port = (df * w).sum(axis=1)
    return port.dropna(), w

def slice_score(pnl: pd.Series) -> dict:
    trades = daily_pnl_to_trades(pnl, REBALANCE)
    sc = scorecard(trades)
    mc = monte_carlo(trades)
    mid = len(trades)//2
    h1 = float(trades[:mid].mean()*100) if mid else None
    h2 = float(trades[mid:].mean()*100) if len(trades)-mid else None
    consistent = bool(h1 is not None and h2 is not None and h1 > 0 and h2 > 0)
    return {"score":sc, "mc":mc, "h1_mean_pct":h1, "h2_mean_pct":h2, "consistent":consistent}

def main():
    print("=== GENESIS CROSS-ASSET TSMOM V2 ===")
    print(f"DATA_POLICY real_yfinance_only start={START} end_exclusive={END}")
    print(f"PARAMS lookback={LOOKBACK} rebalance={REBALANCE} vol_lookback={VOL_LOOKBACK} "
          f"target_vol_annual={TARGET_VOL_ANNUAL} max_exposure={MAX_EXPOSURE}")
    print(f"EVIDENCE_GATES {GATES}")
    print("COST_POLICY per_instrument_turnover_bps; research assumptions, not broker fills")
    print("LEAKAGE_FIX target volatility is fixed ex-ante; realized vol is rolling/causal")
    print("AUTHORITY RESEARCH_ONLY liveOrders=false capitalEligible=false")

    prices = {name: download_close(name,cfg) for name,cfg in ASSETS.items()}
    pnls = {name: tsmom_pnl(prices[name], ASSETS[name]["cost_bps"]) for name in ASSETS}
    portfolio, weights = combine_risk_parity(pnls)

    n = len(portfolio)
    i1 = int(n*0.40)
    i2 = int(n*0.70)
    dev = portfolio.iloc[:i1]
    val = portfolio.iloc[i1:i2]
    hold = portfolio.iloc[i2:]
    print(f"SPLIT common_days={n} dev40={len(dev)} val30={len(val)} holdout30={len(hold)} "
          f"start={portfolio.index[0].date()} end={portfolio.index[-1].date()}")

    report = {
        "engine":"cross_asset_tsmom_v2",
        "params":{"lookback":LOOKBACK,"rebalance":REBALANCE,"vol_lookback":VOL_LOOKBACK,
                  "target_vol_annual":TARGET_VOL_ANNUAL,"max_exposure":MAX_EXPOSURE},
        "gates":GATES,
        "assets":ASSETS,
        "period":{"start":str(portfolio.index[0].date()),"end":str(portfolio.index[-1].date()),"n_days":n},
        "development":slice_score(dev),
        "validation":slice_score(val),
        "holdout":slice_score(hold),
        "individual_holdout":{},
    }
    for name,pnl in pnls.items():
        aligned = pnl.reindex(portfolio.index).dropna()
        h = aligned[aligned.index >= hold.index[0]]
        report["individual_holdout"][name] = slice_score(h)["score"]

    for label,key in [("DEVELOPMENT","development"),("VALIDATION","validation"),("HOLDOUT","holdout")]:
        r=report[key]; s=r["score"]; mc=r["mc"]
        print(f"SLICE_RESULT name={label} n={s['n_trades']} WR={s['win_rate']*100:.1f}% "
              f"PF={s['profit_factor']:.4f} EV={s['expectancy_pct']:.4f}% "
              f"tstat={s['tstat']:.4f} maxDD={s['max_dd_pct']:.2f}% "
              f"h1={r['h1_mean_pct']:.4f}% h2={r['h2_mean_pct']:.4f}% "
              f"consistent={r['consistent']} MC_p5={mc.get('p5_total_return_pct') if mc else None} "
              f"verdict={s['verdict']}")
    print("=== INDIVIDUAL HOLDOUT ===")
    for name,s in report["individual_holdout"].items():
        print(f"ASSET_HOLDOUT name={name} n={s['n_trades']} WR={s['win_rate']*100:.1f}% "
              f"PF={s['profit_factor']:.4f} EV={s['expectancy_pct']:.4f}% "
              f"tstat={s['tstat']:.4f} maxDD={s['max_dd_pct']:.2f}% verdict={s['verdict']}")

    val = report["validation"]
    hold = report["holdout"]
    hold_mc = hold["mc"] or {}
    research_go = (
        val["score"]["verdict"] == "GO"
        and hold["score"]["verdict"] == "GO"
        and val["consistent"]
        and hold["consistent"]
        and hold_mc.get("p5_total_return_pct", -1e9) > 0
    )
    report["final_verdict"] = "RESEARCH_GO" if research_go else "NO_GO"
    report["capitalEligible"] = False
    report["liveOrders"] = False
    print(f"FINAL_VERDICT {report['final_verdict']} capitalEligible=false liveOrders=false")
    out = OUT / "cross_asset_tsmom_v2_report.json"
    out.write_text(json.dumps(report,indent=2,default=str))
    print(f"REPORT {out}")

if __name__ == "__main__":
    main()
