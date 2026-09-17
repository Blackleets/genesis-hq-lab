#!/usr/bin/env python3
import csv
import io
import json
import math
import os
import statistics
import sys
import urllib.error
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

VERSION = "funding_carry_lab_v2_binance_vision_oos"
BASE = "https://data.binance.vision/data"
SYMBOLS = [x.strip() for x in os.getenv("GENESIS_FUNDING_SYMBOLS", "BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT").split(",") if x.strip()]
MONTHS_BACK = max(4, min(12, int(os.getenv("GENESIS_FUNDING_MONTHS", "6"))))
SIGNAL_LOOKBACK = max(2, int(os.getenv("GENESIS_FUNDING_SIGNAL_LOOKBACK", "3")))
MIN_TRAILING_FUNDING_BPS = float(os.getenv("GENESIS_MIN_TRAILING_FUNDING_BPS", "0.25"))
HORIZONS = [int(x) for x in os.getenv("GENESIS_FUNDING_HORIZONS", "3,6,12").split(",") if x.strip().isdigit() and int(x) > 0]
SPOT_TAKER_BPS_PER_SIDE = float(os.getenv("GENESIS_FUNDING_SPOT_TAKER_BPS", "10"))
PERP_TAKER_BPS_PER_SIDE = float(os.getenv("GENESIS_FUNDING_PERP_TAKER_BPS", "5"))
SLIPPAGE_RESERVE_BPS = float(os.getenv("GENESIS_FUNDING_SLIPPAGE_RESERVE_BPS", "4"))
ROUND_TRIP_COST_BPS = 2 * (SPOT_TAKER_BPS_PER_SIDE + PERP_TAKER_BPS_PER_SIDE) + SLIPPAGE_RESERVE_BPS
OUT = Path(sys.argv[sys.argv.index("--out") + 1]) if "--out" in sys.argv else Path("quant-evidence/funding-carry-lab-latest.json")
USER_AGENT = "GenesisHQ-Research/1.0 (+public-market-data)"


def roundn(value, digits=4):
    try:
        value = float(value)
        return round(value, digits) if math.isfinite(value) else None
    except (TypeError, ValueError):
        return None


def mean(values):
    values = [float(x) for x in values if x is not None and math.isfinite(float(x))]
    return sum(values) / len(values) if values else None


def stdev(values):
    values = [float(x) for x in values if x is not None and math.isfinite(float(x))]
    return statistics.stdev(values) if len(values) >= 2 else None


def normalize_ts(value):
    x = int(float(value))
    while x > 10**14:  # tolerate micro/nanosecond archive timestamps
        x //= 1000
    return x


def completed_months(count):
    now = datetime.now(timezone.utc)
    y, m = now.year, now.month
    out = []
    for _ in range(count):
        m -= 1
        if m == 0:
            y -= 1
            m = 12
        out.append(f"{y:04d}-{m:02d}")
    return list(reversed(out))


def download_csv_from_zip(url):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            payload = response.read()
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return []
        raise RuntimeError(f"http_{exc.code}:{url}") from exc
    with zipfile.ZipFile(io.BytesIO(payload)) as zf:
        names = [name for name in zf.namelist() if name.lower().endswith(".csv")]
        if not names:
            raise RuntimeError(f"zip_without_csv:{url}")
        raw = zf.read(names[0]).decode("utf-8-sig", errors="replace")
    return list(csv.reader(io.StringIO(raw)))


