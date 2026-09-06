from __future__ import annotations
import json, math, hashlib
from pathlib import Path

import numpy as np
import pandas as pd
import yfinance as yf
from statsmodels.tsa.stattools import adfuller

from forex_trend_system import GATES, scorecard, monte_carlo

START = "2003-12-01"
END = "2022-03-05"
ROLL_Z = 60
ENTRY_Z = 2.0
EXIT_Z = 0.5
STOP_Z = 4.0
ADF_ALPHA = 0.01
MIN_HALF_LIFE = 2.0
MAX_HALF_LIFE = 120.0

# Fixed ex-ante economic pairs. No brute-force pair mining.
PAIRS = {
    "EURUSD_GBPUSD": {
        "y": ("EURUSD=X", 1.0),
        "x": ("GBPUSD=X", 1.2),
        "economic_link": "major_European_FX_vs_USD",
    },
    "AUDUSD_NZDUSD": {
        "y": ("AUDUSD=X", 1.2),
        "x": ("NZDUSD=X", 1.2),
        "economic_link": "Antipodean_FX",
    },
    "SPY_QQQ": {
        "y": ("SPY", 0.6),
        "x": ("QQQ", 0.7),
        "economic_link": "US_equity_beta_relative_value",
    },
    "GLD_SLV": {
        "y": ("GLD", 1.2),
        "x": ("SLV", 1.5),
        "economic_link": "precious_metals",
    },
    "USO_BNO": {
        "y": ("USO", 2.5),
        "x": ("BNO", 3.0),
        "economic_link": "WTI_vs_Brent_energy",
    },
    "IEF_TLT": {
        "y": ("IEF", 0.8),
        "x": ("TLT", 1.0),
        "economic_link": "US_Treasury_curve",
    },
}

OUT = Path(__file__).resolve().parent / "relative-value-output"
OUT.mkdir(parents=True, exist_ok=True)

def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

def download(ticker: str) -> pd.Series:
    raw = yf.download(ticker, start=START, end=END, interval="1d",
                      auto_adjust=True, progress=False)
    if raw is None or raw.empty:
        raise RuntimeError(f"empty yfinance response: {ticker}")
    close = raw["Close"]
    if isinstance(close, pd.DataFrame):
        close = close.iloc[:,0]
    s = pd.Series(pd.to_numeric(close, errors="coerce").values,
                  index=pd.to_datetime(close.index), name=ticker).dropna().sort_index()
    if len(s) < 1000:
        raise RuntimeError(f"{ticker}: insufficient history {len(s)}")
    p = OUT / (ticker.replace("=","_").replace("^","IDX_") + ".csv")
    pd.DataFrame({"Date":s.index, "Close":s.values}).to_csv(p,index=False,date_format="%Y-%m-%d")
    print(f"DATA_OK ticker={ticker} rows={len(s)} start={s.index[0].date()} end={s.index[-1].date()} sha256={sha256(p)}")
    return s

def fit_spread(dev: pd.DataFrame) -> dict:
    ly = np.log(dev["y"])
    lx = np.log(dev["x"])
    beta, intercept = np.polyfit(lx.values, ly.values, 1)
    spread = ly - (intercept + beta*lx)
    adf = adfuller(spread.dropna(), maxlag=20, autolag="AIC")
    adf_p = float(adf[1])
    lag = spread.shift(1)
    delta = spread - lag
    ar = pd.concat([delta.rename("d"), lag.rename("lag")], axis=1).dropna()
    phi = float(np.polyfit(ar["lag"].values, ar["d"].values, 1)[0]) if len(ar) > 20 else float("nan")
    half_life = float(-math.log(2)/phi) if np.isfinite(phi) and phi < 0 else float("inf")
    structure_pass = (
        adf_p <= ADF_ALPHA
        and MIN_HALF_LIFE <= half_life <= MAX_HALF_LIFE
        and 0.05 <= abs(beta) <= 20.0
    )
    return {
        "beta":float(beta),
        "intercept":float(intercept),
        "adf_p":adf_p,
        "half_life_days":half_life,
        "structure_pass":bool(structure_pass),
    }

