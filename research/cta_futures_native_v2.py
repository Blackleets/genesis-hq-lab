#!/usr/bin/env python3
import argparse
import csv
import hashlib
import io
import json
import math
import random
import sys
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import requests

ROOT = "https://data.binance.vision/data/futures/um"
MONTHLY = ROOT + "/monthly"
DAILY = ROOT + "/daily"
USER_AGENT = "GenesisHQ-Research/cta-futures-native-v2"
REQUEST_TIMEOUT = 30
MAX_RETRIES = 3

@dataclass(frozen=True)
class ArchiveSpec:
    kind: str
    symbol: str
    period: str
    url: str

def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def get_bytes(url: str) -> bytes:
    last = None
    for attempt in range(MAX_RETRIES):
        try:
            r = requests.get(url, timeout=REQUEST_TIMEOUT, headers={"User-Agent": USER_AGENT})
            if r.status_code == 404:
                raise FileNotFoundError(url)
            r.raise_for_status()
            return r.content
        except FileNotFoundError:
            raise
        except Exception as exc:
            last = exc
            if attempt + 1 < MAX_RETRIES:
                time.sleep(0.4 * (2 ** attempt))
    raise RuntimeError(f"download_failed:{url}:{type(last).__name__}:{last}")

def download_verified(spec: ArchiveSpec) -> dict[str, Any]:
    record = {"kind": spec.kind, "symbol": spec.symbol, "period": spec.period, "url": spec.url}
    try:
        checksum_raw = get_bytes(spec.url + ".CHECKSUM").decode("utf-8").strip()
        expected = checksum_raw.split()[0].lower()
        payload = get_bytes(spec.url)
        actual = sha256_bytes(payload)
        if actual != expected:
            raise RuntimeError(f"checksum_mismatch:{expected}:{actual}")
        record.update({"ok": True, "sha256": actual, "bytes": len(payload), "payload": payload})
    except FileNotFoundError:
        record.update({"ok": False, "missing": True, "error": "HTTP_404"})
    except Exception as exc:
        record.update({"ok": False, "missing": False, "error": f"{type(exc).__name__}:{exc}"})
    return record

def month_range(start: pd.Timestamp, end_exclusive: pd.Timestamp) -> list[str]:
    periods = pd.period_range(start=start.to_period("M"), end=(end_exclusive - pd.Timedelta(seconds=1)).to_period("M"), freq="M")
    return [str(p) for p in periods]

def day_range(start: pd.Timestamp, end_exclusive: pd.Timestamp) -> list[str]:
    days = pd.date_range(start=start.normalize(), end=(end_exclusive - pd.Timedelta(days=1)).normalize(), freq="D", tz="UTC")
    return [d.strftime("%Y-%m-%d") for d in days]

def monthly_url(kind: str, symbol: str, month: str) -> str:
    if kind == "mark":
        return f"{MONTHLY}/markPriceKlines/{symbol}/1h/{symbol}-1h-{month}.zip"
    if kind == "index":
        return f"{MONTHLY}/indexPriceKlines/{symbol}/1h/{symbol}-1h-{month}.zip"
    if kind == "premium":
        return f"{MONTHLY}/premiumIndexKlines/{symbol}/1h/{symbol}-1h-{month}.zip"
    if kind == "funding":
        return f"{MONTHLY}/fundingRate/{symbol}/{symbol}-fundingRate-{month}.zip"
    raise ValueError(kind)

def oi_url(symbol: str, day: str) -> str:
    return f"{DAILY}/metrics/{symbol}/{symbol}-metrics-{day}.zip"

def unzip_text(payload: bytes) -> str:
    with zipfile.ZipFile(io.BytesIO(payload)) as zf:
        names = zf.namelist()
        if not names:
            raise RuntimeError("empty_zip")
        return zf.read(names[0]).decode("utf-8-sig")

