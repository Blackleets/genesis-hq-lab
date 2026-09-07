#!/usr/bin/env python3
import argparse
import csv
import hashlib
import io
import json
import sys
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import numpy as np
import pandas as pd
import requests

ROOT = "https://data.binance.vision/data/futures/um/monthly"
UA = "GenesisHQ-Research/intraday-range-expansion-v2"
TIMEOUT = 30
RETRIES = 3


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
    for attempt in range(RETRIES):
        try:
            r = requests.get(url, timeout=TIMEOUT, headers={"User-Agent": UA})
            if r.status_code == 404:
                raise FileNotFoundError(url)
            r.raise_for_status()
            return r.content
        except FileNotFoundError:
            raise
        except Exception as exc:
            last = exc
            if attempt + 1 < RETRIES:
                time.sleep(0.5 * (2 ** attempt))
    raise RuntimeError(f"download_failed:{url}:{type(last).__name__}:{last}")


def archive_url(kind: str, symbol: str, month: str) -> str:
    folder = "markPriceKlines" if kind == "mark" else "indexPriceKlines"
    return f"{ROOT}/{folder}/{symbol}/5m/{symbol}-5m-{month}.zip"


def download_verified(kind: str, symbol: str, month: str) -> dict:
    url = archive_url(kind, symbol, month)
    rec = {"kind": kind, "symbol": symbol, "month": month, "url": url}
    try:
        expected = get_bytes(url + ".CHECKSUM").decode("utf-8").strip().split()[0].lower()
        payload = get_bytes(url)
        actual = sha256_bytes(payload)
        if actual != expected:
            raise RuntimeError(f"checksum_mismatch:{expected}:{actual}")
        rec.update({"ok": True, "sha256": actual, "bytes": len(payload), "payload": payload})
    except FileNotFoundError:
        rec.update({"ok": False, "error": "HTTP_404"})
    except Exception as exc:
        rec.update({"ok": False, "error": f"{type(exc).__name__}:{exc}"})
    return rec


def unzip_text(payload: bytes) -> str:
    with zipfile.ZipFile(io.BytesIO(payload)) as zf:
        names = zf.namelist()
        if not names:
            raise RuntimeError("empty_zip")
        return zf.read(names[0]).decode("utf-8-sig")


def parse_kline(payload: bytes) -> pd.DataFrame:
    rows = list(csv.reader(io.StringIO(unzip_text(payload))))
    if not rows:
        return pd.DataFrame(columns=["time", "open", "high", "low", "close"])
    first = rows[0]
    has_header = not first[0].lstrip("-").isdigit()
    data = rows[1:] if has_header else rows
    parsed = []
    for row in data:
        if len(row) < 5:
            continue
        try:
            open_ms = int(float(row[0]))
            o, h, l, c = map(float, row[1:5])
        except Exception:
            continue
        parsed.append((pd.to_datetime(open_ms, unit="ms", utc=True), o, h, l, c))
    return pd.DataFrame(parsed, columns=["time", "open", "high", "low", "close"]).drop_duplicates("time", keep="last").sort_values("time")


def months_between(start: pd.Timestamp, end_exclusive: pd.Timestamp) -> list[str]:
    periods = pd.period_range(start=start.to_period("M"), end=(end_exclusive - pd.Timedelta(seconds=1)).to_period("M"), freq="M")
    return [str(p) for p in periods]


def load_market(symbols: list[str], months: list[str], workers: int):
    specs = [(kind, symbol, month) for symbol in symbols for month in months for kind in ("mark", "index")]
    raw = {(symbol, month): {} for symbol in symbols for month in months}
    records = []
    with ThreadPoolExecutor(max_workers=max(1, min(workers, 16))) as pool:
        futures = {pool.submit(download_verified, *spec): spec for spec in specs}
        for fut in as_completed(futures):
            rec = fut.result()
            payload = rec.pop("payload", None)
            if rec.get("ok") and payload is not None:
                try:
                    frame = parse_kline(payload)
                    if frame.empty:
                        raise RuntimeError("empty_parsed_frame")
                    raw[(rec["symbol"], rec["month"])][rec["kind"]] = frame
                    rec["rows"] = int(len(frame))
                except Exception as exc:
                    rec["ok"] = False
                    rec["error"] = f"parse_failed:{type(exc).__name__}:{exc}"
            records.append(rec)
    records.sort(key=lambda r: (r["symbol"], r["month"], r["kind"]))
    return raw, records