def build_positions(full: pd.DataFrame, fit: dict) -> pd.DataFrame:
    ly = np.log(full["y"])
    lx = np.log(full["x"])
    spread = ly - (fit["intercept"] + fit["beta"]*lx)
    mean = spread.rolling(ROLL_Z).mean().shift(1)
    std = spread.rolling(ROLL_Z).std(ddof=1).shift(1)
    z = (spread - mean) / std.replace(0,np.nan)

    state = 0
    pos = []
    for val in z.values:
        if not np.isfinite(val):
            pos.append(0)
            continue
        if state == 0:
            if val >= ENTRY_Z:
                state = -1
            elif val <= -ENTRY_Z:
                state = 1
        elif state == 1:
            if abs(val) <= EXIT_Z or val <= -STOP_Z:
                state = 0
        elif state == -1:
            if abs(val) <= EXIT_Z or val >= STOP_Z:
                state = 0
        pos.append(state)

    out = full.copy()
    out["spread"] = spread
    out["z"] = z
    out["position"] = pd.Series(pos,index=full.index,dtype=float)
    return out

def simulate(full: pd.DataFrame, fit: dict, cost_bps: float) -> pd.DataFrame:
    bt = build_positions(full,fit)
    beta = float(fit["beta"])
    norm = 1.0 + abs(beta)
    wy = 1.0/norm
    wx = -beta/norm
    ry = bt["y"].pct_change().fillna(0)
    rx = bt["x"].pct_change().fillna(0)
    pair_ret = wy*ry + wx*rx
    bt["gross_pnl"] = bt["position"].shift(1).fillna(0)*pair_ret
    turnover = bt["position"].diff().abs().fillna(0)
    bt["costs"] = turnover*(cost_bps/10000.0)
    bt["net_pnl"] = bt["gross_pnl"] - bt["costs"]
    return bt

def trade_returns(bt: pd.DataFrame) -> np.ndarray:
    p = bt["position"].fillna(0).values
    pnl = bt["net_pnl"].fillna(0).values
    trades=[]
    active=False
    acc=0.0
    prev=0.0
    for i in range(len(bt)):
        cur=p[i]
        if prev == 0 and cur != 0:
            active=True
            acc=float(pnl[i])
        elif active:
            acc += float(pnl[i])
            if prev != 0 and cur == 0:
                trades.append(acc)
                active=False
                acc=0.0
        prev=cur
    return np.asarray(trades,dtype=float)

def eval_bt(bt: pd.DataFrame) -> dict:
    tr = trade_returns(bt)
    sc = scorecard(tr)
    mc = monte_carlo(tr)
    mid=len(tr)//2
    h1=float(tr[:mid].mean()*100) if mid else None
    h2=float(tr[mid:].mean()*100) if len(tr)-mid else None
    consistent=bool(h1 is not None and h2 is not None and h1>0 and h2>0)
    return {"score":sc,"mc":mc,"h1_mean_pct":h1,"h2_mean_pct":h2,"consistent":consistent}