def parse_kline_archive(payload: bytes) -> pd.DataFrame:
    rows = list(csv.reader(io.StringIO(unzip_text(payload))))
    if not rows:
        return pd.DataFrame(columns=["time", "close"])
    first = rows[0]
    has_header = not first[0].lstrip("-").isdigit()
    data = rows[1:] if has_header else rows
    parsed = []
    for row in data:
        if len(row) < 7:
            continue
        try:
            close_time_ms = int(float(row[6]))
            close = float(row[4])
        except Exception:
            continue
        ts = pd.to_datetime(close_time_ms + 1, unit="ms", utc=True)
        parsed.append((ts, close))
    if not parsed:
        return pd.DataFrame(columns=["time", "close"])
    return pd.DataFrame(parsed, columns=["time", "close"]).drop_duplicates("time", keep="last").sort_values("time")

def parse_funding_archive(payload: bytes) -> pd.DataFrame:
    rows = list(csv.reader(io.StringIO(unzip_text(payload))))
    if not rows:
        return pd.DataFrame(columns=["time", "rate"])
    header = [str(x).strip() for x in rows[0]]
    has_header = "calc_time" in header or not rows[0][0].lstrip("-").isdigit()
    data = rows[1:] if has_header else rows
    parsed = []
    for row in data:
        if len(row) < 3:
            continue
        try:
            ts_raw = int(float(row[0]))
            rate = float(row[2])
        except Exception:
            continue
        unit = "us" if ts_raw > 10**14 else "ms"
        ts = pd.to_datetime(ts_raw, unit=unit, utc=True)
        parsed.append((ts, rate))
    if not parsed:
        return pd.DataFrame(columns=["time", "rate"])
    return pd.DataFrame(parsed, columns=["time", "rate"]).drop_duplicates("time", keep="last").sort_values("time")

def parse_oi_archive(payload: bytes) -> pd.DataFrame:
    reader = csv.DictReader(io.StringIO(unzip_text(payload)))
    parsed = []
    for row in reader:
        raw_time = row.get("create_time")
        raw_oi = row.get("sum_open_interest_value")
        if raw_time is None or raw_oi is None:
            continue
        try:
            ts = pd.to_datetime(raw_time, utc=True)
            oi = float(raw_oi)
        except Exception:
            continue
        parsed.append((ts, oi))
    if not parsed:
        return pd.DataFrame(columns=["time", "oi_usd"])
    df = pd.DataFrame(parsed, columns=["time", "oi_usd"]).drop_duplicates("time", keep="last").sort_values("time")
    df["hour"] = df["time"].dt.floor("h") + pd.Timedelta(hours=1)
    return df.groupby("hour", as_index=False)["oi_usd"].last().rename(columns={"hour": "time"})

def compact_record(record: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in record.items() if k != "payload"}

def load_manifest(path: Path) -> dict[str, Any]:
    manifest = json.loads(path.read_text())
    required = ["proposalId", "hypothesisFingerprint", "backtestAllowed", "researchComputeAuthority", "executionAuthority", "capitalEligible", "liveOrders"]
    missing = [k for k in required if k not in manifest]
    if missing:
        raise RuntimeError(f"manifest_missing:{','.join(missing)}")
    if manifest["backtestAllowed"] is not True or manifest["researchComputeAuthority"] is not True:
        raise RuntimeError("research_compute_not_authorized")
    if any(manifest[k] is True for k in ["executionAuthority", "capitalEligible", "liveOrders"]):
        raise RuntimeError("manifest_illegal_execution_authority")
    return manifest

def download_market_archives(symbols: list[str], months: list[str], workers: int):
    specs = [ArchiveSpec(kind, symbol, month, monthly_url(kind, symbol, month)) for symbol in symbols for month in months for kind in ("mark", "index", "premium", "funding")]
    records = []
    raw = {(symbol, month): {} for symbol in symbols for month in months}
    print(f"MARKET_ARCHIVES_EXPECTED {len(specs)}")
    with ThreadPoolExecutor(max_workers=min(workers, 24)) as pool:
        futures = {pool.submit(download_verified, spec): spec for spec in specs}
        done = 0
        for fut in as_completed(futures):
            rec = fut.result()
            done += 1
            if rec.get("ok"):
                try:
                    frame = parse_funding_archive(rec["payload"]) if rec["kind"] == "funding" else parse_kline_archive(rec["payload"])
                    if frame.empty:
                        raise RuntimeError("empty_parsed_frame")
                    raw[(rec["symbol"], rec["period"])][rec["kind"]] = frame
                except Exception as exc:
                    rec["ok"] = False
                    rec["error"] = f"parse_failed:{type(exc).__name__}:{exc}"
            records.append(compact_record(rec))
            if done % 100 == 0 or done == len(specs):
                print(f"MARKET_PROGRESS {done}/{len(specs)}")
    return raw, records