def combine_symbol(symbol: str, months: list[str], raw: dict, start: pd.Timestamp, end: pd.Timestamp) -> pd.DataFrame:
    marks, indexes = [], []
    for month in months:
        group = raw.get((symbol, month), {})
        if "mark" in group:
            marks.append(group["mark"])
        if "index" in group:
            indexes.append(group["index"])
    if not marks or not indexes:
        raise RuntimeError(f"{symbol}:missing_market_data")
    mark = pd.concat(marks, ignore_index=True).drop_duplicates("time", keep="last").sort_values("time").set_index("time")
    index = pd.concat(indexes, ignore_index=True).drop_duplicates("time", keep="last").sort_values("time").set_index("time")
    idx = mark.index.intersection(index.index)
    df = mark.loc[idx, ["open", "high", "low", "close"]].copy()
    df["index_close"] = index.loc[idx, "close"]
    return df[(df.index >= start) & (df.index < end)].copy()


def build_events(symbol: str, df: pd.DataFrame, manifest: dict) -> list[dict]:
    s = manifest["signal"]
    interval = int(s["intervalMinutes"])
    range_bars = int(s["rangeMinutes"] // interval)
    vol_bars = int(s["volLookbackMinutes"] // interval)
    hold_bars = int(s["holdMinutes"] // interval)
    cost_bps = float(manifest["costModel"]["roundTripBps"])

    work = df.copy()
    work["ret"] = work["close"].pct_change(fill_method=None)
    work["sigma"] = work["ret"].shift(1).rolling(vol_bars, min_periods=vol_bars).std()
    work["shock_z"] = work["ret"].abs() / work["sigma"]
    work["prior_high"] = work["high"].shift(1).rolling(range_bars, min_periods=range_bars).max()
    work["prior_low"] = work["low"].shift(1).rolling(range_bars, min_periods=range_bars).min()
    work["basis_bps"] = (work["close"] / work["index_close"] - 1.0) * 10000.0

    rows = work.reset_index(names="time")
    events = []
    next_allowed = 0
    for i in range(vol_bars, len(rows) - hold_bars - 1):
        if i < next_allowed:
            continue
        row = rows.iloc[i]
        if not np.isfinite(row["shock_z"]) or row["shock_z"] < float(s["volShockZ"]):
            continue
        direction = 0
        if row["close"] > row["prior_high"] and row["basis_bps"] <= float(s["maxLongBasisBps"]):
            direction = 1
        elif row["close"] < row["prior_low"] and row["basis_bps"] >= float(s["minShortBasisBps"]):
            direction = -1
        if direction == 0:
            continue
        entry = float(rows.iloc[i + 1]["open"])
        exit_px = float(rows.iloc[i + hold_bars]["close"])
        if not (entry > 0 and exit_px > 0):
            continue
        gross_bps = direction * (exit_px / entry - 1.0) * 10000.0
        events.append({
            "symbol": symbol,
            "signalAt": row["time"].isoformat(),
            "direction": "LONG" if direction > 0 else "SHORT",
            "shockZ": round(float(row["shock_z"]), 6),
            "basisBps": round(float(row["basis_bps"]), 6),
            "entry": entry,
            "exit": exit_px,
            "grossBps": round(gross_bps, 6),
            "netBpsBeforeFunding": round(gross_bps - cost_bps, 6),
        })
        next_allowed = i + hold_bars
    return events


def summarize(events: list[dict], manifest: dict) -> dict:
    gross = np.asarray([e["grossBps"] for e in events], dtype=float)
    net = np.asarray([e["netBpsBeforeFunding"] for e in events], dtype=float)
    if len(gross) == 0:
        return {"events": 0, "grossMeanBps": None, "grossMedianBps": None, "netMeanBpsBeforeFunding": None, "winRateGross": None}
    return {
        "events": int(len(gross)),
        "grossMeanBps": round(float(gross.mean()), 6),
        "grossMedianBps": round(float(np.median(gross)), 6),
        "netMeanBpsBeforeFunding": round(float(net.mean()), 6),
        "winRateGross": round(float((gross > 0).mean()), 6),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--workers", type=int, default=12)
    args = ap.parse_args()

    manifest_path = Path(args.manifest)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    manifest = json.loads(manifest_path.read_text())

    if manifest.get("economicsScreenAllowed") is not True:
        raise RuntimeError("economics_screen_not_authorized")
    if any(manifest.get(k) is True for k in ("executionAuthority", "capitalEligible", "liveOrders")):
        raise RuntimeError("illegal_execution_authority")

    symbols = list(manifest["universe"])
    start = pd.Timestamp(manifest["chronology"]["economicsStart"])
    end = pd.Timestamp(manifest["chronology"]["economicsEndExclusive"])
    months = months_between(start, end)
    raw, records = load_market(symbols, months, args.workers)
    expected = len(symbols) * len(months) * 2
    ok_count = sum(1 for r in records if r.get("ok"))
    coverage = ok_count / expected if expected else 0.0

    report = {
        "ok": False,
        "engineVersion": manifest["engineVersion"],
        "proposalId": manifest["proposalId"],
        "hypothesisFingerprint": manifest["hypothesisFingerprint"],
        "family": manifest["family"],
        "classification": "DATA_BLOCKED",
        "coverage": {"expectedArchives": expected, "okArchives": ok_count, "ratio": round(coverage, 6)},
        "sourceArchives": records,
        "sourceEvidenceSha256": sha256_bytes(json.dumps(records, sort_keys=True, separators=(",", ":")).encode()),
        "economicsPeriod": {"start": start.isoformat(), "endExclusive": end.isoformat()},
        "executionAuthority": False,
        "capitalEligible": False,
        "liveOrders": False,
        "fundingTreatment": "not_applied_in_economic_screen; realized funding required in deep backtest if authorized",
    }

    required_coverage = float(manifest["economicGates"]["requiredArchiveCoverage"])
    if coverage < required_coverage:
        report["reason"] = "archive_coverage_below_frozen_requirement"
        (out / "economic_report.json").write_text(json.dumps(report, indent=2, sort_keys=True))
        print(json.dumps({"classification": report["classification"], "coverage": report["coverage"]}, sort_keys=True))
        return 2

    all_events = []
    by_symbol = {}
    for symbol in symbols:
        frame = combine_symbol(symbol, months, raw, start, end)
        events = build_events(symbol, frame, manifest)
        all_events.extend(events)
        by_symbol[symbol] = summarize(events, manifest)

    agg = summarize(all_events, manifest)
    gates = manifest["economicGates"]
    positive_assets = [s for s, m in by_symbol.items() if m["events"] > 0 and m["grossMeanBps"] is not None and m["grossMeanBps"] >= float(gates["positiveAssetGrossMeanBps"])]
    gate_rows = [
        {"code": "MIN_EVENTS", "pass": agg["events"] >= int(gates["minEvents"]), "observed": agg["events"], "required": int(gates["minEvents"])},
        {"code": "GROSS_MEAN", "pass": agg["grossMeanBps"] is not None and agg["grossMeanBps"] >= float(gates["requiredGrossMeanBps"]), "observed": agg["grossMeanBps"], "required": float(gates["requiredGrossMeanBps"])},
        {"code": "MEDIAN_GROSS", "pass": agg["grossMedianBps"] is not None and agg["grossMedianBps"] > float(gates["minMedianGrossBpsExclusive"]), "observed": agg["grossMedianBps"], "required": f">{gates['minMedianGrossBpsExclusive']}"},
        {"code": "POSITIVE_ASSETS", "pass": len(positive_assets) >= int(gates["minPositiveAssets"]), "observed": positive_assets, "required": int(gates["minPositiveAssets"])},
    ]
    passed = all(g["pass"] for g in gate_rows)
    report.update({
        "ok": True,
        "classification": "PASS_PREFILTER" if passed else "FAIL_ECONOMICS",
        "reason": "frozen_archived_economic_screen_passed" if passed else "frozen_archived_economic_screen_failed",
        "aggregate": agg,
        "bySymbol": by_symbol,
        "positiveAssets": positive_assets,
        "gates": {"pass": passed, "passed": sum(1 for g in gate_rows if g["pass"]), "total": len(gate_rows), "results": gate_rows},
        "modeledCostBps": float(manifest["costModel"]["roundTripBps"]),
        "safetyBufferBps": float(gates["safetyBufferBps"]),
        "requiredGrossBps": float(gates["requiredGrossMeanBps"]),
        "interpretation": gates["interpretation"],
    })
    (out / "economic_report.json").write_text(json.dumps(report, indent=2, sort_keys=True))
    pd.DataFrame(all_events).to_csv(out / "economic_events.csv", index=False)
    print(json.dumps({"classification": report["classification"], "aggregate": agg, "positiveAssets": positive_assets, "gates": report["gates"]}, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"FATAL {type(exc).__name__}:{exc}", file=sys.stderr)
        raise
