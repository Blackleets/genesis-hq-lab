#!/usr/bin/env python
"""quantstats_tearsheet.py — Professional risk tearsheet for Genesis paper bots.

Reads the REAL trade history of a bot state file (written by liveRunner.mjs),
builds an equity curve series, and produces a QuantStats HTML tearsheet +
a compact JSON metrics summary for the weekly auditor cron.

Usage:
  python scripts/quantstats_tearsheet.py [--state data/genesis_live_state_COTIUSDT_1h.json]

Output:
  data/tearsheets/<pair>_<tf>.html   (full QuantStats report)
  data/tearsheets/<pair>_<tf>.json   ({sharpe, sortino, max_drawdown, vol,
                                       worst_day, best_day, trades, verdict_inputs})

HONESTY: works only from real recorded trades. With <5 trades it emits
"insufficient_data" and does NOT fabricate statistics.
"""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "data" / "tearsheets"


def load_trades(state_path: Path) -> list[dict]:
    state = json.loads(state_path.read_text(encoding="utf-8"))
    trades = state.get("trades") or []
    return [t for t in trades if t.get("closedAt") and isinstance(t.get("pnlUsd"), (int, float))]


def daily_returns(trades: list[dict]) -> pd.Series:
    """Aggregate per-trade PnL into daily returns over the initial equity base."""
    by_day: dict[str, float] = {}
    for t in trades:
        day = t["closedAt"][:10]
        by_day[day] = by_day.get(day, 0.0) + float(t["pnlUsd"])
    days = sorted(by_day)
    # Base for % returns: average equity across the period is unknown pre-trade;
    # use cumulative reconstruction starting from initialEquity if present.
    first = pd.Timestamp(days[0])
    last = pd.Timestamp(days[-1])
    idx = pd.date_range(first, last, freq="D")
    pnl_by_day = pd.Series(0.0, index=idx)
    for d, pnl in by_day.items():
        pnl_by_day[pd.Timestamp(d)] += pnl
    return pnl_by_day


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", default=str(ROOT / "data" / "genesis_live_state_COTIUSDT_1h.json"))
    args = ap.parse_args()

    import quantstats as qs  # heavy import deferred until after arg parsing

    state_path = Path(args.state)
    if not state_path.exists():
        print(json.dumps({"error": f"state file not found: {state_path}"}))
        return 1
    raw = json.loads(state_path.read_text(encoding="utf-8"))
    pair = raw.get("pair", state_path.stem.split("_")[3] if len(state_path.stem.split("_")) > 3 else "PAIR")
    tf = raw.get("tf", "1h")
    initial_equity = float(raw.get("initialEquity") or raw.get("equity") or 1000)

    trades = load_trades(state_path)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    tag = state_path.stem.replace("genesis_live_state_", "")

    if len(trades) < 5:
        summary = {
            "status": "insufficient_data",
            "trades": len(trades),
            "note": "QuantStats tearsheet requires >=5 closed trades. No fabricated stats.",
            "generatedAt": datetime.now(timezone.utc).isoformat(),
        }
        (OUT_DIR / f"{tag}.json").write_text(json.dumps(summary, indent=2))
        print(json.dumps(summary))
        return 0

    pnl = daily_returns(trades)
    # Reconstruct equity path to derive true daily returns %
    equity = initial_equity
    eq_series = {}
    for ts, p in pnl.items():
        equity += float(p)
        eq_series[ts] = equity
    eq = pd.Series(eq_series).sort_index()
    returns = eq.pct_change().dropna()
    # First-day return relative to base:
    first_ret = (eq.iloc[0] / initial_equity) - 1
    returns = pd.concat([pd.Series([first_ret], index=[eq.index[0]]), returns])

    try:
        html = qs.reports.html(
            returns,
            title=f"Genesis Quant Lab — {tag}",
            output=str(OUT_DIR / f"{tag}.html"),
            download_filename=f"{tag}.html",
            extended=True,
        )
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": f"quantstats html failed: {exc}"}))
        return 1

    try:
        summary = {
            "status": "ok",
            "pair": pair,
            "tf": tf,
            "trades": len(trades),
            "initialEquity": initial_equity,
            "finalEquity": round(float(eq.iloc[-1]), 2),
            "returnPct": round((float(eq.iloc[-1]) / initial_equity - 1) * 100, 2),
        }
        for name, fn in [("sharpe", qs.stats.sharpe), ("sortino", qs.stats.sortino),
                         ("max_drawdown", lambda r: qs.stats.max_drawdown(r)),
                         ("volatility", qs.stats.volatility)]:
            try:
                summary[name] = round(float(fn(returns).iloc[0] if hasattr(fn(returns), 'iloc') else fn(returns)), 3)
            except Exception:  # noqa: BLE001
                summary[name] = None
        if "max_drawdown" in summary and summary["max_drawdown"] is not None:
            summary["maxDrawdownPct"] = round(summary.pop("max_drawdown") * 100, 2)
        else:
            summary.pop("max_drawdown", None)
        if "volatility" in summary and summary["volatility"] is not None:
            summary["volatilityAnnPct"] = round(summary.pop("volatility") * 100, 2)
        else:
            summary.pop("volatility", None)
        summary["worstDayPct"] = round(float(returns.min()) * 100, 2)
        summary["bestDayPct"] = round(float(returns.max()) * 100, 2)
        summary["tearsheet"] = str(OUT_DIR / f"{tag}.html")
        summary["generatedAt"] = datetime.now(timezone.utc).isoformat()
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": f"metrics failed: {exc}"}))
        return 1
    (OUT_DIR / f"{tag}.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary))
    return 0


if __name__ == "__main__":
    sys.exit(main())