def download_oi_archives(symbols: list[str], days: list[str], workers: int):
    specs = [ArchiveSpec("oi", symbol, day, oi_url(symbol, day)) for symbol in symbols for day in days]
    frames = {s: [] for s in symbols}
    records = []
    print(f"OI_ARCHIVES_EXPECTED {len(specs)}")
    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        futures = {pool.submit(download_verified, spec): spec for spec in specs}
        done = 0
        for fut in as_completed(futures):
            rec = fut.result()
            done += 1
            if rec.get("ok"):
                try:
                    frame = parse_oi_archive(rec["payload"])
                    if frame.empty:
                        raise RuntimeError("empty_oi_frame")
                    frames[rec["symbol"]].append(frame)
                except Exception as exc:
                    rec["ok"] = False
                    rec["error"] = f"parse_failed:{type(exc).__name__}:{exc}"
            records.append(compact_record(rec))
            if done % 250 == 0 or done == len(specs):
                print(f"OI_PROGRESS {done}/{len(specs)}")
    return frames, records

def combine_symbol_data(symbol, months, market_raw, oi_frames, start, end, max_oi_gap_hours):
    pieces = {k: [] for k in ("mark", "index", "premium", "funding")}
    for month in months:
        group = market_raw.get((symbol, month), {})
        for kind in pieces:
            if kind in group:
                pieces[kind].append(group[kind])
    series = {}
    for kind in ("mark", "index", "premium"):
        if not pieces[kind]:
            raise RuntimeError(f"{symbol}:missing_{kind}_data")
        df = pd.concat(pieces[kind], ignore_index=True).drop_duplicates("time", keep="last").sort_values("time")
        series[kind] = df.set_index("time")["close"].astype(float)
    funding = pd.concat(pieces["funding"], ignore_index=True).drop_duplicates("time", keep="last").sort_values("time") if pieces["funding"] else pd.DataFrame(columns=["time", "rate"])
    if not oi_frames:
        raise RuntimeError(f"{symbol}:missing_oi_data")
    oi = pd.concat(oi_frames, ignore_index=True).drop_duplicates("time", keep="last").sort_values("time").set_index("time")["oi_usd"].astype(float)
    idx = pd.date_range(start=start, end=end - pd.Timedelta(hours=1), freq="1h", tz="UTC") + pd.Timedelta(hours=1)
    df = pd.DataFrame(index=idx)
    df["mark"] = series["mark"].reindex(idx)
    df["index"] = series["index"].reindex(idx)
    df["premium"] = series["premium"].reindex(idx)
    df["oi_raw"] = oi.reindex(idx)
    df["oi"] = df["oi_raw"].ffill(limit=max_oi_gap_hours)
    df["basis_bps"] = (df["mark"] / df["index"] - 1.0) * 10000.0
    df["mark_ret_1h"] = df["mark"].pct_change(fill_method=None)
    return df, funding[(funding["time"] >= start) & (funding["time"] < end)].copy()

def max_drawdown_pct(returns: pd.Series) -> float:
    if returns.empty:
        return 0.0
    equity = (1.0 + returns.fillna(0.0)).cumprod()
    peak = equity.cummax()
    return float((1.0 - equity / peak).max() * 100.0)

def percentile(values, q):
    return None if not values else float(np.quantile(np.asarray(values, dtype=float), q))