def main():
    print("=== GENESIS RELATIVE VALUE / COINTEGRATION V1 ===")
    print(f"DATA_POLICY yfinance_real_only start={START} end_exclusive={END}")
    print(f"PAIR_POLICY fixed_ex_ante_pairs={len(PAIRS)} no_bruteforce_pair_mining=true")
    print(f"STRUCTURE_GATE adf_p<={ADF_ALPHA} half_life=[{MIN_HALF_LIFE},{MAX_HALF_LIFE}] days")
    print(f"TRADE_POLICY z_window={ROLL_Z} entry={ENTRY_Z} exit={EXIT_Z} stop={STOP_Z}")
    print(f"EVIDENCE_GATES {GATES}")
    print("HOLDOUT_POLICY sealed_until_validation_pass=true")
    print("AUTHORITY RESEARCH_ONLY liveOrders=false capitalEligible=false")

    tickers=sorted({t for cfg in PAIRS.values() for t,_ in [cfg["y"],cfg["x"]]})
    data={t:download(t) for t in tickers}
    report={"engine":"relative_value_v1","gates":GATES,"pairs":{},"liveOrders":False,"capitalEligible":False}
    opened=0

    for name,cfg in PAIRS.items():
        y,cost_y=cfg["y"]; x,cost_x=cfg["x"]
        df=pd.concat({"y":data[y],"x":data[x]},axis=1).dropna()
        n=len(df); i1=int(n*.40); i2=int(n*.70)
        dev=df.iloc[:i1].copy()
        val=df.iloc[i1:i2].copy()
        hold=df.iloc[i2:].copy()
        fit=fit_spread(dev)
        cost_bps=float(cost_y+cost_x)
        print(f"PAIR_START name={name} y={y} x={x} rows={n} dev={len(dev)} val={len(val)} holdout={len(hold)} cost_bps={cost_bps}")
        print(f"STRUCTURE_RESULT name={name} beta={fit['beta']:.6f} adf_p={fit['adf_p']:.6g} "
              f"half_life={fit['half_life_days']:.2f} pass={fit['structure_pass']}")

        pair_report={
            "economic_link":cfg["economic_link"],"y":y,"x":x,"cost_bps":cost_bps,
            "fit":fit,"validation":None,"holdout":{"sealed":True},
        }
        if not fit["structure_pass"]:
            print(f"PAIR_VERDICT name={name} verdict=REJECT_STRUCTURE holdout=SEALED")
            report["pairs"][name]=pair_report
            continue

        val_full=pd.concat([dev.tail(ROLL_Z+5),val])
        val_bt=simulate(val_full,fit,cost_bps).loc[val.index]
        v=eval_bt(val_bt)
        pair_report["validation"]=v
        vs=v["score"]; vmc=v["mc"] or {}
        validation_pass=(
            vs["verdict"]=="GO"
            and v["consistent"]
            and vmc.get("p5_total_return_pct",-1e9)>0
        )
        print(f"VALIDATION_RESULT name={name} n={vs['n_trades']} WR={vs['win_rate']*100:.1f}% "
              f"PF={vs['profit_factor']:.4f} EV={vs['expectancy_pct']:.4f}% "
              f"tstat={vs['tstat']:.4f} maxDD={vs['max_dd_pct']:.2f}% "
              f"h1={v['h1_mean_pct']} h2={v['h2_mean_pct']} MC_p5={vmc.get('p5_total_return_pct')} "
              f"consistent={v['consistent']} verdict={vs['verdict']} gate_pass={validation_pass}")

        if not validation_pass:
            print(f"PAIR_VERDICT name={name} verdict=REJECT_VALIDATION holdout=SEALED")
            report["pairs"][name]=pair_report
            continue

        opened+=1
        hold_full=pd.concat([dev.tail(ROLL_Z+5),val,hold])
        hold_bt=simulate(hold_full,fit,cost_bps).loc[hold.index]
        h=eval_bt(hold_bt)
        hs=h["score"]; hmc=h["mc"] or {}
        hold_pass=(
            hs["verdict"]=="GO"
            and h["consistent"]
            and hmc.get("p5_total_return_pct",-1e9)>0
        )
        pair_report["holdout"]={"sealed":False,**h}
        print(f"HOLDOUT_RESULT name={name} n={hs['n_trades']} WR={hs['win_rate']*100:.1f}% "
              f"PF={hs['profit_factor']:.4f} EV={hs['expectancy_pct']:.4f}% "
              f"tstat={hs['tstat']:.4f} maxDD={hs['max_dd_pct']:.2f}% "
              f"h1={h['h1_mean_pct']} h2={h['h2_mean_pct']} MC_p5={hmc.get('p5_total_return_pct')} "
              f"consistent={h['consistent']} verdict={hs['verdict']} gate_pass={hold_pass}")
        pair_report["final_verdict"]="RESEARCH_GO" if hold_pass else "NO_GO"
        print(f"PAIR_VERDICT name={name} verdict={pair_report['final_verdict']} holdout=OPENED")
        report["pairs"][name]=pair_report

    winners=[k for k,v in report["pairs"].items() if v.get("final_verdict")=="RESEARCH_GO"]
    report["holdouts_opened"]=opened
    report["research_go_pairs"]=winners
    report["final_verdict"]="RESEARCH_GO" if winners else "NO_GO"
    print(f"SUMMARY holdouts_opened={opened} winners={winners} FINAL_VERDICT={report['final_verdict']} "
          f"capitalEligible=false liveOrders=false")
    path=OUT/"relative_value_v1_report.json"
    path.write_text(json.dumps(report,indent=2,default=str))
    print(f"REPORT {path}")

if __name__=="__main__":
    main()