def numeric(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def parse_kline_rows(rows):
    out = []
    for row in rows:
        if len(row) < 5:
            continue
        ts = numeric(row[0])
        close = numeric(row[4])
        if ts is None or close is None or close <= 0:
            continue
        out.append((normalize_ts(ts), float(close)))
    return out


def parse_funding_rows(rows):
    if not rows:
        return []
    header = [x.strip().lower() for x in rows[0]]
    has_header = any(x in {"calc_time", "funding_time", "fundingrate", "funding_rate", "last_funding_rate"} for x in header)
    out = []
    if has_header:
        idx_time = next((i for i, x in enumerate(header) if x in {"calc_time", "funding_time", "fundingtime"}), None)
        idx_rate = next((i for i, x in enumerate(header) if x in {"fundingrate", "funding_rate", "last_funding_rate"}), None)
        if idx_time is None or idx_rate is None:
            return []
        body = rows[1:]
        for row in body:
            if len(row) <= max(idx_time, idx_rate):
                continue
            ts, rate = numeric(row[idx_time]), numeric(row[idx_rate])
            if ts is None or rate is None:
                continue
            out.append((normalize_ts(ts), float(rate)))
        return out

    # Older archive variants are headerless. First field is timestamp; select the
    # small-magnitude numeric field after it (interval hours is usually 8, symbol is text).
    for row in rows:
        if len(row) < 2:
            continue
        ts = numeric(row[0])
        if ts is None:
            continue
        candidates = [numeric(x) for x in row[1:]]
        candidates = [x for x in candidates if x is not None and abs(x) < 0.1]
        if not candidates:
            continue
        out.append((normalize_ts(ts), float(candidates[-1])))
    return out


def urls(symbol, month):
    return {
        "funding": f"{BASE}/futures/um/monthly/fundingRate/{symbol}/{symbol}-fundingRate-{month}.zip",
        "spot": f"{BASE}/spot/monthly/klines/{symbol}/1h/{symbol}-1h-{month}.zip",
        "perp": f"{BASE}/futures/um/monthly/klines/{symbol}/1h/{symbol}-1h-{month}.zip",
    }


def fetch_symbol(symbol, months):
    tasks = []
    for month in months:
        for kind, url in urls(symbol, month).items():
            tasks.append((kind, month, url))
    results = {"funding": [], "spot": [], "perp": []}
    errors = []
    with ThreadPoolExecutor(max_workers=min(8, len(tasks))) as pool:
        futures = {pool.submit(download_csv_from_zip, url): (kind, month, url) for kind, month, url in tasks}
        for future in as_completed(futures):
            kind, month, url = futures[future]
            try:
                rows = future.result()
                parsed = parse_funding_rows(rows) if kind == "funding" else parse_kline_rows(rows)
                results[kind].extend(parsed)
            except Exception as exc:
                errors.append(f"{kind}:{month}:{exc}")
    for kind in results:
        results[kind] = sorted(dict(results[kind]).items())
    return results, errors


def latest_price_at(series, timestamp):
    lo, hi = 0, len(series) - 1
    best = None
    while lo <= hi:
        mid = (lo + hi) // 2
        if series[mid][0] <= timestamp:
            best = series[mid]
            lo = mid + 1
        else:
            hi = mid - 1
    if best is None or timestamp - best[0] > 2 * 60 * 60 * 1000:
        return None
    return best[1]


def align(data):
    spot, perp = data["spot"], data["perp"]
    rows = []
    for ts, rate in data["funding"]:
        spot_px = latest_price_at(spot, ts)
        perp_px = latest_price_at(perp, ts)
        if spot_px and perp_px and spot_px > 0 and perp_px > 0:
            rows.append({"t": ts, "rate": rate, "rateBps": rate * 10000.0, "spot": spot_px, "perp": perp_px})
    return rows


def trade_stats(trades):
    pnl = [float(x["netBps"]) for x in trades if math.isfinite(float(x["netBps"]))]
    wins = [x for x in pnl if x > 0]
    losses = [x for x in pnl if x < 0]
    gp, gl = sum(wins), abs(sum(losses))
    ev, sd = mean(pnl), stdev(pnl)
    curve = peak = max_dd = 0.0
    for value in pnl:
        curve += value
        peak = max(peak, curve)
        max_dd = max(max_dd, peak - curve)
    return {
        "trades": len(pnl),
        "samples": len(pnl),
        "expectancyBps": roundn(ev),
        "profitFactor": roundn(gp / gl) if gl > 0 else (99 if gp > 0 else None),
        "tStat": roundn(ev / (sd / math.sqrt(len(pnl)))) if ev is not None and sd and sd > 0 else None,
        "winRate": roundn(len(wins) / len(pnl)) if pnl else None,
        "maxDrawdownPct": roundn(max_dd / 100.0),
        "totalNetBps": roundn(sum(pnl)),
    }


def simulate(rows, horizon, start=0, end=None):
    end = len(rows) if end is None else min(end, len(rows))
    trades = []
    i = max(start + SIGNAL_LOOKBACK, SIGNAL_LOOKBACK)
    while i + horizon < end:
        signal = mean([row["rateBps"] for row in rows[i - SIGNAL_LOOKBACK:i]])
        current = rows[i]
        if signal is None or signal <= MIN_TRAILING_FUNDING_BPS or current["rateBps"] <= 0:
            i += 1
            continue
        exit_index = i + horizon
        exit_row = rows[exit_index]
        funding_bps = sum(row["rateBps"] for row in rows[i + 1:exit_index + 1])
        spot_return_bps = math.log(exit_row["spot"] / current["spot"]) * 10000.0
        short_perp_return_bps = -math.log(exit_row["perp"] / current["perp"]) * 10000.0
        basis_pnl_bps = spot_return_bps + short_perp_return_bps
        gross_bps = basis_pnl_bps + funding_bps
        net_bps = gross_bps - ROUND_TRIP_COST_BPS
        trades.append({
            "entryTime": current["t"], "exitTime": exit_row["t"], "horizonFundingEvents": horizon,
            "trailingFundingSignalBps": roundn(signal), "fundingReceivedBps": roundn(funding_bps),
            "spotReturnBps": roundn(spot_return_bps), "shortPerpReturnBps": roundn(short_perp_return_bps),
            "basisPnlBps": roundn(basis_pnl_bps), "grossBps": roundn(gross_bps),
            "roundTripCostBps": roundn(ROUND_TRIP_COST_BPS), "netBps": roundn(net_bps),
        })
        i = exit_index + 1
    return trades


def choose_horizon(rows, train_end):
    ranked = []
    for horizon in HORIZONS:
        trades = simulate(rows, horizon, 0, train_end)
        stats = trade_stats(trades)
        score = stats["expectancyBps"] * math.sqrt(stats["trades"]) if stats["trades"] >= 8 and stats["expectancyBps"] is not None else -math.inf
        ranked.append((score, horizon, stats))
    ranked.sort(reverse=True, key=lambda x: x[0])
    return ranked[0] if ranked else None


def passes_oos(validation, holdout):
    return (
        validation["trades"] >= 8 and holdout["trades"] >= 8
        and (validation["expectancyBps"] or -math.inf) > 0 and (holdout["expectancyBps"] or -math.inf) > 0
        and (validation["profitFactor"] or 0) >= 1.05 and (holdout["profitFactor"] or 0) >= 1.10
        and (holdout["tStat"] or -math.inf) >= 0.75
        and (holdout["maxDrawdownPct"] if holdout["maxDrawdownPct"] is not None else math.inf) <= 12
    )


def evaluate_symbol(symbol, months):
    data, errors = fetch_symbol(symbol, months)
    rows = align(data)
    if len(rows) < 120:
        return None, errors + [f"insufficient_aligned:{len(rows)}"]
    train_end, valid_end = int(len(rows) * 0.60), int(len(rows) * 0.80)
    selected = choose_horizon(rows, train_end)
    if selected is None or not math.isfinite(selected[0]):
        return {
            "symbol": symbol, "alignedFundingEvents": len(rows), "selectedHorizon": selected[1] if selected else None,
            "train": selected[2] if selected else trade_stats([]), "validation": trade_stats([]), "holdout": trade_stats([]),
            "oosTrades": 0, "passedOos": False, "evidenceQuality": 0.35, "evidenceStatus": "TRAIN_SAMPLE_INSUFFICIENT",
        }, errors
    _, horizon, train_stats = selected
    validation_trades = simulate(rows, horizon, train_end, valid_end)
    holdout_trades = simulate(rows, horizon, valid_end, len(rows))
    validation, holdout = trade_stats(validation_trades), trade_stats(holdout_trades)
    passed = passes_oos(validation, holdout)
    oos_trades = validation["trades"] + holdout["trades"]
    evidence_quality = min(0.95, 0.72 + min(oos_trades, 60) / 260) if passed else min(0.59, 0.40 + min(oos_trades, 40) / 220)
    latest = rows[-1]
    recent_mean = mean([x["rateBps"] for x in rows[-SIGNAL_LOOKBACK:]])
    return {
        "symbol": symbol,
        "archiveMonths": months,
        "alignedFundingEvents": len(rows),
        "selectedHorizon": horizon,
        "latestFundingBps": roundn(latest["rateBps"]),
        "recentMeanFundingBps": roundn(recent_mean),
        "latestBasisBps": roundn(math.log(latest["perp"] / latest["spot"]) * 10000.0),
        "train": train_stats,
        "validation": validation,
        "holdout": holdout,
        "oosTrades": oos_trades,
        "passedOos": passed,
        "evidenceQuality": roundn(evidence_quality),
        "evidenceStatus": "DELTA_NEUTRAL_CARRY_OOS_PASS" if passed else "DELTA_NEUTRAL_CARRY_OOS_FAIL",
        "recentHoldoutTrades": holdout_trades[-5:],
    }, errors


def main():
    months = completed_months(MONTHS_BACK)
    candidates, errors = [], []
    for symbol in SYMBOLS:
        try:
            candidate, symbol_errors = evaluate_symbol(symbol, months)
            errors.extend([f"{symbol}:{x}" for x in symbol_errors])
            if candidate:
                candidates.append(candidate)
        except Exception as exc:
            errors.append(f"{symbol}:{exc}")
    candidates.sort(key=lambda x: (bool(x.get("passedOos")), x.get("holdout", {}).get("expectancyBps") if x.get("holdout", {}).get("expectancyBps") is not None else -math.inf), reverse=True)
    best = candidates[0] if candidates else None
    output = {
        "ok": True,
        "version": VERSION,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "mode": "RESEARCH_ONLY",
        "paperOnly": True,
        "executionAuthority": False,
        "liveLocked": True,
        "liveOrders": False,
        "methodology": {
            "source": "Official Binance Vision monthly archives: USD-M funding + spot 1h + perpetual 1h",
            "archiveMonths": months,
            "symbols": SYMBOLS,
            "split": "60% train / 20% validation / 20% holdout",
            "signal": f"prior {SIGNAL_LOOKBACK} funding events mean > {MIN_TRAILING_FUNDING_BPS} bps and current funding > 0",
            "horizonsFundingEvents": HORIZONS,
            "horizonSelection": "train only; frozen for validation and holdout",
            "trade": "long spot + short USD-M perpetual, equal-notional log-return approximation",
            "pnl": "spot return - perp return + funding received - explicit entry/exit fees and slippage reserve",
            "spotTakerBpsPerSide": SPOT_TAKER_BPS_PER_SIDE,
            "perpTakerBpsPerSide": PERP_TAKER_BPS_PER_SIDE,
            "slippageReserveBps": SLIPPAGE_RESERVE_BPS,
            "roundTripCostBps": ROUND_TRIP_COST_BPS,
            "negativeFundingPolicy": "FAIL_CLOSED: no short-spot/long-perp because borrow cost/availability is not modeled",
            "limitation": "Historical delta-neutral approximation; no margin/liquidation-path model or fee-tier discounts; no real positions are opened.",
        },
        "testedSymbols": len(candidates),
        "oosPassCount": sum(1 for x in candidates if x.get("passedOos")),
        "candidates": candidates,
        "best": best,
        "sleeve": {
            "sleeveKey": "FUNDING_CARRY",
            "engineVersion": VERSION,
            "samples": best.get("oosTrades", 0),
            "expectancyBps": best.get("holdout", {}).get("expectancyBps"),
            "profitFactor": best.get("holdout", {}).get("profitFactor"),
            "tStat": best.get("holdout", {}).get("tStat"),
            "maxDrawdownPct": best.get("holdout", {}).get("maxDrawdownPct"),
            "evidenceQuality": best.get("evidenceQuality", 0),
            "paperCapitalEligible": bool(best.get("passedOos")),
        } if best else None,
        "errors": errors[:50],
        "invariants": {"signsTransactions": False, "broadcastsTransactions": False, "unlocksLive": False},
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "version": VERSION,
        "testedSymbols": output["testedSymbols"],
        "oosPassCount": output["oosPassCount"],
        "best": {"symbol": best["symbol"], "selectedHorizon": best.get("selectedHorizon"), "validation": best.get("validation"), "holdout": best.get("holdout"), "passedOos": best.get("passedOos")} if best else None,
        "errors": len(output["errors"]),
    }))


if __name__ == "__main__":
    main()