def episode_metrics(episodes, portfolio_returns, mc_iterations, mc_seed):
    vals = np.asarray([float(e["return"]) for e in episodes], dtype=float)
    n = len(vals)
    wins = vals[vals > 0]
    losses = vals[vals < 0]
    gross_profit = float(wins.sum()) if len(wins) else 0.0
    gross_loss = float(abs(losses.sum())) if len(losses) else 0.0
    mean_ret = float(vals.mean()) if n else None
    sigma = float(vals.std(ddof=1)) if n >= 2 else None
    tstat = (mean_ret / (sigma / math.sqrt(n))) if n >= 2 and sigma and sigma > 0 else None
    ordered = sorted(episodes, key=lambda x: x["closedAt"])
    half = n // 2
    h1 = [float(e["return"]) for e in ordered[:half]]
    h2 = [float(e["return"]) for e in ordered[half:]]
    rng = random.Random(mc_seed)
    totals = []
    if n:
        for _ in range(mc_iterations):
            totals.append(sum(vals[rng.randrange(n)] for _ in range(n)) * 100.0)
    return {
        "n": n,
        "wins": int(len(wins)),
        "losses": int(len(losses)),
        "winRate": round(float(len(wins) / n), 6) if n else None,
        "profitFactor": round(gross_profit / gross_loss, 6) if gross_loss > 0 else None,
        "expectancyPct": round(mean_ret * 100.0, 6) if mean_ret is not None else None,
        "tStat": round(float(tstat), 6) if tstat is not None else None,
        "maxDrawdownPct": round(max_drawdown_pct(portfolio_returns), 6),
        "half1ExpectancyPct": round(float(np.mean(h1)) * 100.0, 6) if h1 else None,
        "half2ExpectancyPct": round(float(np.mean(h2)) * 100.0, 6) if h2 else None,
        "mcP5TotalReturnPct": round(percentile(totals, 0.05), 6) if totals else None,
        "portfolioTotalReturnPct": round(float(((1.0 + portfolio_returns.fillna(0.0)).prod() - 1.0) * 100.0), 6),
        "portfolioHourlyObservations": int(portfolio_returns.notna().sum())
    }

def gate_metrics(metrics, gates, fold_expectancies):
    pf = metrics.get("profitFactor")
    items = [
        {"code": "MIN_TRADES", "pass": metrics["n"] >= gates["minTrades"], "observed": metrics["n"], "required": gates["minTrades"]},
        {"code": "WIN_RATE", "pass": metrics["winRate"] is not None and metrics["winRate"] >= gates["minWinRate"], "observed": metrics["winRate"], "required": gates["minWinRate"]},
        {"code": "PROFIT_FACTOR", "pass": pf is not None and pf >= gates["minProfitFactor"], "observed": pf, "required": gates["minProfitFactor"]},
        {"code": "EXPECTANCY", "pass": metrics["expectancyPct"] is not None and metrics["expectancyPct"] >= gates["minExpectancyPct"], "observed": metrics["expectancyPct"], "required": gates["minExpectancyPct"]},
        {"code": "T_STAT", "pass": metrics["tStat"] is not None and metrics["tStat"] >= gates["minTStat"], "observed": metrics["tStat"], "required": gates["minTStat"]},
        {"code": "MAX_DRAWDOWN", "pass": metrics["maxDrawdownPct"] <= gates["maxDrawdownPct"], "observed": metrics["maxDrawdownPct"], "required": gates["maxDrawdownPct"]},
        {"code": "TEMPORAL_HALVES", "pass": metrics["half1ExpectancyPct"] is not None and metrics["half1ExpectancyPct"] > 0 and metrics["half2ExpectancyPct"] is not None and metrics["half2ExpectancyPct"] > 0, "observed": [metrics["half1ExpectancyPct"], metrics["half2ExpectancyPct"]], "required": "both_positive"},
        {"code": "MC_P5", "pass": metrics["mcP5TotalReturnPct"] is not None and metrics["mcP5TotalReturnPct"] > 0, "observed": metrics["mcP5TotalReturnPct"], "required": ">0"}
    ]
    positive_folds = sum(1 for x in fold_expectancies if x is not None and x > 0)
    items.append({"code": "VALIDATION_FOLDS", "pass": positive_folds >= gates["minPositiveValidationFolds"], "observed": {"positive": positive_folds, "expectancyPct": fold_expectancies}, "required": f">={gates['minPositiveValidationFolds']}/{gates['validationFolds']}_positive"})
    return {"pass": all(i["pass"] for i in items), "passed": sum(i["pass"] for i in items), "total": len(items), "gates": items}

def build_features(data, manifest):
    sig = manifest["signal"]
    horizons = sig["trendHorizonsHours"]
    out = {}
    for symbol, df0 in data.items():
        df = df0.copy()
        for h in horizons:
            df[f"ret_{h}h"] = df["mark"] / df["mark"].shift(h) - 1.0
        signs = pd.DataFrame({h: np.sign(df[f"ret_{h}h"]) for h in horizons}, index=df.index)
        pos_votes = (signs > 0).sum(axis=1)
        neg_votes = (signs < 0).sum(axis=1)
        raw = pd.Series(0.0, index=df.index)
        raw[pos_votes >= sig["agreementMin"]] = 1.0
        raw[neg_votes >= sig["agreementMin"]] = -1.0
        df["oi_change"] = df["oi"] / df["oi"].shift(sig["oiLookbackHours"]) - 1.0
        vol = df["mark_ret_1h"].rolling(sig["volLookbackHours"], min_periods=sig["volLookbackHours"]).std(ddof=1)
        df["realized_vol_hourly"] = vol
        valid = df["mark"].notna() & df["index"].notna() & df["oi"].notna() & (df["oi"] >= sig["minOiUsd"]) & vol.notna()
        if sig["requireOiGrowth"]:
            valid &= df["oi_change"] > 0
        df["signal"] = 0.0
        df.loc[valid & (raw > 0) & (df["basis_bps"] <= sig["maxLongBasisBps"]), "signal"] = 1.0
        df.loc[valid & (raw < 0) & (df["basis_bps"] >= sig["minShortBasisBps"]), "signal"] = -1.0
        out[symbol] = df
    return out

def funding_by_hour(funding, start, end):
    result = {}
    if funding.empty:
        return result
    for _, row in funding.iterrows():
        ts = pd.Timestamp(row["time"])
        if ts < start or ts >= end:
            continue
        hour = ts.ceil("h")
        result[hour] = result.get(hour, 0.0) + float(row["rate"])
    return result

def simulate_split(features, funding, start, end, manifest, label):
    symbols = manifest["dataPolicy"]["symbols"]
    sig = manifest["signal"]
    one_way = manifest["costs"]["oneWayBpsPerUnitTurnover"] / 10000.0
    idx = pd.date_range(start=start, end=end, freq="1h", tz="UTC")
    fund_maps = {s: funding_by_hour(funding[s], start, end) for s in symbols}
    weights = {s: 0.0 for s in symbols}
    episode_state = {s: None for s in symbols}
    episodes = []
    portfolio_returns = []

    def close_episode(symbol, ts, close_cost):
        ep = episode_state[symbol]
        if ep is None:
            return
        ep["return"] += close_cost
        ep["closedAt"] = ts.isoformat()
        ep["exitCostReturn"] = close_cost
        episodes.append(ep)
        episode_state[symbol] = None

    def open_episode(symbol, ts, sign, weight, open_cost):
        episode_state[symbol] = {"symbol": symbol, "side": "LONG" if sign > 0 else "SHORT", "openedAt": ts.isoformat(), "closedAt": None, "return": open_cost, "entryWeight": abs(weight), "entryCostReturn": open_cost, "exitCostReturn": 0.0}

    prev_ts = None
    for ts in idx:
        step_total = 0.0
        if prev_ts is not None:
            for s in symbols:
                df = features[s]
                if prev_ts in df.index and ts in df.index:
                    p0, p1 = df.at[prev_ts, "mark"], df.at[ts, "mark"]
                    if pd.notna(p0) and pd.notna(p1) and p0 != 0:
                        c = weights[s] * float(p1 / p0 - 1.0)
                        step_total += c
                        if episode_state[s] is not None:
                            episode_state[s]["return"] += c
                rate = fund_maps[s].get(ts, 0.0)
                if rate:
                    c = -weights[s] * rate
                    step_total += c
                    if episode_state[s] is not None:
                        episode_state[s]["return"] += c
        elapsed_h = int((ts - start).total_seconds() // 3600)
        if elapsed_h >= 0 and elapsed_h % sig["rebalanceHours"] == 0 and ts < end:
            desired_raw, inv_vol = {}, {}
            for s in symbols:
                df = features[s]
                if ts not in df.index:
                    desired_raw[s] = 0.0
                    continue
                signal = float(df.at[ts, "signal"]) if pd.notna(df.at[ts, "signal"]) else 0.0
                vol = float(df.at[ts, "realized_vol_hourly"]) if pd.notna(df.at[ts, "realized_vol_hourly"]) else float("nan")
                desired_raw[s] = signal
                if signal != 0 and math.isfinite(vol) and vol > 0:
                    inv_vol[s] = 1.0 / vol
            denom = sum(inv_vol.values())
            desired = {s: (desired_raw[s] * inv_vol.get(s, 0.0) / denom if denom > 0 else 0.0) for s in symbols}
            for s in symbols:
                old, new = weights[s], desired[s]
                old_sign = 1 if old > 1e-12 else -1 if old < -1e-12 else 0
                new_sign = 1 if new > 1e-12 else -1 if new < -1e-12 else 0
                if old_sign == new_sign and old_sign != 0:
                    cost = -one_way * abs(new - old)
                    step_total += cost
                    if episode_state[s] is not None:
                        episode_state[s]["return"] += cost
                elif old_sign != new_sign:
                    if old_sign != 0:
                        close_cost = -one_way * abs(old)
                        step_total += close_cost
                        close_episode(s, ts, close_cost)
                    if new_sign != 0:
                        open_cost = -one_way * abs(new)
                        step_total += open_cost
                        open_episode(s, ts, new_sign, new, open_cost)
                weights[s] = new
        portfolio_returns.append((ts, step_total))
        prev_ts = ts
    closing_cost_total = 0.0
    for s in symbols:
        if abs(weights[s]) > 1e-12:
            close_cost = -one_way * abs(weights[s])
            closing_cost_total += close_cost
            close_episode(s, end, close_cost)
            weights[s] = 0.0
    if portfolio_returns:
        last_ts, last_val = portfolio_returns[-1]
        if last_ts == end:
            portfolio_returns[-1] = (last_ts, last_val + closing_cost_total)
        else:
            portfolio_returns.append((end, closing_cost_total))
    return {"label": label, "episodes": episodes, "portfolioReturns": pd.Series({ts: value for ts, value in portfolio_returns}).sort_index()}

def fold_expectancies(episodes, start, end, n_folds):
    total_seconds = (end - start).total_seconds()
    results = []
    for i in range(n_folds):
        a = start + pd.Timedelta(seconds=total_seconds * i / n_folds)
        b = start + pd.Timedelta(seconds=total_seconds * (i + 1) / n_folds)
        vals = [float(e["return"]) for e in episodes if a <= pd.Timestamp(e["closedAt"]) < b]
        results.append(round(float(np.mean(vals)) * 100.0, 6) if vals else None)
    return results

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", default="research/cta_futures_native_v2_manifest.json")
    ap.add_argument("--output", default="evidence-cta-v2")
    ap.add_argument("--workers", type=int, default=24)
    args = ap.parse_args()
    manifest = load_manifest(Path(args.manifest))
    outdir = Path(args.output)
    outdir.mkdir(parents=True, exist_ok=True)
    symbols = manifest["dataPolicy"]["symbols"]
    start, end = pd.Timestamp(manifest["dataPolicy"]["start"]), pd.Timestamp(manifest["dataPolicy"]["end"])
    months, days = month_range(start, end), day_range(start, end)
    print("EVIDENCE_UTC", datetime.now(timezone.utc).isoformat())
    print("STRATEGY", manifest["strategyName"], manifest["strategyVersion"])
    print("PROPOSAL_ID", manifest["proposalId"])
    print("HYPOTHESIS_FINGERPRINT", manifest["hypothesisFingerprint"])
    print("BACKTEST_ALLOWED", manifest["backtestAllowed"])
    print("EXECUTION_AUTHORITY", manifest["executionAuthority"])
    print("DATA_WINDOW", start.isoformat(), end.isoformat())
    print("SYMBOLS", ",".join(symbols))
    print("SOURCE BINANCE_VISION_OFFICIAL")
    print("CHECKSUM_POLICY REQUIRED")

    market_raw, market_records = download_market_archives(symbols, months, args.workers)
    oi_frames, oi_records = download_oi_archives(symbols, days, args.workers)
    market_expected = len(symbols) * len(months) * 4
    market_ok = sum(1 for r in market_records if r.get("ok"))
    market_checksum_fail = sum(1 for r in market_records if not r.get("ok") and not r.get("missing"))
    oi_expected = {s: len(days) for s in symbols}
    oi_ok = {s: sum(1 for r in oi_records if r["symbol"] == s and r.get("ok")) for s in symbols}
    oi_missing = {s: [r["period"] for r in oi_records if r["symbol"] == s and not r.get("ok")] for s in symbols}
    coverage = {
        "market": {"expected": market_expected, "ok": market_ok, "coverage": market_ok / market_expected, "hardFailures": market_checksum_fail},
        "oi": {s: {"expected": oi_expected[s], "ok": oi_ok[s], "coverage": oi_ok[s] / oi_expected[s], "missingDays": oi_missing[s]} for s in symbols}
    }
    coverage_pass = coverage["market"]["coverage"] >= manifest["dataPolicy"]["monthlyMarketCoverageRequired"] and coverage["market"]["hardFailures"] == 0 and all(coverage["oi"][s]["coverage"] >= manifest["dataPolicy"]["minOiDailyArchiveCoverage"] for s in symbols) and all(not any(not r.get("missing") for r in oi_records if r["symbol"] == s and not r.get("ok")) for s in symbols)
    print("DATA_COVERAGE", json.dumps({"market": coverage["market"], "oi": {s: {k:v for k,v in coverage["oi"][s].items() if k != "missingDays"} for s in symbols}, "pass": coverage_pass}, sort_keys=True))
    source_records = sorted([{"kind": r["kind"], "symbol": r["symbol"], "period": r["period"], "sha256": r.get("sha256"), "ok": r.get("ok"), "error": r.get("error")} for r in market_records + oi_records], key=lambda x: (x["kind"], x["symbol"], x["period"]))
    source_hash = hashlib.sha256(json.dumps(source_records, separators=(",", ":"), sort_keys=True).encode()).hexdigest()
    (outdir / "data_coverage.json").write_text(json.dumps({"coverage": coverage, "sourceRecords": source_records, "sourceEvidenceHashSha256": source_hash}, indent=2, sort_keys=True))
    if not coverage_pass:
        report = {"ok": False, "verdict": "DATA_COVERAGE_BLOCKED", "holdoutState": "SEALED", "sourceEvidenceHashSha256": source_hash, "coverage": coverage, "executionAuthority": False, "capitalEligible": False, "liveOrders": False}
        (outdir / "cta_futures_native_v2_report.json").write_text(json.dumps(report, indent=2, sort_keys=True))
        print("VERDICT DATA_COVERAGE_BLOCKED")
        return 3

    data, funding = {}, {}
    for s in symbols:
        frame, fund = combine_symbol_data(s, months, market_raw, oi_frames[s], start, end, manifest["dataPolicy"]["maxOiGapHours"])
        data[s], funding[s] = frame, fund
        frame.reset_index(names="time").to_csv(outdir / f"{s}_hourly_normalized.csv.gz", index=False, compression="gzip")
        print("NORMALIZED", s, "rows=" + str(len(frame)), "mark_nonnull=" + str(int(frame["mark"].notna().sum())), "oi_nonnull=" + str(int(frame["oi"].notna().sum())))

    features = build_features(data, manifest)
    total_seconds = (end - start).total_seconds()
    dev_end = start + pd.Timedelta(seconds=total_seconds * manifest["validation"]["split"]["development"])
    val_end = dev_end + pd.Timedelta(seconds=total_seconds * manifest["validation"]["split"]["validation"])
    dev_sim = simulate_split(features, funding, start, dev_end, manifest, "development")
    val_sim = simulate_split(features, funding, dev_end, val_end, manifest, "validation")
    gates, mc = manifest["validation"]["gates"], manifest["validation"]["monteCarlo"]
    dev_folds = fold_expectancies(dev_sim["episodes"], start, dev_end, gates["validationFolds"])
    val_folds = fold_expectancies(val_sim["episodes"], dev_end, val_end, gates["validationFolds"])
    dev_metrics = episode_metrics(dev_sim["episodes"], dev_sim["portfolioReturns"], mc["iterations"], mc["seed"])
    val_metrics = episode_metrics(val_sim["episodes"], val_sim["portfolioReturns"], mc["iterations"], mc["seed"])
    validation_gate = gate_metrics(val_metrics, gates, val_folds)
    print("DEVELOPMENT", json.dumps(dev_metrics, sort_keys=True))
    print("VALIDATION", json.dumps(val_metrics, sort_keys=True))
    print("VALIDATION_FOLDS", json.dumps(val_folds))
    print("VALIDATION_GATE", json.dumps({"pass": validation_gate["pass"], "passed": validation_gate["passed"], "total": validation_gate["total"]}, sort_keys=True))

    holdout_state, holdout_metrics, holdout_gate, holdout_episodes = "SEALED", None, None, None
    if validation_gate["pass"]:
        hold_sim = simulate_split(features, funding, val_end, end, manifest, "holdout")
        hold_folds = fold_expectancies(hold_sim["episodes"], val_end, end, gates["validationFolds"])
        holdout_metrics = episode_metrics(hold_sim["episodes"], hold_sim["portfolioReturns"], mc["iterations"], mc["seed"] + 1)
        holdout_gate = gate_metrics(holdout_metrics, gates, hold_folds)
        holdout_state, holdout_episodes = "EVALUATED_ONCE", hold_sim["episodes"]
        print("HOLDOUT", json.dumps(holdout_metrics, sort_keys=True))
        print("HOLDOUT_GATE", json.dumps({"pass": holdout_gate["pass"], "passed": holdout_gate["passed"], "total": holdout_gate["total"]}, sort_keys=True))
    else:
        print("HOLDOUT SEALED_VALIDATION_FAILED")
    verdict = "RESEARCH_GO" if validation_gate["pass"] and holdout_gate and holdout_gate["pass"] else "NO_GO"
    report = {
        "ok": True, "engineVersion": "cta_futures_native_v2", "family": manifest["family"], "strategyName": manifest["strategyName"], "strategyVersion": manifest["strategyVersion"], "proposalId": manifest["proposalId"], "hypothesisFingerprint": manifest["hypothesisFingerprint"], "source": "BINANCE_VISION_OFFICIAL", "sourceEvidenceHashSha256": source_hash, "coverage": coverage,
        "splitPolicy": {"development": [start.isoformat(), dev_end.isoformat()], "validation": [dev_end.isoformat(), val_end.isoformat()], "holdout": [val_end.isoformat(), end.isoformat()], "holdoutEvaluatedOnlyIfValidationPasses": True, "forceFlatAtBoundaries": True},
        "development": dev_metrics, "developmentFoldsExpectancyPct": dev_folds, "validation": val_metrics, "validationFoldsExpectancyPct": val_folds, "validationGate": validation_gate, "holdout": holdout_metrics, "holdoutGate": holdout_gate, "holdoutState": holdout_state, "verdict": verdict, "executionAuthority": False, "capitalEligible": False, "liveOrders": False
    }
    (outdir / "cta_futures_native_v2_report.json").write_text(json.dumps(report, indent=2, sort_keys=True))
    (outdir / "development_episodes.json").write_text(json.dumps(dev_sim["episodes"], indent=2))
    (outdir / "validation_episodes.json").write_text(json.dumps(val_sim["episodes"], indent=2))
    if holdout_episodes is not None:
        (outdir / "holdout_episodes.json").write_text(json.dumps(holdout_episodes, indent=2))
    print("VERDICT", verdict)
    print("HOLDOUT_STATE", holdout_state)
    print("SOURCE_EVIDENCE_SHA256", source_hash)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
